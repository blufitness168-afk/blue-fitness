# Real UI / Security UAT — 2026-10-24

## Latest regression after fixes — PASS

After fixing member-detail min-width/wrapping and PaymentModal initial focus, focus trap, Escape handling, focus restoration and body scroll lock, reran `node scripts/real-ui-security-uat.mjs`: **121 PASS / 0 FAIL**, exit 0. Evidence: `.local-db/real-ui-security-2026-10-24T12-32-50.980Z/`. All 75 role/page/viewport combinations and all modal keyboard assertions now pass. Temporary account/session cleanup assertions pass. Full regression 230/230, TypeScript and lint pass. The historical failures below are retained for traceability, not current blockers. Coverage limits below still apply.

## Historical run and evidence

- Command: `node scripts/real-ui-security-uat.mjs`
- Local Chrome, Playwright loaded from `.local-db/role-browser`, isolated fresh contexts; localhost:3000 existing server.
- Latest result: **108 PASS / 13 FAIL**, exit **1** (intentional: actual assertions failed).
- Evidence: `.local-db/real-ui-security-2026-10-24T12-27-29.565Z/results.json`, `report.md`, page screenshots and modal screenshots. Evidence stays gitignored; authorized admin screenshots may contain business information and must not be published.
- No production files changed. This report and `real-ui-security-uat.mjs` are the only owned deliverables; other agents' work is untouched.

## Actual failures — do not mark UX gates passed

| Finding | Observed behavior | Reproduction / evidence | Relevant production source |
|---|---|---|---|
| UISEC-01 | OWNER member-detail page horizontally overflows at 360px: document width **379px**, viewport **360px**. Other tested widths passed. | Latest disposable `/admin/members/BLU-39`; screenshot `OWNER-360-_admin_members_BLU-39.png`. This temporary account has been removed; rerun creates a new equivalent fixture. | `src/app/admin/members/` |
| UISEC-02 | Opening PaymentModal leaves keyboard focus outside dialog. | Home → select package; inspect activeElement. Fails at 360/390/1440. | `src/components/PaymentModal.tsx` |
| UISEC-03 | Shift+Tab from close button escapes dialog; no keyboard focus trap. | Focus dialog close button → Shift+Tab. Fails at all three widths. | `src/components/PaymentModal.tsx` |
| UISEC-04 | Escape does not close PaymentModal. | Open dialog → Escape; dialog count remains 1. Fails at all three widths. | `src/components/PaymentModal.tsx` |
| UISEC-05 | Clicking close does not restore focus to package trigger. | Open dialog → close by button → activeElement is not trigger. Fails at all three widths. | `src/components/PaymentModal.tsx` |

Count: 1 overflow assertion + 4 modal assertions × 3 widths = **13 actual failures**. These reproduced across three runs. Initial run also had one harness failure: check-in history POST was blocked by the conservative guard. Source inspection of `src/lib/real-checkin-server.ts` confirmed history is SELECT-only; the guard now permits exactly that POST endpoint, never scan. That harness issue is resolved and is not a production finding.

## Passed coverage

- UX-01 partial: 75 role/page/viewport combinations (OWNER 13 pages, ADMIN 8, MEMBER 4 × 3 widths), **74 pass / 1 fail**. Real home/member/benefits/rewards, admin check-in/rewards/coupons/promo-codes/dashboard/members/member-detail/finance as permitted by role. Assertions include nonempty rendered content, no application-error text, document overflow, and horizontal bounds of visible buttons/links/inputs. Screenshots captured before geometry assertions.
- UX-02 partial: modal opens, bounds fit each viewport, close button closes; delayed **read-only** refresh disables refresh/close/create buttons and repeated Enter generates exactly one refresh request. No create-order button was pressed.
- UX-03 partial: injected payment-account **403** and **network timedout abort** show an error, usable retry and login link, no success message. These are browser interception fixtures, not actual server outages or elapsed long-duration timeouts.
- UX-04 partial: open real PaymentModal, revoke active sessions **only for the disposable MEMBER identity**, then real profile API returns 401; modal refresh shows login error and link, never payment success.
- UX-05 partial: disposable MEMBER name `<img src=x onerror="window.__uatXss=1">` renders literally on `/member`, creates no `img[onerror]`, and does not set execution marker. No malicious promo write, SQL injection exploit, or benefits mutation was attempted.
- Guest profile/wallet/benefits/finance/random-order requests return 401 with error JSON and no protected payload.
- MEMBER admin benefits/finance/rewards reads return 403 with error JSON.
- Unsupported profile PUT/DELETE and wrong-method benefits/finance reads/creates return 405 (no benefit CRUD POSTs sent).
- Cross-origin profile PATCH returns 400/403 and fixture name remains unchanged in database. Only own synthetic identity could be targeted by this request.
- Profile query `memberId=1&id=1` still returns own synthetic profile, no passwordHash; random nonexistent order UUID returns 404 without order payload. These are **not** proof of cross-owner existing-order isolation.
- No browser `pageerror`; no attempted business/provider writes from exercised UI; only external Google Fonts CSS GET was blocked by the network guard.
- All three disposable OWNER/ADMIN/MEMBER accounts removed. Queries confirmed zero remaining members and zero auth sessions for each exact synthetic ID; login-limit rows deleted by exact synthetic phone. No actual user's password or session was read/revoked.

## Safety model

- Browser interception allows same-origin navigation/assets, an exact API GET whitelist, and source-reviewed POST `/api/admin/checkin/history` only; blocks all other browser API writes and external hosts. Service workers disabled.
- APIRequestContext bypasses interception, so **all** direct requests go through the explicit method/URL whitelist wrapper with origin checking and redirects disabled. Direct exceptions are temporary login, invalid/wrong-method probes and the own-fixture cross-origin profile test.
- No calls to order creation, payment verification, upload, provider diagnostics, SMS, benefits/rewards/finance CRUD, audit writes, or kiosk scan. No synthetic PAID or pending orders. Temporary login/session activity is the only auth activity; database sequences advance.
- Screenshots/results do not record passwords, cookie tokens, database URL, or response bodies from real admin records. Recovery metadata contains only temporary identity details. This is **not** a full credential/network leakage audit.

## Remaining gaps / do not overclaim

- UX-01 remains FAIL until mobile member detail fixed and rerun; measurements use synthetic PENDING accounts, not all business states or maximum-size datasets.
- UX-02 remains FAIL for accessibility. Delayed read tests are not proof of duplicate order/payment-submit prevention. No payment write is allowed in this suite.
- Session-expired pending-order retention, existing cross-owner order ID authorization, real slip/reconciliation, provider/upload behavior, promo XSS, native confirmation modals for mutations, server-side outgoing provider traffic observability, and real payment concurrency are not exercised.
- UX-06 partial only: blocked external requests and zero pageerrors are not sufficient to certify all console/network/artifact privacy requirements.
- SQL rollback mutations/concurrency belong to the main agent. Hardware/production-only/manual gates in FINAL_TEST.md remain outside this run.
- No build/lint/full regression run: production code was not changed. The UAT command itself ran to completion with all cleanup assertions passing and exit 1 for the reported product failures.
