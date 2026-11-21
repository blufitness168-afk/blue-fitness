import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, Module } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

function compile(relPath, mocks = {}) {
  const filename = new URL(relPath, import.meta.url).pathname;
  const mod = new Module(filename);
  mod.filename = filename;
  mod.require = (name) => {
    if (name === "server-only") return {};
    if (name in mocks) return mocks[name];
    return require(name);
  };
  const source = readFileSync(new URL(relPath, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  mod._compile(compiled, filename);
  return mod.exports;
}

const xlsx = compile("./xlsx.ts");

function unzip(bytes) {
  const b = Buffer.from(bytes);
  const end = b.length - 22;
  assert.equal(b.readUInt32LE(end), 0x06054b50);
  let pos = b.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    assert.equal(b.readUInt32LE(pos), 0x02014b50);
    const size = b.readUInt32LE(pos + 24);
    const len = b.readUInt16LE(pos + 28);
    const offset = b.readUInt32LE(pos + 42);
    const name = b.subarray(pos + 46, pos + 46 + len).toString();
    assert.equal(b.readUInt32LE(offset), 0x04034b50);
    const start = offset + 30 + b.readUInt16LE(offset + 26);
    files[name] = b.subarray(start, start + size).toString();
    pos += 46 + len;
  }
  return files;
}

test("createXlsx supports custom sanitized sheet names and dynamic dimension ref", () => {
  const row10 = Array.from({ length: 10 }, (_, i) => `C${i + 1}`);
  const files = unzip(xlsx.createXlsx([row10, row10], "Checkins:[bad]/name*?"));
  assert.match(files["xl/workbook.xml"], /sheet name="Checkinsbadname"/);
  assert.match(files["xl/worksheets/sheet1.xml"], /<dimension ref="A1:J2"\/>/);

  const defaultFiles = unzip(xlsx.createXlsx([["A", "B"]]));
  assert.match(defaultFiles["xl/workbook.xml"], /sheet name="Finance"/);
  assert.match(defaultFiles["xl/worksheets/sheet1.xml"], /<dimension ref="A1:B1"\/>/);
});

test("GET /api/admin/members/export enforces auth, filter allowlist, full export and safety", async () => {
  const makeMemberRoute = (member = { role: "ADMIN", status: "ACTIVE" }, exportResult) => {
    let calls = 0;
    const route = compile("../app/api/admin/members/export/route.ts", {
      "@/lib/auth/server": { getCurrentMember: async () => member },
      "@/lib/admin-members-server": {
        currentStatus: (m) => m.status,
        memberListGenders: { MALE: "ชาย", FEMALE: "หญิง", OTHER: "อื่น ๆ" },
        getAdminMembersForExport: async (input) => {
          calls++;
          if (typeof exportResult === "function") return exportResult(input);
          return exportResult;
        },
      },
      "@/lib/xlsx": xlsx,
    });
    return {
      get: (query = "") =>
        route.GET(
          new Request(
            `https://example.test/api/admin/members/export${query ? `?${query}` : ""}`,
          ),
        ),
      calls: () => calls,
    };
  };

  for (const caller of [null, { role: "MEMBER", status: "ACTIVE" }, { role: "OWNER", status: "SUSPENDED" }]) {
    const instance = makeMemberRoute(caller, { status: 200, asOf: Date.now(), rows: [] });
    const res = await instance.get();
    assert.ok([401, 403].includes(res.status));
    assert.equal(instance.calls(), 0);
  }

  for (const query of ["page=1", "unknown=1", "q=a&q=b"]) {
    const instance = makeMemberRoute({ role: "OWNER", status: "ACTIVE" }, { status: 200, asOf: Date.now(), rows: [] });
    const res = await instance.get(query);
    assert.equal(res.status, 400);
    assert.equal(instance.calls(), 0);
  }

  const revoked = makeMemberRoute(
    { role: "ADMIN", status: "ACTIVE" },
    { status: 403, error: "เซสชันหมดอายุหรือไม่มีสิทธิ์" },
  );
  assert.equal((await revoked.get()).status, 403);

  const manyRows = Array.from({ length: 65 }, (_, i) => ({
    memberCode: `BLU-${i + 1}`,
    fullName: i === 0 ? "=1+1" : `@SUM(A${i})`,
    gender: "FEMALE",
    phone: "0890000000",
    createdAt: "2026-11-01T10:00:00Z",
    role: "MEMBER",
    status: "ACTIVE",
    expireDate: i % 2 === 0 ? "2026-12-01T00:00:00Z" : null,
  }));

  const success = makeMemberRoute(
    { role: "ADMIN", status: "ACTIVE" },
    (input) => {
      assert.equal(input.q, "BLU");
      assert.equal(input.gender, "FEMALE");
      return { status: 200, asOf: Date.parse("2026-11-21T08:00:00Z"), rows: manyRows };
    },
  );
  const response = await success.get("q=BLU&gender=FEMALE");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /spreadsheetml\.sheet/);
  assert.match(response.headers.get("content-disposition"), /members-2026-11-21\.xlsx/);
  assert.match(response.headers.get("cache-control"), /private, no-store/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");

  const files = unzip(await response.arrayBuffer());
  assert.match(files["xl/workbook.xml"], /sheet name="Members"/);
  const sheetXml = files["xl/worksheets/sheet1.xml"];
  assert.equal((sheetXml.match(/<row /g) ?? []).length, 66);
  assert.match(sheetXml, /<dimension ref="A1:I66"\/>/);
  assert.match(sheetXml, /BLU-65/);
  assert.doesNotMatch(sheetXml, /<f\b|hyperlink/);

  const tooMany = makeMemberRoute(
    { role: "OWNER", status: "ACTIVE" },
    () => {
      throw new xlsx.XlsxLimitError("เกิน 10,000 รายการ กรุณาลดช่วงตัวกรอง");
    },
  );
  assert.equal((await tooMany.get()).status, 413);

  const buttonSource = readFileSync(
    new URL("../app/admin/members/MembersExportButton.tsx", import.meta.url),
    "utf8",
  );
  assert.match(buttonSource, /\/api\/admin\/members\/export/);
  assert.doesNotMatch(buttonSource, /text\/csv/);
});

test("GET /api/admin/checkin/export enforces auth, SQL validation, un-fabricated legacy exits and UI wiring", async () => {
  const makeCheckinRoute = ({
    member = { role: "ADMIN", status: "ACTIVE" },
    capability = { visits: true },
    rows = [],
    authOk = true,
  } = {}) => {
    const calls = [];
    const realCheckin = compile("./real-checkin-server.ts", {
      "next/headers": { cookies: async () => ({ get: () => ({ value: "b".repeat(64) }) }) },
      "@neondatabase/serverless": {
        neon: () => async (parts, ...values) => {
          const text = parts.join("?");
          calls.push({ text, values });
          if (text.includes("to_regclass")) return [capability];
          return [{ authOk, records: rows }];
        },
      },
      "./auth/server": {
        SESSION_COOKIE: "blu_session",
        getCurrentMember: async () => member,
      },
      "./auth/http": {
        readBody: async (r) => r.json(),
        json: (body, status = 200) => Response.json(body, { status }),
      },
    });
    const route = compile("../app/api/admin/checkin/export/route.ts", {
      "@/lib/real-checkin-server": realCheckin,
      "@/lib/xlsx": xlsx,
    });
    const oldUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "mock-only";
    return {
      get: async (query = "") => {
        try {
          return await route.GET(
            new Request(
              `https://example.test/api/admin/checkin/export${query ? `?${query}` : ""}`,
            ),
          );
        } finally {
          if (oldUrl === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = oldUrl;
        }
      },
      calls,
    };
  };

  for (const caller of [null, { role: "MEMBER", status: "ACTIVE" }, { role: "ADMIN", status: "SUSPENDED" }]) {
    const inst = makeCheckinRoute({ member: caller });
    assert.ok([401, 403].includes((await inst.get()).status));
    assert.equal(inst.calls.length, 0);
  }

  for (const badQuery of [
    "page=2",
    "bad=1",
    "from=2026-11-01T10:00",
    "from=2026-11-02T10:00%2B07:00&to=2026-11-01T10:00%2B07:00",
  ]) {
    const inst = makeCheckinRoute();
    assert.equal((await inst.get(badQuery)).status, 400);
    assert.equal(inst.calls.length, 0);
  }

  const revoked = makeCheckinRoute({ authOk: false, rows: [] });
  assert.equal((await revoked.get()).status, 403);

  const records = Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    memberCode: `BLU-${i + 1}`,
    fullName: i === 0 ? "=CMD()" : `User ${i + 1}`,
    checkedAt: "2026-11-21T03:00:00Z",
    scannerType: i === 0 ? "HARDWARE_USB" : "MANUAL",
    pointsAwarded: 0,
    notes: i === 0 ? "legacy row" : "manual pair",
    exitedAt: i === 0 ? null : "2026-11-21T04:30:00Z",
    durationSeconds: i === 0 ? null : 5400,
    snapshot:
      i === 0
        ? null
        : {
            reason: "MANUAL_PAIR",
            usedTimeSlot: "07:00-14:00",
            package: { name: "All-Day" },
            serviceType: "Gym",
          },
  }));

  const success = makeCheckinRoute({ rows: records });
  const response = await success.get("query=BLU");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /spreadsheetml\.sheet/);
  assert.match(response.headers.get("content-disposition"), /checkins-\d{4}-\d{2}-\d{2}\.xlsx/);

  const files = unzip(await response.arrayBuffer());
  assert.match(files["xl/workbook.xml"], /sheet name="Checkins"/);
  const sheetXml = files["xl/worksheets/sheet1.xml"];
  assert.equal((sheetXml.match(/<row /g) ?? []).length, 61);
  assert.match(sheetXml, /<dimension ref="A1:J61"\/>/);
  assert.match(sheetXml, /ไม่มีเวลาออก/);
  assert.match(sheetXml, /บันทึกย้อนหลัง \/ Gym/);
  assert.match(sheetXml, /<v>90<\/v>/);
  assert.doesNotMatch(sheetXml, /<f\b|hyperlink/);

  const overLimit = makeCheckinRoute({
    rows: Array.from({ length: 10001 }, (_, i) => ({
      id: i + 1,
      memberCode: `BLU-${i + 1}`,
      fullName: "X",
      checkedAt: "2026-11-21T03:00:00Z",
      scannerType: "HARDWARE_USB",
      pointsAwarded: 0,
      notes: "",
      exitedAt: null,
      durationSeconds: null,
      snapshot: null,
    })),
  });
  assert.equal((await overLimit.get()).status, 413);

  const checkinPage = readFileSync(
    new URL("../app/admin/checkin/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(checkinPage, /AdminDashboardChart/);
  assert.match(checkinPage, /type="line"/);
  assert.match(checkinPage, /\/api\/admin\/checkin\/export/);
});
