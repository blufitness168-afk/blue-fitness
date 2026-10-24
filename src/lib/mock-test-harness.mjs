import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import ts from "typescript";

const require = createRequire(import.meta.url);
const outputs = new Map();
export function setupMock({ locks = true, storage = new Map() } = {}) {
  const clock = { now: Date.parse("2026-09-07T02:00:00Z") };
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const failures = { read: false, write: false, writeKey: null };
  const writes = [], events = [], requests = [];
  const queues = new Map();
  const globals = {
    Date: MockDate, Intl, Error, structuredClone, crypto: { randomUUID }, performance: { now: () => 0 },
    localStorage: {
      getItem(key) { if (failures.read) throw new Error("denied"); return storage.get(key) ?? null; },
      setItem(key, value) { if (failures.write || failures.writeKey === key) throw new Error("quota"); writes.push(key); storage.set(key, value); },
      removeItem(key) { if (failures.write || failures.writeKey === key) throw new Error("quota"); writes.push(key); storage.delete(key); },
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    window: { dispatchEvent(event) { events.push(event.type); return true; } },
    navigator: locks ? { locks: { request(key, options, callback) {
      requests.push({ key, options });
      const result = (queues.get(key) ?? Promise.resolve()).then(callback);
      queues.set(key, result.catch(() => {}));
      return result;
    } } } : {},
  };
  const modules = new Map();
  function load(name) {
    if (!name.startsWith("./")) return require(name);
    name = name.slice(2);
    if (!outputs.has(name)) outputs.set(name, ts.transpileModule(fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText);
    if (!modules.has(name)) {
      const context = { ...globals, exports: {}, require: load };
      modules.set(name, context.exports);
      vm.runInNewContext(outputs.get(name), context, { filename: `${name}.js` });
    }
    return modules.get(name);
  }
  return { load: name => load(`./${name}`), storage, clock, failures, writes, events, requests,
    holdLock(key) {
      let release;
      const held = new Promise(resolve => { release = resolve; });
      globals.navigator.locks.request(key, { mode: "exclusive" }, () => held);
      return release;
    },
  };
}
