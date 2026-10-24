import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function load(path, dependencies, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { exports, require: name => dependencies[name] ?? require(name), ...globals });
  return exports;
}

function route({ owner = true, origin = true, fail = false } = {}) {
  const calls = [];
  const secret = "PRIVATE_DATABASE_URL_AND_TOKEN";
  const app = load("../app/api/test-services/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/auth/server": { getCurrentMember: async () => ({ role: owner ? "OWNER" : "MEMBER" }) },
    "@/lib/auth/http": { sameOrigin: () => origin },
    "@neondatabase/serverless": { neon: () => async () => {
      calls.push("SELECT");
      if (fail) throw new Error(secret);
      return [{ current_time: "2026-10-23", pg_version: "PostgreSQL 17" }];
    } },
    cloudinary: { v2: { config() {}, api: { ping: async () => {
      calls.push("ping");
      if (fail) throw new Error(secret);
      return { status: "ok" };
    } } } },
    "@/lib/test-service-actions": {
      serviceBalance: async service => { calls.push(service); return { available: true }; },
      testServiceAction: async () => { calls.push("POST action"); return Response.json({ success: true }); },
    },
  }, {
    process: { env: { DATABASE_URL: "mock", CLOUDINARY_CLOUD_NAME: "mock", CLOUDINARY_API_KEY: "mock", CLOUDINARY_API_SECRET: "mock", SMS_API_KEY: "mock", SMS_API_SECRET: "mock", LINE_CHANNEL_ACCESS_TOKEN: "mock" } },
    Buffer, AbortSignal,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method });
      if (fail) throw new Error(secret);
      return Response.json(url.includes("thaibulksms") ? { remaining_credit: { standard: 10 } } : { displayName: "Bot", basicId: "@bot", pictureUrl: "https://example.com/bot.png" });
    },
  });
  return { app, calls, secret };
}

test("diagnostics guards reject before database/provider/action calls", async () => {
  const denied = route({ owner: false });
  assert.equal((await denied.app.GET()).status, 403);
  assert.equal((await denied.app.POST(new Request("https://local"))).status, 403);
  assert.equal(denied.calls.length, 0);
  const crossOrigin = route({ origin: false });
  assert.equal((await crossOrigin.app.POST(new Request("https://local"))).status, 403);
  assert.equal(crossOrigin.calls.length, 0);
});

test("automatic diagnostics preserve output and perform only read-only checks", async () => {
  const { app, calls } = route();
  const response = await app.GET();
  const { results } = await response.json();
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(Object.keys(results).length, 5);
  assert.equal(results.database.data.version, "PostgreSQL");
  assert.equal(results.thaibulksms.data.credit, '{"standard":10}');
  assert.equal(results.line.data.botName, "Bot");
  assert.equal(calls.filter(call => call === "slip").length, 1);
  assert.ok(calls.filter(call => typeof call === "object").every(call => call.method === "GET"));
  assert.ok(!calls.includes("POST action"));
});

test("unknown failures produce safe messages, never raw exception secrets", async () => {
  const { app, secret } = route({ fail: true });
  const body = await (await app.GET()).json();
  assert.ok(!JSON.stringify(body).includes(secret));
  for (const key of ["database", "cloudinary", "thaibulksms", "line"]) {
    assert.equal(body.results[key].status, "ERROR");
    assert.equal(typeof body.results[key].error, "string");
  }
});

test("test page starts one GET asynchronously and aborts on unmount without stale updates", async () => {
  const effects = [];
  const updates = [];
  const calls = [];
  let resolveFetch;
  const app = load("../app/test/page.tsx", {
    react: {
      useState: initial => [initial, value => updates.push(value)],
      useRef: initial => ({ current: initial }),
      useEffect: effect => effects.push(effect),
    },
    "./CredentialTests": { default: () => null },
    "next/image": { default: () => null },
    "lucide-react": {},
  }, {
    AbortController,
    fetch: (url, init) => {
      calls.push({ url, init });
      return new Promise(resolve => { resolveFetch = resolve; });
    },
  });
  app.default();
  assert.equal(calls.length, 0);
  const cleanup = effects[0]();
  assert.equal(updates.length, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/test-services");
  assert.equal(calls[0].init.method, undefined);
  cleanup();
  assert.equal(calls[0].init.signal.aborted, true);
  resolveFetch(Response.json({ results: {} }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(updates.length, 0);
});

function languageStore() {
  const storage = new Map([["blu_lang", "en"]]);
  const listeners = new Map();
  let store;
  let failRead = false;
  let failWrite = false;
  const app = load("../context/LanguageContext.tsx", {
    react: {
      createContext: () => ({ Provider: "Provider" }),
      useSyncExternalStore: (subscribe, snapshot, serverSnapshot) => {
        store = { subscribe, snapshot, serverSnapshot };
        return snapshot();
      },
    },
    "@/lib/translations": { translations: { th: {}, en: {} } },
  }, {
    Event,
    localStorage: {
      getItem: key => { if (failRead) throw new Error("blocked"); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (failWrite) throw new Error("quota"); storage.set(key, value); },
    },
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
      dispatchEvent: event => listeners.get(event.type)?.(event),
    },
  });
  const render = () => app.LanguageProvider({ children: null }).props.value;
  render();
  return { storage, listeners, render, get store() { return store; }, blockRead() { failRead = true; }, blockWrite() { failWrite = true; } };
}

test("language store has Thai SSR snapshot, saved client language and cleaned subscriptions", () => {
  const app = languageStore();
  assert.equal(app.store.serverSnapshot(), "th");
  assert.equal(app.store.snapshot(), "en");
  let notifications = 0;
  const cleanup = app.store.subscribe(() => notifications++);
  app.render().setLang("th");
  assert.equal(app.store.snapshot(), "th");
  assert.equal(app.storage.get("blu_lang"), "th");
  assert.equal(notifications, 1);
  app.storage.set("blu_lang", "en");
  app.listeners.get("storage")({ key: "blu_lang" });
  assert.equal(app.store.snapshot(), "en");
  app.storage.set("blu_lang", "invalid");
  assert.equal(app.store.snapshot(), "th");
  cleanup();
  assert.equal(app.listeners.size, 0);
});

test("language switching survives storage read or write failures", () => {
  for (const failure of ["blockRead", "blockWrite"]) {
    const app = languageStore();
    app[failure]();
    app.render().setLang("th");
    assert.equal(app.store.snapshot(), "th");
    app.render().setLang("en");
    assert.equal(app.store.snapshot(), "en");
  }
});
