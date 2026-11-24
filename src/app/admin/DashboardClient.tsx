import Link from "next/link";
import AdminDashboardChart, { type ChartSeries } from "@/components/AdminDashboardCharts";
import type { getAdminDashboard } from "@/lib/admin-members-server";

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
}

function formatDay(value: string) {
  return new Date(`${value}T00:00:00+07:00`).toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatMoney(value: number) {
  return `${value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`;
}

function compactMoney(value: number) {
  return value.toLocaleString("th-TH");
}

function compactCount(value: number) {
  return value.toLocaleString("th-TH");
}

const statusSeries: ChartSeries[] = [
  { key: "active", label: "ปัจจุบัน (ACTIVE)", color: "#00a86b" },
  { key: "grace", label: "หมดอายุ ≤ 30 วัน", color: "#f59e0b" },
  { key: "lapsed", label: "พ้นสภาพ > 30 วัน", color: "#e05545" },
  { key: "everRenewed", label: "เก่าต่ออายุสะสม (ทับซ้อนได้)", color: "#3a728e" },
];

const activitySeries: ChartSeries[] = [
  { key: "new", label: "สมาชิกใหม่", color: "#00a86b" },
  { key: "renewed", label: "เก่าต่ออายุ", color: "#3a728e" },
  { key: "lapsed", label: "พ้นสภาพ", color: "#e05545" },
];

const financeSeries: ChartSeries[] = [
  { key: "income", label: "รายรับ", color: "#00a86b" },
  { key: "expense", label: "รายจ่าย", color: "#e05545" },
  { key: "net", label: "คงเหลือสุทธิ", color: "#3a728e" },
];

export default function DashboardClient({
  data,
}: {
  data: Awaited<ReturnType<typeof getAdminDashboard>>;
}) {
  const { period, summary } = data;
  const periodLabel =
    period.mode === "day"
      ? `วัน ${period.label}`
      : period.mode === "year"
        ? `ปี ${period.year}`
        : `เดือน ${period.label}`;

  const memberCards: { label: string; value: string; note?: string }[] = [
    {
      label: "สมาชิกทั้งหมดที่เคยซื้อ",
      value: summary.totalPurchasedMembers.toLocaleString("th-TH"),
      note: `จากบัญชีที่สมัครทั้งหมด ${summary.totalAccounts.toLocaleString("th-TH")} บัญชี`,
    },
    {
      label: "สมาชิกปัจจุบัน (ACTIVE)",
      value: summary.currentActiveMembers.toLocaleString("th-TH"),
      note: period.isLiveSnapshot ? "ยังไม่หมดอายุ ณ ปัจจุบัน" : `ยังไม่หมดอายุ ณ สิ้น${periodLabel}`,
    },
    {
      label: "พ้นสภาพ (> 30 วันหลังหมดอายุ)",
      value: summary.lapsedMembers.toLocaleString("th-TH"),
      note: `หมดอายุไม่เกิน 30 วัน: ${summary.expiredGraceMembers.toLocaleString("th-TH")} คน`,
    },
    {
      label: "สมาชิกเก่าต่ออายุสะสม",
      value: summary.everRenewedMembers.toLocaleString("th-TH"),
      note: "ผู้ที่เคยต่ออายุภายใน 90 วัน",
    },
    {
      label: `สมาชิกใหม่ (${periodLabel})`,
      value: summary.newInPeriod.toLocaleString("th-TH"),
      note: "รวมผู้กลับมาซื้อหลังหมดอายุเกิน 90 วัน",
    },
    {
      label: `เก่าต่ออายุ (${periodLabel})`,
      value: summary.renewedInPeriod.toLocaleString("th-TH"),
      note: "ต่ออายุภายใน 90 วันหลังหมดอายุ",
    },
    {
      label: `พ้นสภาพ (${periodLabel})`,
      value: summary.lapsedInPeriod.toLocaleString("th-TH"),
      note: "ครบ 30 วันหลังหมดอายุในช่วงที่เลือก",
    },
    {
      label: "ใกล้หมดอายุใน 30 วัน",
      value: summary.expiringIn30Days.toLocaleString("th-TH"),
      note: "อิงจากวันที่รายงานที่เลือก",
    },
    {
      label: `จำนวนครั้งเช็คอิน (${periodLabel})`,
      value: summary.checkins.toLocaleString("th-TH"),
      note: "นับตามเวลาเข้าจริง (Asia/Bangkok)",
    },
  ];

  const tabClass = (active: boolean) =>
    active
      ? "rounded-xl bg-blu-dark px-4 py-2 text-xs font-bold text-white"
      : "rounded-xl border border-blu-sky/50 bg-white px-4 py-2 text-xs font-semibold text-blu-dark hover:bg-blu-ice";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-blu-dark">Dashboard ภาพรวม</h1>
          <p className="mt-1 text-xs text-blu-steel">
            กำลังดูข้อมูล: <span className="font-bold text-blu-dark">{periodLabel}</span> · อ้างอิง ณ{" "}
            {formatDateTime(period.asOf)} (เวลาไทย)
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="เลือกมุมมองเวลา">
          <Link href={`/admin?mode=day&dateFrom=${encodeURIComponent(period.dateFrom)}&dateTo=${encodeURIComponent(period.dateTo)}`} className={tabClass(period.mode === "day")}>
            รายวัน
          </Link>
          <Link href={`/admin?mode=month&monthFrom=${encodeURIComponent(period.monthFrom)}&monthTo=${encodeURIComponent(period.monthTo)}`} className={tabClass(period.mode === "month")}>
            รายเดือน
          </Link>
          <Link href={`/admin?mode=year&year=${encodeURIComponent(period.year)}`} className={tabClass(period.mode === "year")}>
            รายปี
          </Link>
        </div>
      </header>

      <form action="/admin" method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm">
        <input type="hidden" name="mode" value={period.mode} />
        {period.mode === "day" && (
          <>
            <label className="text-sm font-semibold text-blu-dark">
              จากวันที่ (เวลาไทย)
              <input type="date" name="dateFrom" defaultValue={period.dateFrom} className="ml-3 rounded-xl border bg-white p-2.5 text-sm" />
            </label>
            <label className="text-sm font-semibold text-blu-dark">
              ถึงวันที่ (เวลาไทย)
              <input type="date" name="dateTo" defaultValue={period.dateTo} className="ml-3 rounded-xl border bg-white p-2.5 text-sm" />
            </label>
          </>
        )}
        {period.mode === "month" && (
          <>
            <label className="text-sm font-semibold text-blu-dark">
              จากเดือน (เวลาไทย)
              <input type="month" name="monthFrom" defaultValue={period.monthFrom} className="ml-3 rounded-xl border bg-white p-2.5 text-sm" />
            </label>
            <label className="text-sm font-semibold text-blu-dark">
              ถึงเดือน (เวลาไทย)
              <input type="month" name="monthTo" defaultValue={period.monthTo} className="ml-3 rounded-xl border bg-white p-2.5 text-sm" />
            </label>
          </>
        )}
        {period.mode === "year" && (
          <label className="text-sm font-semibold text-blu-dark">
            ปี ค.ศ. (เวลาไทย)
            <input type="number" name="year" min={2000} max={2100} defaultValue={period.year} className="ml-3 w-28 rounded-xl border bg-white p-2.5 text-sm" />
          </label>
        )}
        <button type="submit" className="btn-blue rounded-xl px-5 py-2.5 text-sm">
          แสดงข้อมูล
        </button>
      </form>

      <section aria-labelledby="dashboard-members-heading" className="space-y-4">
        <h2 id="dashboard-members-heading" className="text-base font-black text-blu-dark">
          สถิติสมาชิกตามนิยามแพ็กเกจ (นับคนไม่ซ้ำต่อกลุ่มต่อช่วง)
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {memberCards.map((card) => (
            <article key={card.label} className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-blu-steel">{card.label}</h3>
              <p className="mt-2 text-2xl font-black text-blu-dark">{card.value}</p>
              {card.note && <p className="mt-1 text-[11px] text-blu-steel">{card.note}</p>}
            </article>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <AdminDashboardChart
            title={`สถานะสมาชิก ณ วันที่รายงาน (${periodLabel})`}
            subtitle="ใช้กราฟแท่งแทนวงกลม เนื่องจากกลุ่มเก่าต่ออายุสะสมสามารถทับซ้อนกับสถานะปัจจุบันหรือพ้นสภาพได้"
            data={data.statusChart}
            series={statusSeries}
            type="bar"
            valueFormatter={compactCount}
          />
          <AdminDashboardChart
            title={
              period.mode === "year"
                ? `ความเคลื่อนไหวสมาชิกรายเดือน (ปี ${period.year})`
                : period.mode === "month"
                  ? period.monthFrom === period.monthTo
                    ? `ความเคลื่อนไหวสมาชิก 6 เดือนล่าสุด (ถึง ${period.month})`
                    : `ความเคลื่อนไหวสมาชิกรายเดือน (${period.label})`
                  : period.dateFrom === period.dateTo
                    ? `ความเคลื่อนไหวสมาชิกประจำวัน (${period.date})`
                    : `ความเคลื่อนไหวสมาชิก (${period.label})`
            }
            subtitle="นับคนไม่ซ้ำต่อกลุ่ม (ใหม่ / เก่าต่ออายุ / พ้นสภาพ) ในแต่ละช่วงเวลา"
            data={data.activityChart}
            series={activitySeries}
            type="bar"
            valueFormatter={compactCount}
          />
        </div>
      </section>

      {data.callerRole === "OWNER" && (
        <section aria-labelledby="dashboard-finance-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="dashboard-finance-heading" className="text-base font-black text-blu-dark">
              ภาพรวมการเงิน (เฉพาะเจ้าของ)
            </h2>
            <Link href="/admin/finance" className="text-xs font-bold text-blu-slate underline">
              ไปหน้าจัดการรายรับ-รายจ่าย →
            </Link>
          </div>

          {data.finance.unconfirmedPaidCount > 0 && (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
              มีรายการชำระเงินสำเร็จ {data.finance.unconfirmedPaidCount.toLocaleString("th-TH")} รายการที่ยังไม่มี confirmed_at จึงยังไม่รวมในยอดการเงิน
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <article className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-blu-steel">รายรับสะสมทั้งหมด</h3>
              <p className="mt-2 text-2xl font-black text-emerald-600">{formatMoney(data.finance.cumulative.income)}</p>
            </article>
            <article className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-blu-steel">รายจ่ายสะสมทั้งหมด</h3>
              <p className="mt-2 text-2xl font-black text-rose-500">{formatMoney(data.finance.cumulative.expense)}</p>
            </article>
            <article className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-blu-steel">คงเหลือสุทธิสะสมทั้งหมด</h3>
              <p className={`mt-2 text-2xl font-black ${data.finance.cumulative.net >= 0 ? "text-blu-slate" : "text-rose-500"}`}>
                {formatMoney(data.finance.cumulative.net)}
              </p>
            </article>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <article className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-blu-steel">{`รายรับในช่วง (${periodLabel})`}</h3>
              <p className="mt-2 text-2xl font-black text-emerald-600">{formatMoney(data.finance.period.income)}</p>
            </article>
            <article className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-blu-steel">{`รายจ่ายในช่วง (${periodLabel})`}</h3>
              <p className="mt-2 text-2xl font-black text-rose-500">{formatMoney(data.finance.period.expense)}</p>
            </article>
            <article className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-blu-steel">{`คงเหลือสุทธิในช่วง (${periodLabel})`}</h3>
              <p className={`mt-2 text-2xl font-black ${data.finance.period.net >= 0 ? "text-blu-slate" : "text-rose-500"}`}>
                {formatMoney(data.finance.period.net)}
              </p>
            </article>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className={period.showDailyFinanceChart ? "" : "xl:col-span-2"}>
              <AdminDashboardChart
                title={
                  (period.mode === "day" && period.dateFrom !== period.dateTo) || (period.mode === "month" && period.monthFrom !== period.monthTo)
                    ? `รายรับ / รายจ่าย / สุทธิ รายเดือน (${period.monthFrom === period.monthTo ? period.monthFrom : `${period.monthFrom} ถึง ${period.monthTo}`})`
                    : `รายรับ / รายจ่าย / สุทธิ รายเดือน (ปี ${period.financeYear})`
                }
                subtitle={period.showDailyFinanceChart ? "อิง ledger จริงชุดเดียวกับหน้ารายรับ-รายจ่ายและไฟล์ส่งออก .xlsx" : "เลือกช่วงเกิน 60 วัน ระบบแสดงเฉพาะกราฟรายเดือนเพื่อให้อ่านง่าย"}
                data={data.finance.monthlyChart}
                series={financeSeries}
                type="bar"
                valueFormatter={compactMoney}
              />
            </div>
            {period.showDailyFinanceChart && (
              <AdminDashboardChart
                title={
                  (period.mode === "day" && period.dateFrom !== period.dateTo) || (period.mode === "month" && period.monthFrom !== period.monthTo)
                    ? `รายรับ / รายจ่าย / สุทธิ รายวัน (${period.label})`
                    : `รายรับ / รายจ่าย / สุทธิ รายวัน (เดือน ${data.finance.dailyChartMonth})`
                }
                subtitle="แสดงครบทุกวันในช่วงที่เลือก (ยอด 0 แสดงครบ)"
                data={data.finance.dailyChart}
                series={financeSeries}
                type="line"
                valueFormatter={compactMoney}
              />
            )}
          </div>

          <section className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-black text-blu-dark">
              รายการการเงินล่าสุดในช่วงที่เลือก (สูงสุด 10 รายการ)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b text-xs text-blu-steel">
                    <th className="p-3">วันที่</th>
                    <th className="p-3">ประเภท</th>
                    <th className="p-3">หมวดหมู่</th>
                    <th className="p-3">สมาชิก</th>
                    <th className="p-3">จำนวนเงิน</th>
                    <th className="p-3">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.finance.recentRecords.map((record) => (
                    <tr key={record.id} className="border-t">
                      <td className="whitespace-nowrap p-3">{formatDay(record.date)}</td>
                      <td className="p-3 font-semibold">{record.type === "INCOME" ? "รายรับ" : "รายจ่าย"}</td>
                      <td className="p-3">{record.category}</td>
                      <td className="p-3">
                        {record.memberCode ? (
                          <Link href={`/admin/members/${encodeURIComponent(record.memberCode)}`} className="underline">
                            {record.memberCode} {record.memberName ?? ""}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={`whitespace-nowrap p-3 font-bold ${record.type === "INCOME" ? "text-emerald-600" : "text-rose-500"}`}>
                        {formatMoney(record.amount)}
                      </td>
                      <td className="p-3 text-xs text-blu-steel">{record.note}</td>
                    </tr>
                  ))}
                  {!data.finance.recentRecords.length && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-blu-steel">
                        ไม่มีรายการในช่วงที่เลือก
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-black text-blu-dark">
            สมาชิกที่จะหมดอายุใน 30 วัน ({summary.expiringIn30Days.toLocaleString("th-TH")} คน)
          </h2>
          {data.expiring.slice(0, 20).map((row) => (
            <p key={row.memberCode} className="border-t py-2.5 text-sm">
              <Link className="font-semibold text-blu-slate underline" href={`/admin/members/${encodeURIComponent(row.memberCode)}`}>
                {row.fullName}
              </Link>{" "}
              <span className="font-mono text-xs text-blu-steel">({row.memberCode})</span> · หมดอายุ {formatDateTime(row.expireDate)}
            </p>
          ))}
          {data.expiring.length > 20 && (
            <p className="mt-2 text-xs text-blu-steel">
              แสดง 20 รายการแรก จากทั้งหมด {data.expiring.length.toLocaleString("th-TH")} คน
            </p>
          )}
          {!data.expiring.length && <p className="text-sm text-blu-steel">ไม่มีรายการ</p>}
        </section>

        <section className="rounded-2xl border border-blu-sky/40 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-black text-blu-dark">
            เช็คอินล่าสุดในช่วงที่เลือก (สูงสุด 10 รายการ)
          </h2>
          {data.visits.map((row) => (
            <p key={row.id} className="border-t py-2.5 text-sm">
              <Link className="font-semibold text-blu-slate underline" href={`/admin/members/${encodeURIComponent(row.memberCode)}`}>
                {row.fullName}
              </Link>{" "}
              <span className="font-mono text-xs text-blu-steel">({row.memberCode})</span> · {formatDateTime(row.checkinTime)}
            </p>
          ))}
          {!data.visits.length && <p className="text-sm text-blu-steel">ไม่มีรายการ</p>}
        </section>
      </div>
    </div>
  );
}
