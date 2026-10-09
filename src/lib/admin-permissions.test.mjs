import test from "node:test";
import fs from "node:fs";
import assert from "node:assert/strict";
import { setupMock } from "./mock-test-harness.mjs";

test("persisted role matrix and safe route boundaries", () => {
  const { canAccessAdminPath, adminLanding } = setupMock().load("admin-permissions");
  for (const path of ["/admin/checkin", "/admin/rewards", "/admin/promo-codes", "/admin/coupons"]) {
    assert.equal(canAccessAdminPath("ADMIN", path), true);
    assert.equal(canAccessAdminPath("OWNER", path), true);
    assert.equal(canAccessAdminPath("MEMBER", path), false);
  }
  for (const path of ["/admin", "/admin/members", "/admin/members/BLU-1", "/admin/finance"]) {
    assert.equal(canAccessAdminPath("ADMIN", path), false);
    assert.equal(canAccessAdminPath("OWNER", path), true);
  }
  for (const path of ["/administrator", "/admin/coupons-extra", "/admin/coupons/../members", "/admin//coupons", "/admin/coupons?next=/admin/members"]) assert.equal(canAccessAdminPath("ADMIN", path), false);
  assert.equal(canAccessAdminPath("STAFF", "/admin/checkin"), false);
  assert.equal(adminLanding("ADMIN"), "/admin/checkin");
  assert.equal(adminLanding("MEMBER"), "/member");
});

test("restricted pages and staff sections have server guards", () => {
  const read = (path) => fs.readFileSync(new URL(`../app/${path}`, import.meta.url), "utf8");
  for (const path of ["admin/page.tsx", "admin/members/page.tsx", "admin/members/[memberCode]/page.tsx", "admin/finance/page.tsx"]) {
    assert.match(read(path), /await requireAdminPage\(/);
    assert.doesNotMatch(read(path), /[\"']use client[\"']/);
  }
  for (const section of ["members", "checkin", "rewards", "promo-codes", "coupons"]) assert.match(read(`admin/${section}/layout.tsx`), /await requireAdminPage\(/);
  assert.match(read("api/admin/roles/route.ts"), /sameOrigin\(request\)/);
  assert.match(read("api/admin/roles/route.ts"), /owner\?\.role !== "OWNER"/);
  assert.match(read("api/upload/route.ts"), /member\.role !== "OWNER" && member\.role !== "MEMBER"/);
});

test("legacy mocks default nickname and never promote personnel categories", () => {
  const app = setupMock();
  const members = app.load("admin-members");
  const seed = members.readAdminMembers();
  assert.equal(seed.find((member) => member.memberCode === "BLU-1019").role, "MEMBER");
  assert.equal(seed[0].nickname, "");
  const memberCode = seed[0].memberCode;
    const profile = Object.fromEntries(Object.entries(seed[0]).filter(([key]) => !["id", "memberCode", "cardNumber", "membershipHistory", "coupons"].includes(key)));
  const updated = members.saveAdminMemberProfile(memberCode, { ...profile, nickname: "ชาย" });
  assert.equal(updated.nickname, "ชาย");
  assert.equal(members.readAdminMember(memberCode).nickname, "ชาย");
  assert.throws(() => members.saveAdminMemberProfile(memberCode, { ...profile, role: "OWNER" }));
  const legacy = JSON.parse(app.storage.get(members.ADMIN_MEMBERS_KEY));
  delete legacy.members[0].nickname;
  legacy.members[0].role = "STAFF";
  app.storage.set(members.ADMIN_MEMBERS_KEY, JSON.stringify(legacy));
  assert.equal(members.readAdminMember(memberCode).nickname, "");
  assert.equal(members.readAdminMember(memberCode).role, "MEMBER");
});
