const storageKey = "blu:admin:coupon-recipient";
const ttl = 60_000;
export const couponRecipientAnchor = "coupon-recipient";
export const couponRecipientHref = `/admin/coupons#${couponRecipientAnchor}`;
export const isMemberCode = (value: unknown): value is string => typeof value === "string" && /^BLU-[0-9]{1,12}$/.test(value);
export const isRecipientCode = (value: string) => isMemberCode(value) || /^CARD-[0-9]{1,95}$/.test(value);

export function stageCouponRecipient(code: string) {
  try {
    const storage = window.sessionStorage;
    storage.removeItem(storageKey);
    if (isMemberCode(code)) storage.setItem(storageKey, JSON.stringify({ code, expires: Date.now() + ttl }));
  } catch { /* Manual entry remains available if storage is blocked. */ }
}

export function takeCouponRecipient() {
  if (window.location.hash !== `#${couponRecipientAnchor}`) return null;
  try {
    const storage = window.sessionStorage;
    const raw = storage.getItem(storageKey);
    storage.removeItem(storageKey);
    const entry = raw ? JSON.parse(raw) : null;
    const now = Date.now();
    return isMemberCode(entry?.code) && Number.isSafeInteger(entry.expires)
      && entry.expires > now && entry.expires <= now + ttl ? entry.code : null;
  } catch { return null; }
}
