"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Definition = { id: number; kind: string; title: string; coupon_type: string | null; code: string | null; active: boolean; expires_at: string; discount_type: string | null; discount_value: number; usage_limit: number; min_satang?: number; max_satang?: number | null; eligible_package_ids?: number[] | null; requires_activation?: boolean; activation_duration_minutes?: number | null };
type Assignment = { id: number; definition_id: number; member_code: string; full_name: string; coupon_id: number | null; cancelled_at: string | null };
type Coupon = { id: number; member_code: string; full_name: string; type: string; source: string | null; title: string; status: string; total_quota: number; used_count: number; expire_date: string | null; campaign_expires_at?: string | null; activated_at?: string | null; activation_status?: string | null };
type Audit = { actor_id: number; action: string; request_key: string; created_at: string; result: unknown };
type PromoOrder = { order_id: string; assignment_id: number; actor_id: number; promo_code: string; status: string; amount_satang: number; discount_satang: number; upload_deadline: string };
type Data = { definitions: Definition[]; assignments: Assignment[]; coupons: Coupon[]; audit: Audit[]; promoOrders: PromoOrder[]; couponActivationReady?: boolean; grantTargetingReady?: boolean };
type PackageOption = { id: number; name: string };
type Pending = { action: string; body: Record<string, unknown> };
const recipientGroups = { ALL: "ทุกแพ็กเกจที่ยังมีสิทธิ์และตรวจสอบได้", "1": "รายวัน", "30": "1 เดือน", "90": "3 เดือน", "180": "6 เดือน", "365": "12 เดือน" } as const;
type GrantPreview = { definitionId: number; definitionTitle: string; memberCode: string; fullName: string; recipientGroup: keyof typeof recipientGroups; durationDays: number; packageExpiresAt: string; proof: string };
const field = "border rounded p-2 bg-transparent w-full";
const button = "border rounded px-3 py-2 disabled:opacity-40";
const date = (value: string | null, timeZone?: string) => value ? new Date(value).toLocaleString("th-TH", { timeZone }) : "ไม่กำหนด";
const bangkok = "Asia/Bangkok";

export default function BenefitsAdminClient({ kind }: { kind: "COUPON" | "PROMO" }) {
  const [data, setData] = useState<Data | null>(null);
  const [packages, setPackages] = useState<PackageOption[] | null>(null);
  const [packageError, setPackageError] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [grantPreview, setGrantPreview] = useState<GrantPreview | null>(null);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/benefits/list", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || "โหลดข้อมูลไม่ได้");
    setData(result.data);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/benefits/list", { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw Error(result.error || "โหลดข้อมูลไม่ได้"); return result.data as Data; })
      .then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (kind !== "PROMO") return;
    const controller = new AbortController();
    fetch("/api/packages", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error("Catalog unavailable");
        const result = await response.json();
        if (!Array.isArray(result.packages)) throw Error("Catalog unavailable");
        setPackages(result.packages as PackageOption[]);
      })
      .catch(() => { if (!controller.signal.aborted) setPackageError(true); });
    return () => controller.abort();
  }, [kind]);
  async function send(request: Pending) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/benefits/${request.action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) setPending(null);
        throw Error(result.error || "ทำรายการไม่ได้");
      }
      setPending(null); setNotice("บันทึกแล้ว");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "ยังยืนยันผลไม่ได้ ให้ลองคำขอเดิม"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function mutate(action: string, body: Record<string, unknown>) {
    if (busy || pending || inFlight.current) return;
    const request = { action, body: { ...body, requestKey: crypto.randomUUID() } };
    setPending(request); void send(request);
  }
  async function previewGrant(body: Record<string, unknown>) {
    if (!data?.grantTargetingReady || pending || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice(""); setGrantPreview(null);
    try {
      const response = await fetch("/api/admin/benefits/grant-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "ตรวจสอบสิทธิ์ไม่ได้");
      setGrantPreview(result.data);
    } catch (e) { setError(e instanceof Error ? e.message : "ตรวจสอบสิทธิ์ไม่ได้"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const definitions = data?.definitions.filter(d => d.kind === kind) ?? [];
  const definitionIds = new Set(definitions.map(d => d.id));
  return <main className="p-6 space-y-6 max-w-6xl mx-auto">
    <h1 className="text-2xl font-bold">{kind === "COUPON" ? "จัดการคูปองจริง" : "จัดการโปรโมโค้ดจริง"}</h1>
    <p className="text-sm">{kind === "COUPON" ? "ใช้ coupons จริง • welcome/FREE_ENTRY ใช้ผ่าน kiosk เท่านั้น • วันแถมต้องมีสมาชิก ACTIVE ที่ยังไม่หมดอายุ • friend pass บันทึกผู้เข้าใช้แยก ไม่เพิ่มสิทธิ์สมาชิกแบบชำระเงิน" : "โปรต้องมอบหมายให้สมาชิกก่อนใช้ได้หนึ่งครั้ง • FIXED ใช้หน่วยสตางค์, PERCENT ใช้ % • เชื่อมยอด order จริงและจองโควตาระหว่างรอตรวจสลิป ไม่ยืนยันการชำระจากหน้านี้"}</p>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pending && <div className="border rounded p-3">ยังเก็บ requestKey เดิมไว้ ป้องกันทำรายการซ้ำ <button className={button} disabled={busy} onClick={() => void send(pending)}>ลองคำขอเดิมอีกครั้ง</button></div>}
    <button className={button} disabled={busy} onClick={() => { setError(""); load().catch(e => setError(e.message)); }}>โหลดข้อมูลใหม่</button>
    <fieldset disabled={!data || busy || !!pending} className="space-y-6 disabled:opacity-60">
      <form className="border rounded p-4 grid md:grid-cols-2 gap-3" onSubmit={event => {
        event.preventDefault(); const f = new FormData(event.currentTarget);
        const get = (name: string) => String(f.get(name) ?? "");
        if (kind === "COUPON" && !data?.couponActivationReady) return;
        if (kind === "PROMO" && !packages) return;
        const expiresAt = new Date(get("expiresAt") + (kind === "COUPON" ? "+07:00" : "")).toISOString();
        const duration = get("activationDurationMinutes");
        const maximum = get("maxSatang");
        const eligible = f.getAll("eligiblePackageIds").map(Number);
        if (kind === "PROMO" && ((maximum !== "" && Number(maximum) < Number(get("minSatang"))) || eligible.length > 100)) {
          setError("ยอดสูงสุดต้องไม่ต่ำกว่ายอดขั้นต่ำ และเลือกได้ไม่เกิน 100 แพ็กเกจ");
          return;
        }
        mutate("create", kind === "COUPON" ? { kind, title: get("title"), couponType: get("couponType"), quota: Number(get("quota")), bonusDays: Number(get("bonusDays")), expiresAt, activationDurationMinutes: duration === "" ? null : Number(duration) } : { kind, title: get("title"), code: get("code"), discountType: get("discountType"), discountValue: Number(get("discountValue")), minSatang: Number(get("minSatang")), maxDiscountSatang: get("maxDiscountSatang") ? Number(get("maxDiscountSatang")) : null, usageLimit: Number(get("usageLimit")), expiresAt, ...(maximum !== "" ? { maxSatang: Number(maximum) } : {}), ...(eligible.length ? { eligiblePackageIds: eligible } : {}) });
      }}>
        <h2 className="font-bold md:col-span-2">สร้างนิยามใหม่ (แก้ย้อนหลังไม่ได้; ปิดแล้วสร้างใหม่)</h2>
        <label>ชื่อ<input className={field} name="title" required maxLength={120} /></label>
        <label>{kind === "COUPON" ? "วันหมดอายุแคมเปญ (เวลาไทย)" : "หมดอายุ (เวลาท้องถิ่น)"}<input className={field} type="datetime-local" name="expiresAt" required /></label>
        {kind === "COUPON" ? <>
          <label>ประเภท<select className={field} name="couponType"><option value="FRIEND_PASS">พาเพื่อน</option><option value="EXTRA_DAYS">เพิ่มวัน</option></select></label>
          <label>โควตา (เพิ่มวันต้อง 1)<input className={field} name="quota" type="number" min={1} max={100} defaultValue={1} required /></label>
          <label>วันแถม (พาเพื่อนต้อง 0)<input className={field} name="bonusDays" type="number" min={0} max={365} defaultValue={0} required /></label>
                    <label>อายุหลังเปิดใช้ (นาที)<input className={field} name="activationDurationMinutes" type="number" min={0} max={2147483647} step={1} aria-describedby="activation-policy" /></label>
                    <p id="activation-policy" className="text-sm">เว้นว่าง: ไม่มีเวลาจำกัดเพิ่ม · 0: 10 นาที · คูปองหมดอายุเมื่อถึงเวลาใดก่อน ระหว่างเวลาหลังเปิดใช้กับวันหมดอายุแคมเปญ</p>
                    {data && !data.couponActivationReady && <p role="status">ยังสร้างคูปองแบบเปิดใช้ไม่ได้: ฐานข้อมูลยังไม่รองรับ R6</p>}
        </> : <>
          <label>โค้ด<input className={field} name="code" pattern="[A-Za-z0-9_-]{3,40}" required /></label>
          <label>ประเภท<select className={field} name="discountType"><option value="FIXED">สตางค์</option><option value="PERCENT">เปอร์เซ็นต์</option></select></label>
          <label>มูลค่าส่วนลด<input className={field} name="discountValue" type="number" min={1} max={100000000} required /></label>
          <label>ยอดขั้นต่ำ (สตางค์)<input className={field} name="minSatang" type="number" min={0} max={100000000} defaultValue={0} required /></label>
          <label>ยอดซื้อสูงสุดก่อนลด (สตางค์, เว้นว่าง = ไม่จำกัด)<input className={field} name="maxSatang" type="number" min={0} max={100000000} step={1} /></label>
          <fieldset className="md:col-span-2" aria-describedby="promo-package-policy">
            <legend>แพ็กเกจที่ใช้โปรได้</legend>
            <p id="promo-package-policy" className="text-sm">ไม่เลือก = ใช้ได้ทุกแพ็กเกจที่เปิดขาย ยอดขั้นต่ำและสูงสุดรวมค่าขอบทั้งสองด้าน</p>
            {!packages && <p role="status">{packageError ? "โหลดแพ็กเกจไม่ได้ กรุณารีเฟรชก่อนตั้งเงื่อนไขรายแพ็กเกจ" : "กำลังโหลดแพ็กเกจที่เปิดขาย"}</p>}
            {packages?.length === 0 && <p>ไม่มีแพ็กเกจที่เปิดขาย</p>}
            {packages?.map(p => <label className="block" key={p.id}><input type="checkbox" name="eligiblePackageIds" value={p.id} /> #{p.id} {p.name}</label>)}
          </fieldset>
          <label>ลดสูงสุด (สตางค์, เว้นว่างได้)<input className={field} name="maxDiscountSatang" type="number" min={1} max={100000000} /></label>
          <label>โควตารวม (รวมรายการจอง)<input className={field} name="usageLimit" type="number" min={1} max={1000000} defaultValue={1} required /></label>
        </>}
        <button className={button} type="submit" disabled={kind === "COUPON" ? !data?.couponActivationReady : !packages}>สร้าง</button>
      </form>
      <section className="space-y-2"><h2 className="font-bold">นิยาม ({definitions.length})</h2>
        {definitions.map(d => <div className="border rounded p-3 flex flex-wrap gap-3 items-center" key={d.id}>
          <span>#{d.id} {d.title} · {d.code || d.coupon_type} · {d.active ? "เปิด" : "ปิด"} · หมดอายุ {date(d.expires_at, d.kind === "COUPON" ? bangkok : undefined)} {d.requires_activation && `· ต้องเปิดใช้ · ${d.activation_duration_minutes == null ? "ไม่มีเวลาจำกัดเพิ่ม" : `${d.activation_duration_minutes || 10} นาทีหลังเปิดใช้`}`} {d.kind === "PROMO" && `· ${d.discount_type} ${d.discount_value} / โควตา ${d.usage_limit}`}</span>
          {d.kind === "PROMO" && <span>ยอดก่อนลด {d.min_satang ?? 0}–{d.max_satang ?? "ไม่จำกัด"} สตางค์ · {d.eligible_package_ids?.map(id => {
            const pkg = packages?.find(p => p.id === id);
            return pkg ? `#${id} ${pkg.name}` : `#${id}`;
          }).join(", ") ?? "ทุกแพ็กเกจ"}</span>}
          <button className={button} disabled={!d.active} onClick={() => mutate("deactivate", { definitionId: d.id })}>ปิดรับมอบหมาย/ใช้โปรใหม่</button>
        </div>)}
      </section>
      <section className="border rounded p-4 space-y-3">
        <h2 className="font-bold">มอบหมายตามแพ็กเกจปัจจุบัน</h2>
        <p className="text-sm">เลือกทีละคน ระบบรับเฉพาะสิทธิ์ออนไลน์ที่พิสูจน์ได้จากรายการ PAID เดี่ยว ไม่แจกอัตโนมัติ และไม่เปลี่ยนสิทธิ์ที่เคยแจก</p>
        {data && !data.grantTargetingReady && <p role="status">ยังมอบหมายใหม่ไม่ได้: ฐานข้อมูลยังไม่รองรับการตรวจกลุ่มผู้รับ R6</p>}
        <form className="flex flex-wrap gap-3" onChange={() => setGrantPreview(null)} onSubmit={event => {
          event.preventDefault(); const f = new FormData(event.currentTarget);
          void previewGrant({ definitionId: Number(f.get("definitionId")), memberCode: String(f.get("memberCode")), recipientGroup: String(f.get("recipientGroup")) });
        }}>
          <label>นิยาม<select className={field} name="definitionId" required defaultValue=""><option value="" disabled>เลือก</option>{definitions.filter(d => d.active).map(d => <option key={d.id} value={d.id}>#{d.id} {d.title}</option>)}</select></label>
          <label>กลุ่มแพ็กเกจ<select className={field} name="recipientGroup" required defaultValue=""><option value="" disabled>เลือกกลุ่ม</option>{Object.entries(recipientGroups).map(([group, label]) => <option key={group} value={group}>{label}</option>)}</select></label>
          <label>พิมพ์หรือสแกนรหัส BLU / CARD<input className={field} name="memberCode" required maxLength={100} /></label>
          <button type="submit" disabled={!data?.grantTargetingReady} className={button}>ตรวจสอบผู้รับ</button>
        </form>
        {grantPreview && data?.grantTargetingReady && <div className="space-y-2">
          <p role="status">{grantPreview.memberCode} {grantPreview.fullName} · #{grantPreview.definitionId} {grantPreview.definitionTitle} · {recipientGroups[grantPreview.recipientGroup]} ({grantPreview.durationDays} วัน) · สิทธิ์แพ็กเกจถึง {date(grantPreview.packageExpiresAt, bangkok)}</p>
          <button type="button" className={button} onClick={() => {
            const { definitionId, memberCode, recipientGroup, proof } = grantPreview;
            setGrantPreview(null);
            mutate("grant", { definitionId, memberCode, recipientGroup, proof });
          }}>ยืนยันมอบหมายให้ผู้รับนี้</button>
        </div>}
      </section>
      <section className="space-y-2"><h2 className="font-bold">การมอบหมาย (ล่าสุด 500 รายการรวม)</h2>
        {data?.assignments.filter(a => definitionIds.has(a.definition_id)).map(a => <div className="border rounded p-3 flex flex-wrap gap-3" key={a.id}>
          <span>#{a.id} นิยาม #{a.definition_id} · {a.member_code} {a.full_name} · {a.coupon_id ? `คูปอง #${a.coupon_id}` : "โปรสำหรับ payment quote"} · {a.cancelled_at ? "ยกเลิกแล้ว" : "มอบหมายแล้ว"}</span>
          <button className={button} disabled={!!a.cancelled_at} onClick={() => { if (confirm("ยกเลิกสิทธิ์ที่ยังไม่ใช้?")) mutate("cancel", { assignmentId: a.id }); }}>ยกเลิก</button>
        </div>)}
      </section>
      {kind === "COUPON" && <section className="space-y-2"><h2 className="font-bold">คูปองสมาชิกจริง (ล่าสุด 500 รายการ)</h2>
        {data?.coupons.map(c => <div className="border rounded p-3" key={c.id}>
          <p>#{c.id} {c.member_code} {c.full_name} · {c.title} ({c.type}) · {c.activation_status === "PENDING_ACTIVATION" ? "รอสมาชิกเปิดใช้" : c.activation_status ?? c.status} · ใช้ {c.used_count}/{c.total_quota} · หมดอายุ {date(c.expire_date, c.campaign_expires_at ? bangkok : undefined)}</p>
                    {c.campaign_expires_at && <p className="text-sm">หมดอายุแคมเปญ {date(c.campaign_expires_at, bangkok)} · {c.activated_at ? `เปิดใช้ ${date(c.activated_at, bangkok)}` : "ยังไม่เปิดใช้"}</p>}
        </div>)}
        <form className="border rounded p-4 space-y-3" onSubmit={event => {
          event.preventDefault(); const f = new FormData(event.currentTarget);
          if (confirm("ยืนยันใช้คูปองหนึ่งครั้ง ณ จุดบริการ?")) mutate("consume", { couponId: Number(f.get("couponId")), guestReference: String(f.get("guestReference") ?? "") });
        }}>
          <label>คูปอง ID<input className={field} name="couponId" type="number" min={1} required /></label>
          <label>เลขอ้างอิงผู้เข้าใช้/guest (จำเป็นสำหรับพาเพื่อน; ไม่ใส่ข้อมูลอ่อนไหว)<input className={field} name="guestReference" maxLength={120} /></label>
          <button className={button}>ใช้คูปองหนึ่งครั้ง</button>
        </form>
      </section>}
    </fieldset>
    {kind === "PROMO" && <section className="space-y-2"><h2 className="font-bold">โปรใน payment orders จริง (ล่าสุด 500 รายการ)</h2><p className="text-sm">PENDING = จอง/รอตรวจ (ไม่ใช่ชำระแล้ว), PAID = ระบบชำระเงินยืนยัน, REJECTED = ไม่ใช้สิทธิ์</p>{data?.promoOrders.map(o => <div className="border rounded p-3" key={o.order_id}>{o.promo_code} · assignment #{o.assignment_id} · actor #{o.actor_id} · {o.status} · ลด {o.discount_satang / 100} บาท · ยอด {o.amount_satang / 100} บาท · deadline {date(o.upload_deadline)}<p className="text-xs break-all">{o.order_id}</p></div>)}</section>}
    <section><h2 className="font-bold">Audit ล่าสุด 100 รายการ</h2>{data?.audit.map(a => <details className="border-b p-2" key={`${a.actor_id}:${a.request_key}`}><summary>{date(a.created_at)} · actor #{a.actor_id} · {a.action}</summary><pre className="text-xs whitespace-pre-wrap">{JSON.stringify(a, null, 2)}</pre></details>)}</section>
  </main>;
}
