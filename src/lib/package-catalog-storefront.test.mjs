import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function mount(fetchCatalog) {
  const states = [], effects = [], listeners = new Map(), requests = [];
  let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const context = {
    exports, AbortController,
    fetch: async (url, options) => {
      if (url !== "/api/packages") return { ok: true, json: async () => ({}) };
      requests.push(options);
      return fetchCatalog(options);
    },
    window: {
      addEventListener: (event, handler) => listeners.set(event, handler),
      removeEventListener: (event) => listeners.delete(event),
    },
    require: (name) => {
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return {
        useState: (initial) => {
          const index = cursor++;
          if (!(index in states)) states[index] = initial;
          return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
        },
        useEffect: (effect) => { effects.push(effect); },
      };
      if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
      if (name.includes("LanguageContext")) return { useLanguage: () => ({ lang: "en", t: (key) => key }) };
      if (name.includes("mock-data")) throw new Error("Runtime mock catalog import forbidden");
      return { default: name };
    },
  };
  vm.runInNewContext(code, context);
  const render = () => { cursor = 0; effects.length = 0; return exports.default(); };
  const initial = render();
  const cleanups = effects.map((effect) => effect());
  return { initial, render, requests, listeners, cleanup: () => cleanups.forEach((cleanup) => cleanup?.()) };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
const text = (tree) => JSON.stringify(tree);
const item = { id: 44, name: "Database package", label: "DB", durationDays: 30, timeSlot: "07:00-22:00", price: 777, version: 9, isActive: true };
const response = (packages) => ({ ok: true, json: async () => ({ packages }) });

test("database catalog: loading, local slot filtering, selection version and focus refresh", async () => {
  const app = mount(async () => response([item, { ...item, id: 45, isActive: false }, { ...item, id: 46, timeSlot: "07:00-14:00" }]));
  assert.match(text(app.initial), /Loading packages/);
  await settle();
  let tree = app.render();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].cache, "no-store");
  assert.ok(app.requests[0].signal instanceof AbortSignal);
  const select = nodes(tree).filter((node) => node.type === "button" && node.props.children === "pkg.btn_select");
  assert.equal(select.length, 1);
  select[0].props.onClick();
  tree = app.render();
  const modal = nodes(tree).find((node) => node.type === "@/components/PaymentModal");
  assert.ok(modal);
  assert.match(text(modal), /"catalogVersion":9/);
  nodes(tree).find((node) => node.type === "button" && node.props.children === "pkg.offpeak").props.onClick();
  assert.equal(nodes(app.render()).filter((node) => node.type === "button" && node.props.children === "pkg.btn_select").length, 1);
  assert.equal(app.requests.length, 1);
  app.listeners.get("focus")();
  assert.match(text(app.render()), /Loading packages/);
  await settle();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[0].signal.aborted, true);
  app.cleanup();
  assert.equal(app.requests[1].signal.aborted, true);
  assert.equal(app.listeners.has("focus"), false);
});

test("empty public catalog is not a fetch error", async () => {
  const app = mount(async () => response([]));
  await settle();
  const tree = app.render();
  assert.match(text(tree), /No packages available/);
  assert.equal(nodes(tree).some((node) => node.props?.role === "alert"), false);
  app.cleanup();
});

for (const [name, fetchCatalog] of [
  ["HTTP failure", async () => ({ ok: false })],
  ["network failure", async () => { throw new Error("offline"); }],
  ["invalid payload", async () => ({ ok: true, json: async () => ({}) })],
]) {
  test(`${name} exposes retry without mock fallback`, async () => {
    const app = mount(fetchCatalog);
    await settle();
    const tree = app.render();
    assert.match(text(tree), /Unable to load packages/);
    const retry = nodes(tree).find((node) => node.type === "button" && node.props.children === "Retry");
    assert.ok(retry);
    retry.props.onClick();
    assert.match(text(app.render()), /Loading packages/);
    assert.equal(nodes(tree).some((node) => node.props?.children === "pkg.btn_select"), false);
    app.cleanup();
  });
}

test("unmount aborts and ignores a late response; no polling or mock fallback", async () => {
  let resolve;
  const app = mount(() => new Promise((done) => { resolve = done; }));
  app.cleanup();
  resolve(response([item]));
  await settle();
  assert.match(text(app.render()), /Loading packages/);
  assert.equal(app.requests[0].signal.aborted, true);
  assert.doesNotMatch(source, /getPackagesBySlot|mockPackages|setInterval/);
});
