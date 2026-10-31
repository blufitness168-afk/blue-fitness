# BLU FITNESS — Final Test / UAT

อัปเดต: 2026-10-24 | สภาพแวดล้อม: localhost + Neon บัญชีทดสอบ | ยังไม่ใช่ production sign-off

## Currency764 owner recovery พร้อมใช้งาน — 31 ต.ค. 2026

- เพิ่ม `20261031_payment_currency_recheck.sql`: invoker/publicEXECUTEปิด/pinnedsearch_path, NORMAL OWNER sessionของเจ้าของorderเท่านั้น, auditreasonTHB_NUMERIC_CURRENCY_FIX, ใช้OWNER_RECHECKbudgetร่วมlegacyหนึ่งครั้ง, imagehash/createdAt/order/ยอดไม่เปลี่ยน ไม่มีPAIDหรือแต้มจากprepare
- Deployเฉพาะfunctionใหม่ลงฐานที่ `.env.local` ชี้ตามผู้ใช้ยืนยัน (ไม่มี.env.productionแล้ว) backup `.local-db/backup-2026-10-31T12-19-18.712Z`; ทุกrow30ตารางและfunctionเดิมไม่เปลี่ยน ไม่มีattemptreopened/provider/SMS/โอนเงิน
- เพิ่มserverrecheckreasonและให้initialpaymentAccountส่งownerrecoveryflags; ปุ่มใหม่ **OWNER: ตรวจสลิปเดิมอีกครั้งหลังแก้สกุลเงิน (1 ครั้ง)** เลือกภาพเดิมแล้วconfirmครั้งเดียว → prepareaudit → verifyreconcile=true มีguardห้ามprovidercallที่3และห้ามไฟล์ใหม่
- Tests239/239,TypeScript,lint,diffcheckและproductionbuildแยกผ่าน; ChromeUI6/6ที่360/390/1440พร้อมprepare409ไม่ส่งverify/alreadypreparedretry/memberไม่เห็นปุ่ม แบบinterceptทั้งหมด ไม่มีbackendwrite; รายงาน `.local-db/currency-recovery-ui-1793449284225/`
- localhost3000ตอนทดสอบปิดอยู่ จึงใช้disposableNextที่3001ไม่มีenv/secretsและหยุดหลังจบ ไม่แตะuserserver
- ตรวจorderจริงล่าสุดแบบread-only: PENDING, ownerroleOWNER, attemptREJECTED/provider_calls1/owner_rechecks0 ยังไม่ตรวจสลิปเพิ่ม ผู้ใช้ยินยอมโควตาแล้วแต่ขั้นverifyจริงต้องใช้ไฟล์สลิปเดิมและOWNERsessionในbrowserของผู้ใช้ หลังdeployล่าสุดเท่านั้น ห้ามโอนใหม่

## แก้สกุลเงิน numeric THB764 — 31 ต.ค. 2026

- ผู้ใช้ส่งผลตรวจเดิมจากEasySlipdashboard: amountmatched/name matched แต่ rawSlip.amount.local.currency='764'; policyเดิมยอมรับแค่THB จึงเกิดPROVIDER_VALIDATION_FAILED เป็นบั๊กของเรา ไม่ใช่หลักฐานสลิปปลอม
- แก้ `src/lib/payment-policy.ts` ให้THB/'764'/764หมายถึงเงินบาทเหมือนกัน และตรวจlocal.amountให้ตรงด้วยทั้งสามรูปแบบ; ยังrejectUSD/840/EUR978/invalidcurrency/name/account/amount/timeตามเดิม
- Testsเพิ่มใช้ข้อมูลสังเคราะห์รูปแบบPromptPayที่ไม่มีreceiver.bank มีproxyปิดบัง ไม่เก็บpayload/transRef/ข้อมูลผู้โอนของจริงลงrepo; servermocktestยืนยัน764settle/replayไม่เพิ่มโควตาหรือเครดิตซ้ำ
- Fulltests236/236,TypeScript/lintผ่าน; ไม่เรียกprovider/SMS/ไม่แก้attemptหรือPAIDจริง ต้องdeploycodeล่าสุดก่อน
- รายการที่ถูกREJECTEDเดิมไม่หายเองจากการdeploy; ห้ามกดตรวจซ้ำปกติ/รีเซ็ตDB/โอนใหม่ ต้องใช้recoveryที่มีauditและยืนยันก่อนใช้โควตาตรวจซ้ำ เมื่อreviewเส้นทางกู้เสร็จ

## Incident สลิปจริงตอบ422แต่ผู้ใช้ไม่เห็นข้อความ — 31 ต.ค. 2026

- ตรวจorderที่ผู้ใช้ส่งจากภาพแบบread-only: PENDING100บาท, attemptREJECTED/PROVIDER_VALIDATION_FAILED, provider_calls1, ไม่มีverifiedevidenceหรือpaid_at; การกดซ้ำคืนcachedrejection ไม่ได้เรียกproviderเพิ่ม ไม่ใช่หลักฐานว่าSQLsettlementล้ม
- สาเหตุpolicyข้อใดที่rejectครั้งแรกยังระบุไม่ได้ เพราะรายละเอียดvalidationไม่ได้persistไว้ ต้องดูResponseของrequestแรกหรือEasySlipรายการตรวจสลิปครั้งนั้น ห้ามรีเซ็ตattempt/reopen/โอนซ้ำเพื่อเดา
- แก้PaymentModalให้scrollไปfeedbackเมื่อerror/noticeเปลี่ยน เพราะผู้ใช้เลื่อนอยู่ช่วงuploadแล้วข้อความerrorด้านบนพ้นจอ; เพิ่มserverwarnเฉพาะorder/attempt/reason ไม่มีrawslip/providerpayload/credentialsสำหรับวิเคราะห์เคสครั้งถัดไป
- Browser9/9ผ่านที่360/390/1440: จำลอง422/202/409แล้วข้อความอยู่ในvisiblemodalและverifyหนึ่งครั้งต่อเคส ไม่มีbackendAPIwrites/provider/SMScalls หลักฐาน `.local-db/payment-feedback-1793440457876/`
- Fulltests234/234,TypeScript/lint/diffcheckผ่าน; ต้องdeployUI/servercodeใหม่ไปVercelก่อนใช้งาน ส่วนสลิปจริงเคสนี้ยังไม่ผ่านacceptanceและไม่อนุมัติPAIDด้วยมือ

## แก้ receiver ธนาคารกรุงเทพ — 31 ต.ค. 2026

- พบTSรับBANK_ACCOUNT002แต่finalizerยังล็อก004; เพิ่ม `20261031_payment_receiver_bank.sql` เปลี่ยนเฉพาะguardหนึ่งจุดโดยรักษาsnapshotidentity/name/amount/order/replay/sessionทั้งหมด
- อิสระreviewผ่านหลังแก้runnerJSreplacementtoken `$'` ด้วยcallbackพร้อมregression; deployreviewSHA `35695290f730f6d62df8fc7ceb71ef3da1d214a696217658e925c5b78e6ced31`
- ApplyในDBที่อ่านจาก `.env.production` โดยตรงแล้ว (ไม่อาศัย `.env.local`); backup `.local-db/backup-2026-10-31T09-20-54.249Z`; 30publictablesทุกrow/columnไม่เปลี่ยน functionACL/NORMAL/search_pathและschema/functionอื่นเหมือนเดิม
- Tests **234/234**,TypeScript,lint,diffcheckผ่าน; actual9migrationPGliteทดสอบBBL BANK_ACCOUNT+BBL PromptPay+KBank/replay/fullidentitynegatives/KIOSK/globalduplicateผ่าน รวมbaseline/reapplyrefusalไม่ทำข้อมูลเสีย
- ไม่เรียกSMS/EasySlipหรือโอนเงินจริง ไม่สร้างPAIDจำลองในDBจริง; **PAYMENT_TRANSFERS_ENABLEDยังfalse**
- ยังต้องdeploycodeล่าสุดไปVercel (localwebpolicy/UIมีchangesยังไม่ยืนยันdeployment), ตรวจconfig/branchพร้อม และrealQR/realSlipacceptanceครั้งสุดท้ายก่อนเปิดรับเงินจริง ดู `scripts/bangkok-receiver-uat-results.md`

## เปลี่ยนผู้รับบัญชี (local UAT only) — 24 ต.ค. 2026

- เจ้าของเลือก Bangkok Bank เท่านั้น และยืนยันเลขบัญชี/ชื่อที่ส่งในบทสนทนา; ปรับ `.env.local` ที่ถูก gitignored เป็น bank code 002 และชื่อ/บัญชีดังกล่าว ไม่บันทึกค่าลง Git/docs
- ล้าง PAYMENT_PROMPTPAY_MOBILE และตั้ง PAYMENT_TRANSFERS_ENABLED=false; จึงยังสร้าง order/QR หรือโอนจริงไม่ได้ ป้องกันเบอร์/บัญชี KBank เดิมถูกใช้ต่อโดยไม่ตั้งใจ
- ปรับ slip policy ให้รับ BANK_ACCOUNT ที่ matched bank code ตรงกับ snapshot แทน hardcode KBank; เพิ่ม regression fixture BBL 002 ที่ตรวจชื่อเต็ม/เลขเต็ม/เลข mask และปฏิเสธธนาคารอื่น
- Tests เฉพาะ payment30 ผ่านก่อนปรับเพิ่ม และ regressionsหลังแก้ 34/34 + TypeScript/lint ผ่าน
- **ยังไม่พร้อมเปิดรับเงินจริง:** ต้องยืนยันเบอร์ PromptPay ที่ผูกกับบัญชีกรุงเทพ (ไม่ใช้เบอร์ KBank เดิมโดยอนุมาน), ผูก/ลงทะเบียนบัญชีกรุงเทพกับ EasySlip v2 branch และทดสอบ QR/สลิปปลายทางในขั้นตอนสุดท้าย เจ้าของต้องยืนยันก่อน enable; Vercel/production ยังไม่เปลี่ยน

## รอบทดสอบอัตโนมัติเพิ่ม — 24 ต.ค. 2026

- **DBจริง installed schema/functions: 23 checksผ่าน** ผ่าน `scripts/real-modules-live-rollback-uat.mjs`: rewardscreate/redeem/stock/debit/replay/deliver, financeCRUD/version/audit/replay/role, friendcoupon grant/use/quota/guest/audit, bonusเพิ่มวันครั้งเดียว, cancel/deactivate, KIOSK/suspended/revokeddenial ทดสอบภายในsubtransactionแล้วrollback; hashข้อมูลทุกpublictableก่อน/หลังเหมือนเดิม ไม่มีPAID/SMS/providercalls ยกเว้นsequenceอาจขยับ
- **Browser/APIจริงซ้ำ54/54ผ่าน** `.local-db/real-modules-browser-2026-10-24T12-19-35.941Z/`; temporaryaccounts/sessionsล้างแล้ว สมาชิก/points/visits/couponsเดิมไม่เปลี่ยน
- **Native PostgreSQLหลายconnectionผ่าน8กลุ่ม** บนloopbackdisposableDB: stockสุดท้าย/debitreplay/delivery, duplicategrant/bonus, financesamekey/staleedit/delete, frontdeskwelcome replay, paymentclaim/transRef/paidreplay/packagecoupons, persistedpromoquotaสุดท้าย, rewardcatalogsave-vs-redeem4รอบ; ตรวจdistinctbackendPID ไม่ใช่WASM รายละเอียด `scripts/real-modules-local-postgres.md`; serverปิดและportclosedแล้ว ใช้libpqadapterไม่ใช่stockpsql และminimalbaseไม่ใช่schemaNeonเต็ม
- **UI/security121/121ผ่าน** `.local-db/real-ui-security-2026-10-24T12-32-50.980Z/`: 75role/page/viewportที่360/390/1440, XSStext, APIrole/method/CSRF/tamper, ownsessionrevoke, paymentread403/networktimeout/retry/disabledwhilebusy; ไม่สร้างorderหรือส่งสลิปจากbrowser
- พบบั๊กและแก้แล้ว: memberdetail360pxล้น379px → min-width/wrapping; PaymentModalย้ายfocusเข้าdialog/trapTab/Escape/คืนfocus/lockbodyscroll (Escapeไม่ปิดระหว่างกำลังทำคำขอ) ตรวจซ้ำ13failเดิมผ่านหมด
- Regression230/230,TypeScript,lint,diffcheckผ่าน; lintignoreเฉพาะ `.local-db` ซึ่งเป็นdownloadedtools/database/buildcopies ไม่ใช่source
- **สิ่งที่เหลือไม่ควรโยนให้ผู้ใช้:** coverageCRUDผ่านbrowserทุกstateยังไม่ครบแม้DBrollbackและAPIreadผ่าน, fullproduction-equivalentschema/load/poolและcontentionทุกแบบไม่ใช่สิ่งที่8racegroupsพิสูจน์, IDORexistingorderในbrowserและuploadproviderจริงยังไม่ได้เพิ่มในรอบนี้; ฟีเจอร์ขาดด้านล่างยังเป็นงานพัฒนา ไม่ใช่manualtestที่ผู้ใช้ต้องทำ
- **ผู้ใช้ลงมือเฉพาะ:** อุปกรณ์จริงกล้อง/USBถ้าต้องยืนยันเพิ่มเติมและเครื่องที่จะติดตั้งจริง; ยืนยันกฎ/ราคา/ของแถมและอายุคูปอง; productionOTP/ธนาคารเมื่อพร้อม โดยเปลี่ยนบัญชีรับเงินร้านเป็นขั้นท้ายสุด ห้ามเปลี่ยน/โอนเพิ่มล่วงหน้า

## ระบบ DB จริง — ผลล่าสุด 24 ต.ค. 2026 (ใช้แทนสถานะ mock ด้านล่าง)

- ผู้ใช้เปลี่ยนขอบเขตให้เลิก mock: สมาชิก/Dashboard/โปรไฟล์/wallet/rewards/checkin/finance/coupon/promo เชื่อมฐานข้อมูลจริงแล้ว; หน้า `/member/benefits` ไม่อ่าน browser business stores อีก
- Apply5migrationsในtransactionเดียวแล้ว: real_rewards,real_finance,real_frontdesk,real_benefits_admin,package_payment_benefits; backup `.local-db/backup-2026-10-24T11-34-08.894Z`; ตรวจข้อมูลเดิม20ตารางทุกoriginalcolumnไม่เปลี่ยน, ไม่มี historical grants/backfill, ไม่แตะOwner/passwordหรือsessionเดิม
- โมดูลใหม่มีrole/sessionguardsฝั่งAPIและSQL, idempotency/audit; rewardsหักแต้ม+stock+ledgeratomic, financeแยกmanualentriesจากPAIDorders, promoคำนวณจากDBตอนจองorder, packageของแถมตรงBUSINESSและแจกเมื่อPAIDครั้งเดียว
- Uploadตรวจsignature/MIME/streamlimitsและatomicfirst-photo guardแล้ว; testsใช้Cloudinarystub ไม่อ้างว่าexternaluploadผ่าน
- ชุดทดสอบล่าสุด **230/230ผ่าน**, TypeScriptและfulllintผ่าน; migrationchain/rollback/ACLผ่าน isolated WASM; paymentwrapper/helperและmoduleentrypointsrevokePUBLICEXECUTE/pinnedsearch_pathแล้ว
- Browser/APIต่อNeonจริง **54/54ผ่าน / runtimeerrors0**: OWNER/ADMIN/MEMBERชั่วคราวล็อกอินpasswordจริง, pages/APIs, profilepersist, tamperและCSRF; ล้างtemporaryaccounts/sessionsแล้ว originalmembers/points/visits/couponsไม่เปลี่ยน รายงาน `.local-db/real-modules-browser-2026-10-24T11-35-58.218Z/results.json`
- Productionbuildผ่าน `next build --webpack` บนสำเนาแยก `.local-db/real-modules-build-20261024/` ไม่ชนdev.next; มีwarningmultiplelockfilesจากสำเนาทดสอบเท่านั้น
- **ข้อจำกัดยังไม่ใช่production sign-off:** browserรอบนี้อ่านโมดูลและแก้profileบัญชีชั่วคราว ไม่ใช่CRUD/เงินจริง/rewardsครบทุกเส้นทางบนNeon; concurrencyหลายconnectionของโมดูลใหม่ยังต้องตรวจ; productionconfigurationยังไม่ทำ
- **ฟีเจอร์ที่ยังไม่ครบ ไม่ควรกล่าวว่าไม่มีงานค้าง:** เปลี่ยนเบอร์ด้วยOTPยังปิดไว้, memberdetailเป็นread-only, แลกคะแนนเป็นคูปอง/ผูกบัตรแข็ง/walk-inไม่สมัครเต็มยังไม่ได้เพิ่ม; catalogยังเป็นserver-authoritativecodeไม่ใช่DBadminCRUD; ไม่ย้ายข้อมูลเก่าในlocalStorageเข้าฐานให้อัตโนมัติ
- สมมติฐานของแถม: อายุคูปองตามmembership_expires_atของorder; BUSINESSยังไม่กำหนดอายุแยก ต้องยืนยันก่อนproduction ไม่แจกย้อนหลังให้orderเก่า

## Kiosk เข้าอย่างเดียว — 24 ต.ค. 2026

- ผู้ใช้อนุมัติ: เครื่องUSBหนึ่งเครื่อง, Enterท้ายรหัส (ไม่ดักครบ10ตัว), เข้าอย่างเดียว, ไม่เพิ่มแต้ม, samecode3วินาทีทั้งหน้าเว็บ/DB, คนละคนไม่ติดglobalcooldown
- ADMIN/OWNERเปิด `/admin/kiosk` → `/kiosk`; sessionปัจจุบันเป็นKIOSKฝั่งDBจนออกด้วยpassword ไม่ใช้เพียงซ่อนเมนู ไม่แก้role/เซสชันอื่น; fullscreenไม่ใช่OSlock
- DBmigration `20261024_kiosk.sql` appliedหลังreview/backup18ตาราง: `.local-db/backup-2026-10-24T07-03-23.548Z`; staff/sessionlocks, requestUUID+memberlocks, paid NORMAL predicatesทั้ง5functionsและcouponselfservice ป้องกันข้ามkiosk
- Browser/APIด้วยTEMPfixtures:58ผ่าน/1assertionmismatch ไม่ใช่securityfail (`/test`แสดงOWNER-onlyแทนredirect; parentตรวจภาพแล้วถูกป้องกัน ไม่มีprovidercall), runtimeerrors0 รายงาน `.local-db/kiosk-browser-2026-10-24T07-11-29.283Z/results.json`
- ทดสอบHTTPconcurrent samekey/differentkeyจริง, replay/bounce/couponUSED, เข้าอย่างเดียว/no points, modeguards/copiedcookie, wrong/correctexit/tokenrotation/othersession unaffectedผ่าน; TEMP/checkins/coupons/requestsล้างexactIDsและrevoke test sessionsแล้ว ข้อมูลเดิม20ตารางไม่เปลี่ยน
- Hardware จริงยืนยันแล้ว: CHIYPOS 4600S ตั้ง **Add CR suffix** ตามคู่มือที่มากับเครื่อง + Windows ENG; BLU-6 ปฏิเสธอัตโนมัติ, BLU-5 ผ่านครั้งแรกและสแกนซ้ำปฏิเสธ ผู้ใช้ออกจาก Kiosk ด้วยรหัสถูกได้
- ตรวจ Neon แบบ read-only หลัง hardware: BLU-5 visits=1/points=0/visit_points=0, coupon USED used_count=1/total_quota=1; BLU-6 visits=0/points=0, coupon used_count=0; kiosk_requests คนละ2รายการ ไม่ใช่ visit2ครั้ง ไม่มีแก้ข้อมูล/รีเซ็ตสิทธิ์
- Hardware fixtures `.local-db/kiosk-fixtures.json`; QR `.local-db/kiosk-qr/WELCOME.png`, `EXPIRED.png` พร้อมSVG; ห้าม consume/reset BLU-5 ซ้ำเพื่อทดสอบ
- Parentรันtests169/169,TypeScript,fulllintผ่าน `.local-db/final-test-2026-10-24-kiosk.txt`; ไม่ถือว่าทดสอบhardwareแล้ว

| ID | เคส | ผลที่คาดหวัง | สถานะ |
|---|---|---|---|
| KIOSK-01 | Staff/Ownerเข้าmodeด้วยsessionเดิม | เปลี่ยนmodeเฉพาะsession ไม่เปลี่ยนrole/othersession | PASS fixture browser/API; Ownerจริงรอmanual |
| KIOSK-02 | modeแล้วเปิดAdmin/member/money/upload/role APIs | ถูกป้องกันฝั่งserver copiedcookieใช้สิทธิ์NORMALไม่ได้ | PASS fixture API/pages; /testเป็นdeny-bannerไม่ใช่redirect |
| KIOSK-03 | พิมพ์code+Enter | อ่านcode/lowercase/whitespaceตามvalidation ไม่ใช้10digits | PASS keyboardจำลอง + USBจริง BLU-5/6 ด้วย Add CR suffix และ ENG |
| KIOSK-04 | samecodeซ้ำ3วินาที | BOUNCEไม่มีvisit/couponเพิ่ม ไม่checkout | PASS realAPI/DB + frontendtest; USBจริงNR |
| KIOSK-05 | คนละcodeต่อกัน | รับคนต่อไปทันทีหลังคำขอแรกจบ ไม่ติด3วิรวม | PASS TEMP API |
| KIOSK-06 | requestUUIDซ้ำ/concurrent | คืนผลเดิมเพิ่มcheckinครั้งเดียว; คนละcodeใช้keyเดิมถูกปฏิเสธ | PASS concurrentHTTP/TEMP |
| KIOSK-07 | สิทธิ์paid/ชั่วโมง/หมดอายุ/ฟรีครั้งเดียว | failclosedไม่มีสิทธิ์; welcomeconsume+visitatomic/no points | PASS SQL+TEMP APIตามreport; paidhardwareจริงNR |
| KIOSK-08 | Networktimeout | retryUUIDเดิม ไม่เดาสำเร็จ/สร้างvisitซ้ำ | offline coverage; manualnetworkNR |
| KIOSK-09 | ออกpasswordผิด/ถูก | ผิดยังKIOSK ถูกNORMALtokenใหม่ revokedoldtoken | PASS fixture browser/API; ผู้ใช้ยืนยันออกด้วยรหัสถูกจริง ส่วนรหัสผิดจริงยังไม่ยืนยัน |
| KIOSK-10 | sessionหมดอายุ/roleถูกถอด/stationผิด | scanไม่ได้ ไม่grantNORMALเอง | SQL coverage; livechanges/hardwareNR |
| KIOSK-11 | สแกนBLU-6จากUSBจริง | ค่าขึ้นinput+Enterเอง แล้วผลปฏิเสธ/ไม่เพิ่มvisit | PASS ผู้ใช้ยืนยัน + DB visits0/points0 |
| KIOSK-12 | สแกนBLU-5จากUSBจริง | ผ่านครั้งแรก ใช้welcome1/visit1/no points; หลัง3วิใช้ซ้ำไม่ได้ | PASS ภาพผู้ใช้ครั้งแรก/ซ้ำ + DB visits1/used1/points0; ช่วงเวลาระหว่างสแกนไม่มี timestamp ยืนยัน |

## ประวัติตรวจอัตโนมัติหลัง hardware ก่อนย้าย DB — 24 ต.ค. 2026

> สถานะ mock/upload/catalog ในส่วนนี้เป็นก่อนแก้ ดูผลล่าสุดด้านบน ไม่ใช้เป็นสถานะปัจจุบัน

- รันใหม่: `node --test src/lib/*.test.mjs src/lib/auth/*.test.mjs src/db/schema.test.mjs scripts/*.test.mjs` ผ่าน169/169; `pnpm exec tsc --noEmit` และ `pnpm lint` ผ่าน
- `node scripts/payment-sql-tests.mjs --run-memory` และ `node scripts/kiosk-sql-tests.mjs` ผ่าน isolated PostgreSQL WASM รวม compile migration จริงและ NORMAL predicates ของ payment5functions; ไม่ใช่ multi-connection proof
- Review เพิ่มพร้อม targeted isolated tests23ผ่าน (เป็นส่วนซ้อนกับ169 ไม่บวกเป็น192); ไม่มี SMS/provider call/เขียนDBจริงในรอบนี้ ไม่รัน build แข่งกับ dev server
- Scope gap: `src/app/member/AccountClient.tsx` ยังบันทึกโปรไฟล์ลง localStorage/OTPจำลอง ไม่ใช่ authoritative DB update; ไม่ควรอ้าง profile editing ผ่านจริง
- Upload review: `src/app/api/upload/route.ts` มี auth/role/MIME/5MB guards แต่ยังไม่พบ magic-byte validation และ first-photo guard แยกจาก DB update ต้องตรวจ/แก้ race ก่อนปิด PROFILE-06/07; รอบนี้ไม่ได้เรียก Cloudinary
- Catalog: `friendCoupons`/`bonusDays` ยัง0 ขัดของแถมใน BUSINESS.md; ORDER-10 ยังไม่ผ่าน และ admin member detail/dashboard ยังมี mock scope
- PaymentModal keyboard/focus ยังต้อง browser verification (focus trap/Escape/คืนfocus); policy/unit ผ่านไม่เท่ากับ UAT UI ผ่าน
- สิ่งที่ยังต้องผู้ใช้/อุปกรณ์: USB bounce ภายใน3วิ (สิทธิ์ BLU-5 ใช้แล้ว ห้าม reset อัตโนมัติ), bank-app QR/โอน/OTP ถ้าต้องตรวจเพิ่ม, production configuration/approval; fullscreen ไม่ใช่ OS lockdown

## ผลล่าสุด 23 ต.ค. 2026 — อ่านก่อน

- สร้างfixtureโดยผู้ใช้อนุมัติ: `BLU-3` MEMBER / `BLU-4` ADMIN; credentialsอยู่ `.local-db/role-uat-fixtures.json` protected/ignored ไม่ใส่ในเอกสาร
- Playwrightติดตั้งแยกใน `.local-db/role-browser` และใช้Chrome headless/browsercontextsแยกจริงแล้ว ไม่ใช้profile/session/passwordของผู้ใช้ และไม่มีBrowserMCPโดยตรง
- Rolebrowser/API:177checksผ่าน,1additional-smoke fail คือOwnerเปิดdetailของสมาชิกDBใหม่ไม่พบเพราะยังอ่านmock ไม่ใช่permissionbypass; report `.local-db/role-uat-2026-10-23T08-21-15.656Z/`
- Auth/OTPnegativeintegration75checksผ่าน/0fail; ใช้DBchallenges/ticketsของfixtures ไม่ส่งSMS ไม่ใช่proofpositiveSMSdelivery; `.local-db/auth-negative-uat-2026-10-23T08-28-07.144Z/report.json`
- StaffmockCRUD/desktop/mobile:23distinctsubcasesผ่านและcheckin390pxoverflow1fail; แก้แล้วretetestlayout360/390/1440และscannerempty20/20ผ่าน ไม่บวกจำนวนรวมกับรอบก่อนเพราะcoverageซ้ำ
- พบและแก้: rewardspageของสมาชิกจริงดูcatalogแบบread-onlyได้, migrationmockcollisionpreservegraph, mobilecheckinไม่ดันdocumentกว้าง ส่วนadminDBmemberdetailยังเป็นscopegap
- Suiteล่าสุด165/165ผ่าน; TypeScriptผ่าน; fulllint0errors0warnings รายงาน `.local-db/final-test-2026-10-23.txt`; baselineเก่า21fail/9errorsเป็นประวัติไม่ใช่สถานะล่าสุด
- ทุกชุดยืนยันข้อมูลเดิม18ตาราง/Ownerจริง/เงินไม่เปลี่ยน ยกเว้นsessions/loginlimitsของfixture; revoke test sessionsแล้ว Member/Staffคืนroleเดิม ไม่มีOTPส่งจริง/paidverify/orderใหม่
- **ต่อไป:** profile/memberdetailgapและAuth/APIที่ยังไม่ครอบคลุม, paymentnegative/concurrencyเพิ่มเติม, realcouponAPIreplay; USBscanner/กล้องจริงต้องผู้ใช้ช่วยเมื่อพร้อม

## จุดพักงาน / เริ่มต่อพรุ่งนี้ (22 ต.ค. 2026)

- ผู้ใช้ยืนยันเปิด/ปิดปุ่มตารหัสผ่านผ่านแล้ว ไม่เหมารวมkeyboardและทุกหน้าหลังบ้านที่ยังไม่ได้รายงาน
- ผ่านรอบนี้: สมัครOTPจริงBLU-2,welcomecouponDB30วัน,Cancel/ใช้1ครั้ง/ไม่เพิ่มแต้ม,logout/direct/member,passwordlogin,resetOTP+revoke sessionเก่าและloginรหัสใหม่; duplicate registration API409
- บัญชีปัจจุบัน `BLU-2` OWNER; คูปองต้อนรับUSED1/1, checkins1, points0 ไม่มีแพ็กเกจซื้อใหม่; `BLU-1`พักเบอร์และคงประวัติ100บาท/5แต้ม ห้ามลบ/ย้ายหรือparkซ้ำ
- **เริ่มต่อ ROLE-01..12:** เตรียมบัญชี/fixturesสำหรับMEMBER/ADMINอย่างปลอดภัย ไม่ลดOwnerหลัก/ส่งSMSเบอร์สุ่ม จากนั้นnegative Auth/OTP/coupon และpayment
- ยังต้องทดสอบรหัสเก่าหลังreset,OTPinvalid/expiry/replay/quotas,couponAPIreplay,IDOR/CSRF/backcache,concurrency และscanner/mock/productionตามscope
- Suiteตอนปิดรอบ:151testsผ่าน130ล้ม21 รายงาน `.local-db/final-test-2026-10-22-close.txt`; initial143/122/21เป็นประวัติ Full lintยัง9errors7warnings ไม่อ้างว่าทุกqualitygateผ่าน
- รอบบันทึกนี้แก้เอกสารเท่านั้น ไม่เปลี่ยนDB/env/rolesหรือส่งSMSเพิ่ม

## 1. วิธีใช้และสถานะ

- `NR` ยังไม่ทดสอบรอบนี้, `PASS` ผ่านพร้อมหลักฐาน, `FAIL` ผลไม่ตรง, `BLOCKED` ติด prerequisite, `USER_PASS` ผู้ใช้ยืนยัน, `HISTORY` หลักฐานรอบก่อน ไม่ใช่ retest รอบนี้
- `A` automated/offline, `B` browser/API จริง, `U` ทำร่วมกับผู้ใช้ (OTP/โอน/ฮาร์ดแวร์), `M` mock UX, `P` production-only
- เมื่อทดสอบให้แทน NR ด้วยผลจริง และอ้าง evidence/bug ID ในตารางผลท้ายเอกสาร ห้ามเปลี่ยนเป็น PASS จากการอ่านโค้ด
- เคสหนึ่งทดสอบได้หลายวิธี แต่ offline PASS ไม่ได้แปลว่า browser/บริการจริงผ่าน
- ส่วน Mock ผ่านได้เฉพาะ UX ที่ระบุ ไม่ถือว่าเชื่อมสิทธิ์/เงิน/ข้อมูลหลายเครื่องจริงแล้ว หากต้องการส่งมอบ production ต้องปิด scope gap หรือมีข้อตกลงตัด scope ชัดเจน
- `BLOCKED` และ `FAIL` ไม่ใช่ `N/A`; N/A ต้องมีเหตุผลและผู้อนุมัติ

## 2. ข้อตกลงความปลอดภัยและข้อมูลทดสอบ

1. ไม่ลบสมาชิกทั้งหมด ไม่ reset ตาราง ไม่แก้รหัส/ลด role Owner จริงเพื่อทดสอบ
2. Owner เดิมอยู่ browser profile เดิม; สมัครสมาชิกใหม่ใน profile แยก/Incognito เพื่อไม่ทับ session Owner
3. เตรียม Member A, Member B, Staff และบัญชี suspended เฉพาะทดสอบ หากยังไม่มีให้สร้างผ่าน flow หรือ isolated fixtures ที่ประกาศไว้ ห้ามสมมติว่าบัญชีจริงถูกระงับแล้ว
4. เบอร์รับ OTP ต้องผู้ใช้เป็นเจ้าของ/ยินยอม ห้ามยิง SMS ไปเบอร์สุ่ม; กรอก OTP/รหัสผ่านบนเครื่อง ไม่ส่งเข้าแชตหรือ logs
5. ผู้ใช้โอนเงินจริงเอง ตรวจชื่อผู้รับก่อนโอน ไม่โอนซ้ำเมื่อ pending; ใช้สลิปเดิมกับ negative tests เท่าที่ทำได้ โควตาได้รับอนุญาตแต่ไม่เรียกซ้ำโดยไร้เหตุผล
6. ถ้าจะทดสอบ timeout/DB failure/เปลี่ยนเวลาหรือ session ใช้ isolated environment ห้ามปิด DB หรือสับค่า payment key ของเครื่องที่กำลังรับโอน
7. หลักฐานห้ามมี password, OTP, API key, session cookie/hash, connection string หรือข้อมูลผู้โอนเกินจำเป็น; เก็บ artifacts แบบ ignored ใน `.local-db/`
8. Cleanup เฉพาะ test IDs/marker ที่บันทึกไว้; ไม่ลบ order PAID/transfer registry/audit เงินจริง ทดสอบ rejected/expired โดยไม่แก้ประวัติให้ดูผ่าน
9. Playwrightใช้browserแยกแล้วผ่าน `.local-db/role-browser` ไม่มีBrowserMCPโดยตรง; ไม่รัน `browser-admin.mjs` เก่าทั้งไฟล์เพราะอ้าง flowmockก่อนrealAuth; ใช้role-browser/staff-mock/checkin-layout UAT scriptsใหม่

### ใช้เบอร์เดียวทดสอบสมัครใหม่ (ดำเนินการแล้ว 2026-10-22)

- ผู้ใช้อนุมัติให้ย้ายเบอร์ Owner เก่าเป็นรหัสพักแทนลบถาวร และให้ยกบัญชีใหม่เป็น Owner หลังสมัครจริงสำเร็จ
- `BLU-1` ย้ายเป็น `TEST-PARKED-BLU-1` แล้ว พร้อม revoke sessions และ consume OTP/signup/password tickets ที่ค้าง เบอร์จริงว่างสำหรับ REG-01 ไม่ได้สร้างสมาชิก/ticket/login โดยข้าม OTP
- สำรองครบ18publictables: `.local-db/backup-2026-10-22T12-25-15.963Z`; recoveryrecord `.local-db/owner-phone-uat.json` (ignored/protected)
- ตรวจข้อมูล6financialtablesเทียบbackupไม่เปลี่ยน; ประวัติ100บาท/5แต้มยังเป็นของบัญชีเก่า ไม่ย้ายสิทธิ์โดยอัตโนมัติ
- ผู้ใช้สมัครผ่านOTPจริงและตั้งรหัสเองแล้ว: `BLU-2` เริ่มroleMEMBER/statusPENDING/points0, welcomeFREE_ENTRY quota1 อายุ30วัน; ตรวจDBแล้วและoperatorยกเป็นOWNERตามอนุมัติ ไม่ออกsessionหรือสร้างpasswordแทน
- ประวัติ100บาท/5แต้มยังอยู่ `BLU-1` ไม่ย้ายให้ `BLU-2`; บัญชีใหม่ไม่มีแพ็กเกจ/แต้มก่อนซื้อเป็นผลถูกต้อง
- Operator helper `scripts/owner-phone-uat.mjs`: `--promote` preview หลังgenuineOTPregistration, `--promote --apply` เมื่อตรวจบัญชีใหม่ครบ; `--restore`/`--restore --apply` คืนเบอร์ให้Ownerเดิมได้เฉพาะยังไม่มีบัญชีใหม่ครอบครองเบอร์ ไม่ออกsessionเอง

## 3. Baseline ที่มีหลักฐานแล้ว

| รายการ | ผล | หลักฐาน/ข้อจำกัด |
|---|---|---|
| ตั้งรหัสครั้งแรกด้วย OTP และล็อกอิน Owner | USER_PASS 2026-10-22 | ผู้ใช้ยืนยันสำเร็จและเปิด `/test` ได้; ไม่ถือว่าสมัครใหม่/ลืมรหัสผ่านแล้ว |
| ส่ง SMS/เครดิต | USER_PASS | ผู้ใช้ทำ setup flow สำเร็จ; ภาพเครดิต standard 9 corporate 2596 ต้องตรวจชื่อผู้ส่งบนมือถือหากต้องการ sign-off sender |
| โอนจริง PromptPay 100 บาท | HISTORY 2026-10-10 | order `fa7ebd15-3951-4eed-914d-0c70f841458d`, transRef `Acb0e9d77c0604926`, PAID + รายวัน +5 แต้ม |
| paid-finalizer replay บน Neon 2 ครั้ง | HISTORY | วัน/แต้มไม่เพิ่มซ้ำ ledger/registry อย่างละ1; ไม่ใช่ browser upload replay |
| TypeScript | PASS 2026-10-23 | `pnpm exec tsc --noEmit --incremental false` exit0 |
| automated suite รวมล่าสุด | PASS 2026-10-24 | 169/169ผ่าน `.local-db/final-test-2026-10-24-kiosk.txt`; 165/165และbaselineก่อนหน้าเป็นประวัติ |
| `pnpm lint` | PASS 2026-10-23 | 0errors0warnings หลังแก้typing/asyncGET/storelanguage; ไม่ปิดrulesเพื่อซ่อนerror |
| Production deployment | BLOCKED / ยังไม่รันทดสอบ | รอบนี้ทดสอบ local ไม่รับรอง Vercel/โดเมนจริง |

คำสั่ง baseline:

```sh
pnpm exec tsc --noEmit
node --test src/lib/*.test.mjs src/lib/auth/*.test.mjs src/db/*.test.mjs scripts/*.test.mjs
pnpm lint
# เมื่อเหมาะสมและไม่ชน dev server ของผู้ใช้
pnpm build
```

อย่ารัน scripts migration/fixtures บน DB จริงตามชื่อโดยไม่อ่าน safety guards ก่อน โดยเฉพาะ applied migration ห้าม apply ซ้ำ

## 4. เตรียมระบบและหน้าแรก

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| ENV-01 | เปิดเว็บและโหลดใหม่ | ไม่มีหน้าว่าง/uncaught error | B | NR |
| ENV-02 | เปิดหน้าแรก/แพ็กเกจ | ชื่อ ราคา จำนวนวัน ช่วงเวลาตรง catalog server | B | NR |
| ENV-03 | สลับไทย/อังกฤษแล้ว refresh | ภาษาคงที่ ข้อความและปุ่มไม่หาย | B | NR |
| ENV-04 | API key/receiver/env ของรอบทดสอบ | server-only; ชื่อผู้รับถูก และแยก local/production | A+B | NR |
| ENV-05 | ปิด localStorage ใน browser แยก | แจ้งความผิดพลาดตามส่วน ไม่ fallback สำเร็จปลอม | B | NR |
| ENV-06 | ตรวจ browser console/network | ไม่มี secrets และ errors ที่ทำ flow หยุด | B | NR |

## 5. สมัครสมาชิก

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| REG-01 | เบอร์ใหม่ → OTP → profile/password → สมัคร | สมาชิกจริง1ราย sessionถูกต้อง role MEMBER | B+U+DB | PASS |
| REG-02 | เบอร์ที่สมัครอยู่แล้ว | ปฏิเสธ ไม่สร้างสมาชิก/คูปองซ้ำ | API+DB | PASS (API); UIรอretest |
| REG-03 | รูปแบบ 0xxxxxxxxx กับ +66 เบอร์เดียวกัน | normalize เป็นคนเดียว ไม่หลบ duplicate | A+B | NR |
| REG-04 | เบอร์ไม่ครบ/อักขระ/หลายเบอร์ | ปฏิเสธก่อนส่ง SMS | A+B | NR |
| REG-05 | ชื่อ ชื่อเล่น เพศ วัน/เดือนเกิด และข้อมูลฉุกเฉิน | บันทึกตรง DB; ไม่มีปีเกิดที่ไม่ต้องการ | B | NR |
| REG-06 | วันเดือนผิด เช่น 31 ก.พ. และขนาดข้อมูลเกิน | validate server ไม่สร้างข้อมูลผิด | A+B | NR |
| REG-07 | รหัสผ่านสั้นกว่า10/ยาวเกิน128/ยืนยันไม่ตรง | ปฏิเสธ แจ้งชัด ไม่บันทึกรหัสผ่าน plaintext | A+B | NR |
| REG-08 | ใช้ registration ticket ซ้ำ/หมดอายุ/ผิด purpose | ปฏิเสธ ไม่มีสมาชิก/สิทธิ์เพิ่ม | A+B | NR |
| REG-09 | double click/คำขอสมัครพร้อมกัน | สมาชิกและ welcome coupon อย่างละ1 | A+B | NR |
| REG-10 | network/DB error ระหว่างสมัคร | ไม่สำเร็จบางส่วน ไม่แจ้งสำเร็จก่อน commit | A | NR |

## 6. รหัสผ่าน / Session

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| AUTH-01 | Owner ตั้งรหัสครั้งแรกและล็อกอิน | OTP verified → password → login Owner | U+B | USER_PASS |
| AUTH-02 | เข้าระบบด้วยเบอร์+รหัสถูก | ได้ session; ไม่ส่ง OTP ตอน loginปกติ | B+U | USER_PASS |
| AUTH-03 | รหัสผิด/เบอร์ไม่มีในระบบ | error generic ไม่เปิดเผยสมาชิก/ไม่เข้าได้ | A+B | NR |
| AUTH-04 | login ผิดเกิน quota | จำกัด5ครั้ง/15นาที/เบอร์ตาม policy ไม่ bypassด้วย concurrent | A+B | PASS API 5x401→429/windowreset; concurrentยังไม่รัน |
| AUTH-05 | refresh/เปิดแท็บใหม่หลัง login | sessionยังใช้ได้ roleและบัญชีถูก | B | NR |
| AUTH-06 | logout แล้ว back/directURL/API | sessionเก่าใช้ไม่ได้ ไม่คืน private data | A+B | USER_PASS (/member direct); API/backรอtest |
| AUTH-07 | ลืมรหัสของ Memberทดสอบ | OTP reset → passwordใหม่เข้าได้ เก่าเข้าไม่ได้ | B+U | USER_PASS (reset+รหัสใหม่); รหัสเก่ารอnegative |
| AUTH-08 | reset แล้วใช้ sessionอุปกรณ์เดิม | ถูก revoke ต้องloginใหม่ | B+U | USER_PASS |
| AUTH-09 | ตั้งครั้งแรกกับบัญชีที่มี passwordแล้ว | ไม่เปิดช่องตั้งใหม่โดยไม่มี reset flow | A+B | NR |
| AUTH-10 | ใช้ recovery ticketซ้ำ/เก่า/ผิด purpose | ปฏิเสธ ไม่มีเปลี่ยนรหัส/ข้ามOTP | A+B | PASS fixture API expired/consumed/scope/replay |
| AUTH-11 | OTP/ticketที่ออกก่อนเปลี่ยนรหัส | หลังเปลี่ยนใช้ซ้ำไม่ได้ รวม verify/reset race | A+B | PASS fixture stalehash; concurrentraceยังไม่รัน |
| AUTH-12 | suspended member login/session | ไม่มีสิทธิ์ใช้ระบบ แม้มีcookieเดิม | A+B | NR |
| AUTH-13 | ตรวจcookieและresponse/browserstorage | HttpOnly/SameSite, SecureบนHTTPS; ไม่มีpasswordhash/OTP/tokenในstorage | A+B+P | NR |
| AUTH-14 | เรียก LOGIN OTP endpointเดิม | ปิดใช้; verifyไม่ออก login session | A+B | PASS localAPI+legacychallengefixture |
| AUTH-15 | ปุ่มตาทุกช่องpassword/confirmรวมหลังบ้าน | ซ่อนเริ่มต้น เปิดปิดแยกช่อง ปุ่มไม่submit/ไม่แก้ค่า constraintsเดิมครบ และใช้keyboardได้ | A+B | OfflinePASS + USER_PASSเปิดปิด; keyboard/ทุกหน้ารอtest |

## 7. SMS / OTP

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| OTP-01 | ส่ง SMS ทดสอบและดูมือถือ | ข้อความถูกเบอร์และชื่อผู้ส่งที่อนุมัติ; ไม่ใช่แค่creditAPIผ่าน | B+U | NR |
| OTP-02 | ขอREGISTER/SETUP/RESET OTP | purposeถูก ไม่มีการส่ง loginOTPทั่วไป | A+B+U | NR |
| OTP-03 | กรอกรหัสถูกใน5นาที | ticketถูกscope ใช้ได้ครั้งเดียว | B+U | NR |
| OTP-04 | รหัสผิดและเกินจำนวนครั้ง | ปฏิเสธ/ล็อก challenge ตาม policy | A+B | PASS localAPI/DBfixture ไม่ส่งSMS |
| OTP-05 | รหัสหมดอายุ | ไม่ออกticket ไม่สร้างsession | A+B | PASS localAPI/DBfixture |
| OTP-06 | ขอใหม่แล้วใช้รหัสเก่า | challengeเก่าถูกปฏิเสธ | A+B+U | PASS newerfixture; ขอSMSใหม่จริงยังไม่retest |
| OTP-07 | ขอถี่/เกิน1นาที,3ต่อชั่วโมง,10ต่อวัน | ไม่ส่งเกินquota; ไม่วนยิงเบอร์จริงเพื่อทดสอบทุกlimit | A | NR |
| OTP-08 | SMS timeout/เครดิตหมด/providerไม่พร้อม | fail closed ไม่มีรหัสสำรอง/mock login; แจ้งไม่กดซ้ำทันที | A | NR |

## 8. สิทธิ์ — ต้องตรวจทั้ง UI และ server

| ผู้ใช้ | ส่วนสมาชิกของตน | checkin / rewards / promo-codes / coupons | overview / members / finance | เปลี่ยนrole / test / payment operations |
|---|---|---|---|---|
| Guest | ไม่ได้ | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| MEMBER | ได้ | ไม่ได้ | ไม่ได้ | ไม่ได้ |
| ADMIN พนักงาน | ได้ | สร้าง/แก้/แจก/ใช้ได้ตามโมดูล | ไม่ได้ | ไม่ได้ |
| OWNER | ได้ | ได้ | ได้ | ได้ตามข้อจำกัดของแต่ละAPI |

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| ROLE-01 | Guest เปิด /member, benefits, rewards | ต้องlogin ไม่เห็นprivate data | B | PASS Playwright |
| ROLE-02 | Guest เปิดทุก /admin URL /test และAPI | ปฏิเสธ ไม่เห็นข้อมูล/ไม่เกิดmutation | A+B | PASS หน้าและAPIsที่ระบุในrole-report; uploadยังไม่ครอบคลุม |
| ROLE-03 | MEMBER เปิดadminทุกเมนู/URLตรง/API | ปฏิเสธ ไม่อาศัยซ่อนnavอย่างเดียว | A+B | PASS role-report (ไม่รวมAPIที่ยังไม่ระบุ) |
| ROLE-04 | ADMIN เปิด /admin | ไปหน้าstaffที่อนุญาต ไม่เห็นoverview | B | PASS →/admin/checkin |
| ROLE-05 | ADMIN ใช้สี่โมดูลครบcreate/edit/grant/redeem | ทำงานได้ตามUIที่เป็นmockและบอกขอบเขตชัด | B+M | PARTIAL:mockCRUD/grant/redeem/checkinผ่านตามstaffreport; allcommit/rewardspendยังไม่รัน |
| ROLE-06 | ADMIN เปิดoverview/members/detail/financeตรง | ปฏิเสธทั้งpageและข้อมูลที่ไม่อนุญาต | B | PASS Playwright |
| ROLE-07 | ADMIN เรียกrole/test/upload/paymentoperations | ปฏิเสธส่วนที่OWNER-only; profileuploadเฉพาะตนตามpolicy | A+B | PARTIAL:role/test/payment403ผ่าน; uploadยังไม่ทดสอบ |
| ROLE-08 | OWNER เปิดทุกเมนู | เห็นเมนู/ข้อมูลตามสิทธิ์ ไม่แสดงmockเป็นการเงินจริง | B | PARTIAL:7adminpages/testผ่าน; detailDBmemberไม่พบ=MEMBER-DB-GAP |
| ROLE-09 | OWNER ตั้ง/ปลดADMINเฉพาะบัญชีtest | persisted roleเปลี่ยน serverguardตอบตามroleใหม่ | A+B | PASS APIจริง same-sessionguard + protectOwnerfixture |
| ROLE-10 | ADMIN/MEMBER แก้roleในlocalStorage/request | ยกระดับสิทธิ์จริงไม่ได้ | A+B | PASS roleAPI403; localStorageforgeryยังไม่browsertest |
| ROLE-11 | MEMBER A อ่าน/ใช้order/couponของB | ปฏิเสธ IDOR แม้รู้ID | A+B | PASS orderจริงของคนอื่น404/unusedforeigncoupon409สองทิศและno consume |
| ROLE-12 | cross-origin POST/logout/upload/role/payment | CSRFถูกปฏิเสธก่อนmutation/paidcall | A+B | PARTIAL:logout/role/paymentoperations403ผ่าน; upload/checkoutยังไม่APIintegration |

## 9. Account / โปรไฟล์ / รูป

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| PROFILE-01 | AccountแสดงmemberCode/ชื่อ/วันที่สมัคร | ข้อมูลตรงบัญชีปัจจุบัน ไม่ดึงอีกคนจากmock | B | NR |
| PROFILE-02 | admin memberdetailมีชื่อเล่น | อ่าน/แก้แล้วคงค่าในstorageที่โมดูลใช้; ไม่อ้างDBsyncหากยังmock | B+M | NR |
| PROFILE-03 | เปลี่ยนบัญชี/logout/loginอีกคน | ไม่เห็นข้อมูลprivateค้างจากบัญชีเดิม | B | NR |
| PROFILE-04 | แก้ชื่อ/วันเกิด/ฉุกเฉิน | validationตรง แจ้งชัดว่าmockหรือDB | B+M | NR |
| PROFILE-05 | เปลี่ยนเบอร์ในAccount | ต้องOTPจริงก่อนเป็นข้อมูลauthoritative; ถ้ายังmock123456ให้SCOPE_GAP ไม่PASSproduction | B+M | NR |
| PROFILE-06 | อัปโหลดรูปที่ถูกต้อง/ขนาดเกิน/MIMEปลอม | session/owner checkถูก; ไม่รับSVG/ไฟล์ปลอม; privacyถูก | A+B+U | NR |
| PROFILE-07 | รูปครั้งแรกและข้อห้ามแก้รูปเอง | ทำตามกติกา ไม่มีURLข้ามเจ้าของหรือเปลี่ยนซ้ำโดยไม่อนุญาต | B | NR |

## 10. คูปองแรกสมัครจริง

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| WELCOME-01 | สมัครMemberใหม่สำเร็จ | FREE_ENTRY quota1 อายุ30วัน sourceเฉพาะ DB | B+U+DB | PASS |
| WELCOME-02 | login/refresh/requestสมัครซ้ำ | ไม่แจกคูปองซ้ำ ไม่เพิ่มแต้มจากสมัคร | A+B | NR |
| WELCOME-03 | Owner/สมาชิกเดิมเปิดwallet | ไม่แจกwelcomeย้อนหลัง | B | NR |
| WELCOME-04 | ใช้คูปองและยืนยัน | ใช้1ครั้ง มีcheckin/auditในDB ไม่เติมแพ็กเกจ/แต้มผิด | B+U+DB | PASS |
| WELCOME-05 | doubleclick/redeemซ้ำ/พร้อมกัน | ใช้ได้ครั้งเดียว ไม่checkinซ้ำ | A+B | NR |
| WELCOME-06 | คูปองหมดอายุ/ของคนอื่น/suspended | ใช้ไม่ได้ | A+B | NR |
| WELCOME-07 | ตรวจกติกาหน้าร้าน | ปัจจุบันสมาชิกยืนยันใช้เอง ไม่ถือว่าพนักงาน/เครื่องสแกนเชื่อมครบ | B+M | NR |
| WELCOME-08 | เปิดเมนูคูปองด้านล่างใน /member และ /member/benefits | แสดงwelcomecouponจริงตรงDB ไม่แสดงว่าwalletว่างเพราะอ่านแต่mock | B | USER_PASS (/member); /member/benefits รอretest |
| WELCOME-09 | กดใช้แล้วCancel รีเฟรชและเปิดwalletใหม่ | ยังAVAILABLE/used0 ไม่เกิดcheckinหรือแต้มเพิ่ม | B+U+DB | PASS |
| WELCOME-10 | logout/loginใหม่แล้วเปิดwallet | couponยังUSED ไม่สร้าง/ให้ใช้ซ้ำหลังsessionเปลี่ยน | B+U | USER_PASS |

## 11. แพ็กเกจ / Order / QR

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| ORDER-01 | เลือกpackageและสร้างorder | serverคำนวณยอด/วัน/แต้ม/receiverเก็บsnapshot | A+B | NR |
| ORDER-02 | สแกนQRก่อนโอน | PromptPay/ชื่อผู้รับ/ยอดตรงorder ไม่โอนเพื่อเช็คทุกแพ็กเกจ | B+U | NR |
| ORDER-03 | แก้amount/discount/days/pointsจากclient | ปฏิเสธ ไม่มีorderยอดปลอม | A+B | NR |
| ORDER-04 | promoถูก/ผิด/หมดอายุ/minimum/maxdiscount | ราคาและข้อจำกัดถูกจากserver | A+B | NR |
| ORDER-05 | เปลี่ยนpromo/กดcreateซ้ำ/networkretry | idempotent ไม่สร้างรายการซ้ำหรือใช้quotaโปรซ้ำ | A+B | NR |
| ORDER-06 | กลับหน้าเดิม/refresh/เลือกpackageอื่นมีpending | โหลดรายการค้าง ชื่อและยอดไม่สับสน ไม่ชวนโอนซ้ำ | B | NR |
| ORDER-07 | orderเกิน15นาที/เลยuploadgrace | ไม่แสดงQRให้โอนใหม่ แยกเวลาส่งสลิปกับเวลาโอน | A+B | NR |
| ORDER-08 | order rate limit/promoquotaคำขอพร้อมกัน | คุมจำนวนจริง ไม่ขายpromoเกิน ไม่lockไร้คำอธิบาย | A+B | NR |
| ORDER-09 | แพ็กเกจฟรี/ส่วนลดจน0/ปิดขาย/IDปลอม | ปฏิเสธ flowเงินจริงที่ไม่รองรับ ไม่มีfreepurchaseหลุด | A+B | NR |
| ORDER-10 | เทียบcatalogกับ BUSINESS.md ของแถม/รายวัน | ราคา/วัน/bonusตรงข้อตกลง; ถ้าcatalogไม่มีของแถม/guestwalkinต้องบันทึกSCOPE_GAP ไม่สรุปผ่าน | B | NR |

## 12. EasySlip / ชำระจริง / แต้ม / ต่ออายุ

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| PAY-01 | โอนยอดตรงเข้าบัญชีตามorderแล้วแนบ | PAID + expiry/แต้ม/ledgerครบในDB | B+U | HISTORY |
| PAY-02 | ผู้รับPromptPayถูก raw bankไม่มี | full matchedmobile/nameตรง; maskไม่ขัด ยอมรับตามstrategy | A+B+U | HISTORY |
| PAY-03 | ผู้รับbank004ถูกและชื่อrawถูกตัด | matchedfullaccount/nameตรง ผ่านโดยไม่เชื่อrawชื่ออย่างเดียว | A+B+U | NR |
| PAY-04 | สลิปโอนให้คนอื่นแต่ธนาคารเดียวกัน | ไม่เพิ่มสิทธิ์/แต้ม matchedผิด/nullไม่ผ่าน | A+B | NR |
| PAY-05 | ยอดน้อย/มาก/เศษสตางค์ไม่ตรง | ปฏิเสธ ไม่ปัดให้ผ่าน | A+B | NR |
| PAY-06 | เลขผู้รับmask/nameคล้ายแต่fullmatchผิด | ไม่ผ่าน ไม่เชื่อsuffixหรือชื่ออย่างเดียว | A+B | NR |
| PAY-07 | รูปแต่งยอด/ผู้รับแต่QRเดิม | ใช้ธุรกรรมจากproviderไม่อ่านข้อความแต่งเป็นหลักฐาน | A+B | NR |
| PAY-08 | รูปไม่มีQR/เสีย/ใหญ่กว่า4MB/MIMEปลอม | ปฏิเสธ ไม่มีpaidcallเมื่อไฟล์ผิดตั้งแต่server | A+B | NR |
| PAY-09 | สลิปเก่าก่อนorder/โอนหลังexpiry | ปฏิเสธตามtimewindow | A+B | NR |
| PAY-10 | โอนก่อนexpiryแต่แนบหลังexpiryใน30นาที | อนุมัติเมื่อเงื่อนไขอื่นครบ และpromoยังreserved | A+B | NR |
| PAY-11 | paidorderส่งซ้ำ/กดพร้อมกัน | คืนผลเดิม ไม่เพิ่มวัน/แต้ม/ledger/refซ้ำ | A+B | HISTORY |
| PAY-12 | transRefเดิมใช้orderใหม่/บัญชีใหม่/รูปครอปใหม่ | ไม่ได้สิทธิ์ซ้ำ กันด้วยDBuniqueไม่ใช่imagehashอย่างเดียว | A+B | NR |
| PAY-13 | verifyพร้อมกันคนละorderใช้refเดียว | PAIDได้รายการเดียว อีกอันterminalและaudit ไม่เพิ่มสิทธิ์ซ้ำ | A | NR |
| PAY-14 | timeout/providererror/HTTP200bodyไม่ครบ | UNKNOWN/ไม่อนุมัติ ไม่fallbackmock ไม่retryเสียquotaลับ | A+B | NR |
| PAY-15 | providerสำเร็จแต่DB/networkล้มหลังevidence | retryfinalizeจากหลักฐานเดิม ไม่paidcall/สิทธิ์ซ้ำ | A | NR |
| PAY-16 | แพ็กเกจยังactiveซื้อเพิ่ม | ต่อจากexpiryเดิมครบ ไม่ตัดวัน | A+B | NR |
| PAY-17 | expired/inactiveซื้อใหม่ | เริ่มเวลายืนยันสำเร็จ ไม่ย้อนหลัง ทำstatusสอดคล้อง | A+B | NR |
| PAY-18 | แต้มจากยอดหลังส่วนลด 20บาท/แต้มปัดลง | ยอด/points/ledgerตรง; สมัคร/checkinไม่เพิ่มแต้ม | A+B | NR |
| PAY-19 | readaccount/refresh/reloginหลังpaid | expiry/แต้ม/ประวัติจริงตรงDB ไม่ใช่localStorage | B | NR |
| PAY-20 | ธุรกรรมขัดข้องระหว่างsettle | rollbackทุกส่วน ไม่มีpaidแต่ไม่เพิ่มสิทธิ์หรือเพิ่มแต้มครึ่งเดียว | A | NR |

## 13. Recovery / Audit / Operations

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| REC-01 | Unknownรีบกดretry/คนละรูป/เกินlimit | จำกัดcooldown/รูปเดิม/จำนวนcalls ไม่มีโอนซ้ำ | A+B | NR |
| REC-02 | PromptPay oldvalidation recoveryเคสเดิม | Owner ownorder +audit+ภาพเดิม ใช้จำกัดครั้ง ไม่manualPAID | A+B | HISTORY |
| REC-03 | MEMBER/STAFF ขอOwnerrecheck/reject/list | ปฏิเสธ ไม่มีmutationsหรือข้อมูลคนอื่นหลุด | A+B | NR |
| REC-04 | OWNERปิดUNKNOWNเมื่อเลยgraceพร้อมbank/providerproof | REJECTED+audit ไม่สร้างrefund/PAIDเอง | A | NR |
| REC-05 | ownerไม่มีreason/proof/attemptยังใหม่/paidแล้ว | ปฏิเสธ ห้ามmanualoverrideเพื่อdemo | A+B | NR |
| REC-06 | แก้snapshot/evidence/audit/terminalโดยSQLfixture | immutableguardsป้องกัน ไม่มีลบหลักฐานเงิน | A | NR |

## 14. Check-in / อุปกรณ์ (ขณะนี้ส่วนใหญ่ Mock)

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| CHECK-01 | ค้นmembercode/physicalcardที่มีและไม่มี | พบคนถูก/แจ้งไม่พบ ไม่เลือกสมาชิกเงียบๆ | B+M | NR |
| CHECK-02 | สแกนcodeซ้ำ/เร็ว/หลายครั้ง | ตามกติกาเข้าออกและกันซ้ำ ไม่ทำประวัติผิด | B+M | NR |
| CHECK-03 | หมดอายุ/pending/suspended | เตือนหรือปฏิเสธตามrule ไม่อ้างmockเป็นrealaccess | B+M | NR |
| CHECK-04 | OffPeakก่อน/หลัง14น.และAllDayขอบเขต | Asia/Bangkokถูกตามpackage ไม่แก้เวลาระบบจริง | A+M | NR |
| CHECK-05 | USB4600sส่งcode+Enter/ถอดเสียบ | inputfocusถูก สแกนได้ไม่มีsubmitผิดmodal | U+M | NR |
| CHECK-06 | กล้องอนุญาต/ปฏิเสธ/ไม่มีcamera | scanถูกหรือerrorมีทางใช้manual ไม่หน้าว่าง | U+M | NR |
| CHECK-07 | เปิดmodalยืนยันระหว่างscannerทำงาน | scanไม่หลุดไปทำmutationอื่น Enterไม่ยืนยันแทนconsent | B+M | NR |
| CHECK-08 | Check-inประวัติวันนี้และคะแนน | เวลาและสมาชิกถูก ไม่เพิ่มแต้มจากcheckin | B+M | NR |
| CHECK-09 | ซื้อDBจริงแล้วสแกนอีกเครื่อง | หากยังไม่เชื่อมต้องBLOCKED/SCOPE_GAP ไม่PASSด้วยmock | B | NR |

## 15. Rewards / Promo / Coupon Admin (Mock แยกจากเงินจริง)

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| BENEFIT-01 | สร้าง/แก้/ปิดrewardนิยาม | fieldsvalidate/รหัสไม่ซ้ำ/statusตรง | B+M | NR |
| BENEFIT-02 | สร้างcouponทุกประเภทและเปลี่ยนtype | unitตรงบาท/%/วัน/ครั้ง/รายการ ไม่คงหน่วยผิดจากtypeเดิม | A+B+M | NR |
| BENEFIT-03 | จำนวน/อายุ/quotaติดลบ0เกินขอบ | ปฏิเสธตามvalidation ไม่สร้างสิทธิ์ผิด | A+B+M | NR |
| BENEFIT-04 | แจกเลือกคน/ทุกคน/สแกนรายชื่อซ้ำ | previewถูก ต้องconfirmชัด ไม่แจกคนเดิมซ้ำโดยไม่ตั้งใจ | A+B+M | NR |
| BENEFIT-05 | แจกกับใช้couponแยกกัน | แจกไม่ถือว่าใช้; code/QRตรงpersistedgrant | A+B+M | NR |
| BENEFIT-06 | redeemถูก/ผิด/หมดอายุ/used/ระงับ | สถานะและประวัติถูก ไม่consumeซ้ำ | A+B+M | NR |
| BENEFIT-07 | แลกแต้มพอ/ไม่พอ/ของหมด/พร้อมกัน | หักแต้มและสร้างredemptionพร้อมกัน ไม่ติดลบ | A+B+M | NR |
| BENEFIT-08 | storageล้ม/ข้อมูลเสีย/migrationmock | failclosed ไม่resetสิทธิ์เอง/ไม่แจ้งsuccessก่อนpersist | A+B+M | NR |
| BENEFIT-09 | refresh/อีกแท็บสถานะสิทธิ์ | ไม่doubleuseหรือข้อมูลทับ; แยกข้อจำกัดmockข้ามเครื่อง | A+B+M | NR |
| BENEFIT-10 | promoAdminแจกไปลดrealorder | ต้องไม่ลดเงินจริงถ้าgrantยังไม่serverauthoritative; บันทึกgap | A+B | NR |
| BENEFIT-11 | แต้มDBจริงเอาไปแลกmockshop | ห้ามอ้างหักแต้มDBแล้วถ้ายังไม่เชื่อม; บันทึกgapชัด | B | NR |

## 16. Finance / Members Admin / Dashboard (Mock)

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| ADMIN-01 | ค้น/กรอง/เปิดสมาชิกตามcode | ข้อมูลคนถูก ชื่อเล่นครบ ไม่ปะปนmemberDBกับmock | B+M | NR |
| ADMIN-02 | แก้สมาชิกmockและrefresh | fieldsvalidation/roleไม่ยกระดับDBจากmock | B+M | NR |
| ADMIN-03 | Finance manualincome/expense | ยอดและประเภทถูก ต้องยืนยัน | B+M | NR |
| ADMIN-04 | แก้/ย้อนรายการFinance | ต้องเหตุผล เก็บประวัติ ไม่ลบเงียบๆ | B+M | NR |
| ADMIN-05 | รายรับอัตโนมัติไม่แก้เหมือนmanual | รักษาหลักฐานและแหล่งที่มา | B+M | NR |
| ADMIN-06 | filterวัน/รวมยอด/รายงาน | เวลาไทยและยอดถูกในdatasetนั้น ไม่รวมเงินซ้ำ | B+M | NR |
| ADMIN-07 | realorder100บาทเข้าFinance | ถ้ายังไม่เชื่อมให้BLOCKED/SCOPE_GAP ไม่ถือว่า0คือรายรับจริง | B | NR |

## 17. UX / Security / Final gates

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| UX-01 | มือถือ360/390pxและdesktop | ไม่มีoverflow/ปุ่มสำคัญหลุดviewport อ่านยอดและerrorได้ | B | NR |
| UX-02 | เปิดpayment/confirmmodalและkeyboard | scroll/focus/ปิด/disabledระหว่างrequestถูก ไม่submitซ้ำ | B | NR |
| UX-03 | error403/401/networktimeout | อ่านได้บนพื้นหลัง มีทางlogin/retry ไม่หน้าว่าง | B | NR |
| UX-04 | sessionหมดอายุขณะทำรายการ | ไม่เปลี่ยนบัญชีหรือsuccessปลอม เก็บorderให้ติดตามได้ | A+B | NR |
| UX-05 | ชื่อprofile/promo/scriptหรือHTMLอันตราย | แสดงเป็นข้อความ ไม่execute XSS/ไม่ยิงSQL | A+B | NR |
| UX-06 | Network/console/artifacts | ไม่มีsecrets/privateข้อมูลอื่นเกินจำเป็น | B | NR |
| QA-01 | TypeScript | exit0 | A | PASS |
| QA-02 | automated suiteทั้งหมด | ทุกเคสผ่านหรือมีscope/เหตุผลยอมรับชัด ไม่ซ่อนfail | A | PASS 165/165 วันที่2026-10-23 |
| QA-03 | full lint | ไม่มีerrors; warningsreviewแล้ว | A | PASS 0errors0warnings วันที่2026-10-23 |
| QA-04 | production buildรอบปัจจุบัน | buildสำเร็จโดยไม่กระทบdev session | A | NR |
| QA-05 | regressionหลังแก้bugแต่ละตัว | เคสเดิมและเคสข้างเคียงผ่าน เก็บหลักฐาน | A+B | NR |

## 18. Production-only / ก่อนเปิดใช้จริง

เคสเหล่านี้ไม่ใช่เงื่อนไขต้องmigrateทุกอย่างเพื่อเดโม แต่ห้ามเซ็นว่าproductionreadyเมื่อยังไม่ได้ทำ

| ID | เคส / ขั้นตอน | ผลที่คาดหวัง | วิธี | ผล |
|---|---|---|---|---|
| PROD-01 | receiver/ชื่อ/branchของร้านแทนบัญชีทดลอง | เจ้าของยืนยันและทดสอบpositive/negativeบนdeployment | P+U | NR |
| PROD-02 | Vercel/domain/HTTPS/env/keys | configครบแยกtestprod ไม่มีNEXT_PUBLICsecret cookiesecure | P | NR |
| PROD-03 | Auth/OTP/paymentบนdeploymentจริง | happy+negativeครบ ไม่อนุมานจากlocalhost | P+U | NR |
| PROD-04 | ข้อมูลร่วมกัน/Checkin/Finance/benefits/points | serverDBauthoritativeตามscope ไม่มีlocalStorageตัดสินเงิน/สิทธิ์ | P | NR |
| PROD-05 | migration/schema/functions/grants | versionถูก leastprivilege ไม่มีPUBLICwrite/executeunsafe | P | NR |
| PROD-06 | backupและrestore drillในDBแยก | restoreได้จริง ไม่ใช่เช็คhashอย่างเดียว | P | NR |
| PROD-07 | LINEแจ้งเตือน/RichMenu/consent | ส่งถึงผู้ใช้ที่ยินยอมจริง ไม่ใช่แค่botinfoping | P+U | NR |
| PROD-08 | EasySlipแพ็กเกจ/เครดิตSMS/expiry/alerts | เจ้าของเข้าใจค่าใช้จ่ายและวิธีต่ออายุ มีทางรับมือproviderdown | P+U | NR |
| PROD-09 | ปิด/test/devroutes/ทดลองaccounts/rotatekeys | ไม่มีสิทธิ์ส่งข้อความหรือเผยข้อมูลหลุด; archiveที่อนุมัติไม่ลบเงินจริง | P | NR |
| PROD-10 | Ownerจริง/คู่มือ/trainingและsignoff | ยืนยันผู้รับมอบ checklistlimitations+scopeพร้อมหลักฐาน | P+U | NR |

## 19. ลำดับทดสอบร่วมกัน

1. **รอบ1:** สมัครใหม่ REG-01 → profile/password → WELCOME-01 → logout/login AUTH-02/06 ในbrowserแยก ใช้เบอร์ใหม่ที่ผู้ใช้เป็นเจ้าของ
2. **รอบ2:** ลืมรหัส AUTH-07/08 + OTPnegative โดยไม่ส่งรหัสผ่าน/OTPในแชต
3. **รอบ3:** ยืนยัน MEMBER/ADMIN/OWNER matrix ด้วยบัญชีทดสอบ ไม่เปลี่ยนrole Ownerหลัก
4. **รอบ4:** order/QR → ชำระจริงเฉพาะจำเป็น → PAID+DBaccount → replay/negative แบบควบคุม ไม่โอนซ้ำทุกเคส
5. **รอบ5:** welcomecoupon/benefits/admin/profile/mock/scanner/FinanceและmobileUX บันทึกscopegapทุกจุด
6. **รอบ6:** แก้bugs → regression → tests/lint/build → signoffเฉพาะtesting; productionเคสแยกรอบ

## 20. Bug register / หลักฐาน

| Bug ID | ความรุนแรง | เคส | อาการ/หลักฐาน | สถานะ |
|---|---|---|---|---|
| BASE-01 | Mock/testfixture migration | QA-02 / BENEFIT-* | fixtureเก่าเลือกdemograntsผิด + staleunits/defaults; ปรับassertionsให้ตรงโดยคงreplay/quota/atomicity,แก้graphmigrationcollisionพร้อมregression | CLOSED focused32/32 full165/165 |
| BASE-02 | Quality gate | QA-03 | แก้structuredpayloadtypes/asyncGETcleanup/useSyncExternalStoreภาษา ไม่เพิ่มpaidcall | CLOSED fulllint0/0 |
| SCOPE-01 | Blockerสำหรับproduction ไม่ใช่UI-demo | CHECK-09 / ADMIN-07 / BENEFIT-10/11 | หลายโมดูลmockยังไม่เชื่อมrealpayment/DBrights/Finance | KNOWN GAP |
| TOOL-01 | เตรียมเครื่องมือ | browsercases | ตั้งPlaywrightใน.local-db/role-browser ใช้Chromeแยกพร้อมภาพและreports ไม่ใช้userprofile | CLOSED |
| REWARDS-REAL | Real/mock UI | ROLE-01/03, BENEFIT-11 | สมาชิกDBใหม่ดูcatalogไม่ได้เพราะเช็คseedidentityเท่านั้น; แก้ให้ดูได้read-only/mock0และปิดredemptionทั้งUI/handler | CLOSED browserretest |
| MOBILE-CHECKIN | Responsive | UX-01 / CHECK-* | 390pxdocument691pxจากimplicitgrid/donutlegend; เพิ่มgrid-cols-1และwrap ไม่ซ่อนbodyoverflow | CLOSED 360/390/1440 +20browserchecks |
| MEMBER-DB-GAP | Scope/UI gap | ROLE-08 / PROFILE-02 | Ownerเปิด/admin/members/BLU-3ไม่พบ เพราะdetail/listยังmock; ห้ามfallbackเป็นคนอื่นหรือถือDBmemberจัดการได้แล้ว | OPEN knownmockscope ไม่ใช่permissionbypass |
| WALLET-01 | UI integration | WELCOME-08 | ผู้ใช้พบwalletว่าง: /member แสดงmockเท่านั้น แต่welcomeDBอยู่ใน /member/benefits; แก้serverpageส่งcouponDTOและใช้WelcomeCouponsร่วมกัน แยกemptyของmock | CLOSED: ผู้ใช้ภาพretest /member แสดงจริงถูก |

### บันทึกผลรอบใหม่

| วันเวลา | Case ID | ผล | ผู้ทดสอบ/วิธี | หลักฐานหรือBug ID |
|---|---|---|---|---|
| 2026-10-22 | AUTH-01 | USER_PASS | ผู้ใช้/OTPจริง+browser | แจ้งสำเร็จและภาพOwner/test; ยังไม่ถือเป็นresetหรือสมัครใหม่ |
| 2026-10-22 | QA-01 | PASS | Agent/TypeScript | pnpm exec tsc --noEmit exit0 |
| 2026-10-22 | QA-02 | FAIL | Agent/offline suite | BASE-01;143/122/21 |
| 2026-10-22 | QA-03 | FAIL | Agent/full lint | BASE-02;9errors7warnings |
| 2026-10-22 | REG-01 | PASS | ผู้ใช้OTPจริง/browser + AgentDB | BLU-2 created12:31:44Z,password_set=true,roleMEMBERก่อนpromote,statusPENDING,points0; ไม่ทดสอบlogout/loginในเคสนี้ |
| 2026-10-22 | WELCOME-01 | PASS | AgentDB + สมัครจริง | FREE_ENTRY/WELCOME_REGISTRATION 1แถว quota1 used0 AVAILABLE,expire-created=30วัน; ยังไม่ยืนยันwalletUI/redeem |
| 2026-10-22 | เตรียมOwnerใหม่ | DONE | Operator helperที่ผู้ใช้อนุมัติ | BLU-2 promotedOWNER หลังgenuineREGISTEROTP/ticketตรวจครบ; ไม่ใช่หลักฐานROLE-09/UIrolemanagementผ่าน |
| 2026-10-22 | WELCOME-08 | FAIL → FIXED → USER_PASS /member | ผู้ใช้ภาพwalletว่างแล้วภาพretestแสดงcouponจริง | WALLET-01closed; focusedwallet/coupon10tests,TypeScript,scopedlintผ่าน ไม่แจก/ใช้คูปองเพิ่ม; /benefitsยังไม่retestในbrowser |
| 2026-10-22 | WELCOME-04 baseline | READY | Agentอ่านDBก่อนผู้ใช้กด | BLU-2 couponid1 AVAILABLE quota1 used0 checkins0 points0; ยังไม่ใช้สิทธิ์ |
| 2026-10-22 | WELCOME-09 | PASS | ผู้ใช้ยืนยันCancelผ่าน + AgentตรวจDBหลังยกเลิก | coupon AVAILABLE used0 checkins0 points0 ไม่มีmutation |
| 2026-10-22 | WELCOME-04 | PASS | ผู้ใช้ภาพหลังยืนยัน/refresh + AgentDB | BLU-2 coupon1 USED used1/quota1 checkins1 couponselfservice1 points0; UIไม่มีปุ่มใช้ซ้ำ ไม่ใช่หลักฐานAPIreplayผ่าน |
| 2026-10-22 | AUTH-02 / AUTH-06 / WELCOME-10 | USER_PASS ตามส่วน | ผู้ใช้แจ้งทำตามครบ | logoutแล้ว/memberกลับlogin, loginpasswordไม่ขอOTP, couponยังUSED; logoutAPI/backcacheยังไม่test |
| 2026-10-22 | REG-02 | PASS API+DB | Agentยิงlocalregister/requestด้วยเบอร์ที่มีอยู่แล้ว | HTTP409, memberจริง1ราย,welcome1แถวused1,points0 ไม่มีสมาชิก/คูปองซ้ำ; UIข้อความยังไม่test |
| 2026-10-22 | AUTH-07 / AUTH-08 | USER_PASS ตามส่วน | ผู้ใช้แจ้งทำตามflowลืมรหัสสำเร็จ | รับOTPตั้งรหัสใหม่, sessionเก่ารีเฟรชกลับlogin, รหัสใหม่loginได้; ยังไม่ได้ทดสอบกรอกรหัสเก่าผิด |
| 2026-10-22 | AUTH-15 | OfflinePASS + USER_PASSเปิดปิด | sharedPasswordInput3tests+authregressionรวม8/8,TypeScript,scopedlint; ผู้ใช้แจ้งปุ่มตาผ่าน | componentใช้ครบlogin/register/setup/reset/adminmock; ยังไม่เหมาว่าkeyboard/ทุกหน้าผ่าน |
| 2026-10-22 ปิดรอบ | QA-02 | FAIL | Agentoffline suiteล่าสุด | 151testsผ่าน130ล้ม21; `.local-db/final-test-2026-10-22-close.txt` ไม่ได้แก้failuresเพื่อให้ผ่าน |
| 2026-10-23 | ROLE-01..12 ตามส่วน | PASS/PARTIAL ตามตาราง | Playwrightbrowser+realAPI+DBfixtures | 177checksผ่าน,1additionalmemberdetailgap; `.local-db/role-uat-2026-10-23T08-21-15.656Z/report.md` ไม่เท่ากับทุกเคสใหญ่ผ่าน |
| 2026-10-23 | Auth/OTPnegativeตามส่วน | PASS | APIlocalhost+DBfixturesไม่มีSMS | 75checksรวมsafetycleanupผ่าน `.local-db/auth-negative-uat-2026-10-23T08-28-07.144Z/report.json` ไม่ใช่positiveSMS |
| 2026-10-23 | ROLE-05/BENEFIT/CHECK/UX ตามส่วน | PASS/PARTIAL | Staffbrowsercontextmockแยก | 23distinctsubcasesผ่าน,1mobileoverflowfailก่อนแก้; `.local-db/staff-mock-uat-2026-10-23T08-56-13.102Z/combined-coverage.md` |
| 2026-10-23 | MOBILE-CHECKIN / UX-01 | PASSเฉพาะstaff4pages360/390/1440 | ChromePlaywrightDOMwidth/inputfocus | หลังแก้grid/wrap20/20 `.local-db/checkin-layout-2026-10-23T09-08-02.170Z/report.md` ไม่ใช่hardwaretest |
| 2026-10-23 | QA-01/02/03 | PASS | Parentรันยืนยัน | TypeScript,tests165/165,fulllint0/0; `.local-db/final-test-2026-10-23.txt` |

## 21. เงื่อนไขจบรอบ

- เคสcritical Auth/role/เงิน/ใช้สิทธิ์ซ้ำต้องผ่านพร้อมหลักฐาน ไม่มีP0/P1ค้างหรือmanualoverrideปกปิดปัญหา
- ระบุทุกรายการที่ยังเป็นmock/blocked/production-only พร้อมผู้ใช้รับทราบ ไม่ติดPASSเพื่อให้เอกสารดูครบ
- Retestกับcode/envล่าสุดหลังแก้bugs เก็บorderId/เวลา/expected/actual ไม่เก็บsecrets
- Signoff testing ไม่เท่ากับproductionready; แยกรายการก่อนdeploymentจริงในหัวข้อ18
