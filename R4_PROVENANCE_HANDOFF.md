# R4 checkpoint — additive online provenance only

18 พ.ย. 2026 — **R4 ยังไม่เสร็จ / ไม่พร้อม production / migration ยังไม่ apply**

## ขอบเขตและเหตุผล fallback

อ่าน AGENTS, CLIENT_BRIEF_HANDOFF, TODO R0–R10, R1_IMPLEMENTATION_MATRIX และ Next 16.3.3 route guide จาก package จริงผ่าน require.resolve แล้ว ก่อนเขียนไฟล์ ตรวจ git status พบงาน R3/ผู้ใช้เดิมและไม่แก้ไฟล์เหล่านั้น

Staff renewal ที่ coherent ยังเปิดไม่ได้ภายใต้ write scope นี้: finalizer รวมวันใน members.expire_date; checkin ยังเลือก PAID ล่าสุด (R3 ขยายช่วงเวลาแต่ยังไม่ได้เป็น entitlement reader รายแพ็กเกจ); finance เดิมไม่ใช่ staff-sale ledger และไม่รองรับ 0 บาท โมเดล online order บังคับยอด >0 และ bank verification จึงไม่ใช้ทำ staff/free sale หรือ fake slip

เลือก fallback ที่ผู้ใช้อนุญาต ไม่เพิ่ม UI/API/ปุ่มสำเร็จหรือ mock staff sale ไม่เปลี่ยน payment-server/catalog/checkin/benefits, migration เก่า, TODO หรือไฟล์งานเดิม

## ไฟล์ใหม่

- `src/db/migrations/20261118_R4_online_provenance.sql`
- `src/lib/entitlement-online-provenance.test.mjs`
- เอกสารนี้

Migration เพิ่ม `entitlement_online_observations` และ AFTER UPDATE hook เฉพาะ PENDING → PAID ใหม่ รวม pending ที่สร้างก่อน apply แต่ยืนยันหลัง apply ไม่มี backfill หรือ INSERT SELECT จาก PAID เก่า

ข้อมูล: order/member, immutable package snapshot copy, confirmed_at, membership_expires_at ที่ finalizer บันทึก, FK ไป original point ledger, delta/balance snapshot, recorded_at และ provenance_version โดย order_id เป็น PK และ ledger source UNIQUE

**เป็น shadow observation/audit ไม่ใช่ entitlement authority**: ไม่สร้าง starts_at จาก expiry-duration ไม่พิสูจน์ช่วงสิทธิ์เก่า ไม่แก้ aggregate ไม่ออกคะแนน/คูปอง/รายรับเพิ่ม ไม่เปลี่ยนสูตรคะแนน/โบนัส ไม่เก็บ slip/evidence/session เพิ่ม ไม่ copy online income จนถูกนับซ้ำ Audit เกิดจากระบบยืนยันออนไลน์ ไม่ใช่ actor staff หรือ audit ถอนสิทธิ์

Hook ตรวจ ledger member/delta ตรง order หากขาด/ไม่ตรงให้ exception ทั้ง transaction ไม่ ON CONFLICT แล้วกลบข้อมูลผิด Finalizer terminal replay ไม่เกิด transition ใหม่จึงไม่เพิ่ม audit อีก ห้าม UPDATE/DELETE/TRUNCATE observation และ revoke PUBLIC table/function privileges; SECURITY INVOKER พร้อม fixed search_path ใช้ backend DB role ตามระบบเดิม ไม่เปิด endpoint อ่านเงินให้ ADMIN

## Validation ที่รันจริง (offline)

| คำสั่ง | ผล |
|---|---|
| `node --test src/lib/entitlement-online-provenance.test.mjs` | ผ่าน 2 tests, ไม่มี skip; SQL จริงใน in-memory PGlite |
| `pnpm exec tsc --noEmit --incremental false` | ผ่าน |
| `pnpm exec eslint src/lib/entitlement-online-provenance.test.mjs` | ผ่าน (รันซ้ำหลังปรับ test แล้ว) |
| `pnpm lint` | ไม่ผ่าน error เดิม `src/app/member/AccountClient.tsx:78`, react-hooks/set-state-in-effect; ไม่แก้นอก scope |
| `node --test src/lib/payment-server.test.mjs src/lib/package-payment-benefits.test.mjs src/lib/package-catalog-r3.test.mjs` | ผ่าน 31 tests; provider ใน payment tests เป็น mock ไม่เรียก provider จริง |

R4 SQL harness ใช้ schema fixture จำลองและ payment migrations 20261009/20261010 เพื่อเรียก finalizer จริง ตรวจ PAID และ point ledger ก่อน migration คงเดิม, ไม่มี backfill, settlement/replay/no-op PAID update มี observation ครั้งเดียว, snapshot/ledger link ตรง, PUBLIC ไม่มี table grants, audit แก้/ลบ/truncate ไม่ได้, rollback ไม่เหลือ transfer ref, injected audit failure ย้อน PAID/points/transfer และ mismatched ledger fail closed ไม่เพิ่มยอด

PGlite resolve ที่ root ไม่พบ แต่ fallback จาก `.local-db/payment-sql-tests/package.json` resolve runtime ที่มีอยู่ได้ จึงรัน SQL สำเร็จโดยไม่มี install/download ไม่มีการเชื่อมฐานเดิม/ฐานจริงหรือ network ไม่โหลด env ไม่ใช้ paid provider ไม่ commit/branch/deploy

**ข้อจำกัดหลักฐาน:** ไม่ได้รัน R4 hook บน installed production schema/ACL/finalizer chain ทั้งชุด ไม่ได้ทดสอบ PostgreSQL หลาย connection, actual auth integration, browser UAT หรือ backup/restore จึงไม่ใช่ production acceptance; R3/benefits regressions แยกผ่าน ไม่เท่ากับทดสอบ migration ทุกชุดร่วมกับ R4 ในฐานจริง

## Dependency / งานค้างก่อนเปิด staff renewal

1. ออกแบบและทำ entitlement interval เป็น source of truth พร้อม compatibility/reconciliation กับ legacy aggregate และ anomaly ที่ handoff แจ้ง ห้าม backfill ambiguous PAID เอง
2. ปรับ checkin/สมาชิกให้อ่านสิทธิ์รายแพ็กเกจที่มีผลจริง ไม่เลือก online PAID ล่าสุดจน staff sale หายหรือยึดช่วงเวลาผิด ต้องขอ scope เพิ่มก่อนแก้ consumers เดิม
3. dedicated staff sale แยก online orders: amount_satang >=0, วิธีรับเงินจริง/ฟรี, immutable allowed-price snapshot, reason, actor, requestKey + canonical payload identity, occurred_at/recorded_at; server และ SQL ตรวจ ADMIN/OWNER และ OWNER-only backdate
4. staff sale + finance source + entitlement + point/coupon provenance + audit ต้อง atomic/idempotent พร้อม ADMIN response เฉพาะยอดรายการที่ทำ ไม่เห็นยอดรวม/ประวัติเงินอื่น ต้องเพิ่ม finance reader integration โดยไม่ double count
5. ยังไม่มี staff sale/0บาท/backdate implementation หรือการทดสอบสิทธิ์เหล่านี้ในรอบนี้ ห้ามถือว่าอ่านเอกสารนี้แล้วพร้อมเปิดใช้งาน
6. R0 ถอนสิทธิ์ใช้แล้ว/คะแนนไม่พอ/แพ็กเกจต่อเนื่อง และโบนัสเพิ่มจากหรือแทนสูตรเดิม **ยัง blocked** ห้ามเดา refund/หักวันหรือแต้มรวม/ใช้โบนัสสูตรใหม่ R4 ไม่สร้าง refund/cancel/reversal function และไม่เปลี่ยน customer cancel ก่อนส่งสลิป

## ก่อนอนุมัติ migration จริง (อีกงานหนึ่ง)

- ตรวจ installed schema, migration hashes, finalizer/trigger definitions และ backend ACL แบบมีอนุมัติ เงื่อนไขที่ต้องคง: finalizer ลง point ledger ก่อน UPDATE order PAID ใน transaction เดียว, immutable terminal guard, bank/currency/auth fixes และ issuance benefits เดิมครบ
- Migration นี้ไม่มี IF NOT EXISTS จงใช้ migration runner/history ที่กัน apply ซ้ำ ไม่รัน raw file ซ้ำ และไม่ใช้ psql แบบแยกแต่ละ statementโดยละทิ้ง BEGIN/COMMIT
- ต้องซ้อมทั้ง production-like chain, SQL multi-connection/retry, fail-closed outage behavior และ ACL non-owner backend role: invoker hook ต้องมี INSERT table privilege ที่ถูกต้อง; ถ้าไม่มียืนยัน PAID จะ rollback ไม่ใช่สำเร็จเงียบ
- ขออนุมัติ backup/restore verification + apply/deploy แยก ห้ามรันจากคำสั่งทำ R4 รอบนี้
- Rollback ก่อน apply: ไม่ต้องทำอะไร หลัง apply: pause writers และขออนุมัติก่อน disable hook; **เก็บ observation/audit ไว้** ไม่ drop table/ลบข้อมูล/restore ทับหรือ rewrite PAID การปิด hookทำให้ธุรกรรมช่วงนั้นไม่มี observation ต้องบันทึก coverage gap ไม่ backfill อัตโนมัติ

**สรุป:** เตรียม additive audit สำหรับ online PAID ใหม่และผ่าน isolated checks เท่านั้น R4 staff renewal/0บาท/OWNER backdate/refund ยังไม่พร้อม และ lint ทั้งโปรเจกต์ยังติดปัญหานอก scope
