export interface ChartSeries {
  key: string;
  label: string;
  color: string;
}

export interface ChartDatum {
  label: string;
  values: Record<string, number>;
}

interface ChartProps {
  title: string;
  data: ChartDatum[];
  series: ChartSeries[];
  type: "line" | "bar";
  valueFormatter?: (value: number) => string;
}

const WIDTH = 760;
const HEIGHT = 300;
const PADDING = { top: 24, right: 18, bottom: 42, left: 62 };

function compactNumber(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${Math.round(value / 1_000)}k`;
  return value.toLocaleString("th-TH");
}

function chartRange(data: ChartDatum[], series: ChartSeries[]) {
  const values = data.flatMap((item) => series.map((line) => item.values[line.key] ?? 0));
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(1, ...values);
  const padding = Math.max((maximum - minimum) * 0.08, 1);
  return { minimum: minimum < 0 ? minimum - padding : 0, maximum: maximum + padding };
}

export default function AdminDashboardChart({
  title,
  data,
  series,
  type,
  valueFormatter = compactNumber,
}: ChartProps) {
  const { minimum, maximum } = chartRange(data, series);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const y = (value: number) => PADDING.top + ((maximum - value) / (maximum - minimum)) * plotHeight;
  const x = (index: number) =>
    PADDING.left + (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - (index * (maximum - minimum)) / 4);
  const zeroY = y(0);
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));
  const groupWidth = plotWidth / Math.max(data.length, 1);
  const barWidth = Math.min(22, (groupWidth * 0.72) / Math.max(series.length, 1));

  return (
    <section className="rounded-2xl border border-blu-sky/40 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-sm font-black text-blu-dark">{title}</h3>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {series.map((item) => (
          <span key={item.key} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-blu-steel">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="min-w-155 w-full" role="img" aria-label={title}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y(tick)} y2={y(tick)} stroke="#dcecf1" strokeWidth="1" />
              <text x={PADDING.left - 10} y={y(tick) + 4} textAnchor="end" fontSize="10" fill="#5c93aa">
                {valueFormatter(Math.round(tick))}
              </text>
            </g>
          ))}
          {minimum < 0 && <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={zeroY} y2={zeroY} stroke="#86b6c6" strokeWidth="1.5" />}

          {type === "line" && series.map((item) => {
            const points = data.map((datum, index) => `${x(index)},${y(datum.values[item.key] ?? 0)}`).join(" ");
            return (
              <g key={item.key}>
                <polyline points={points} fill="none" stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                {data.map((datum, index) => (
                  <circle key={`${item.key}-${datum.label}`} cx={x(index)} cy={y(datum.values[item.key] ?? 0)} r="3.5" fill="white" stroke={item.color} strokeWidth="2">
                    <title>{`${item.label}: ${valueFormatter(datum.values[item.key] ?? 0)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}

          {type === "bar" && data.flatMap((datum, datumIndex) =>
            series.map((item, seriesIndex) => {
              const value = datum.values[item.key] ?? 0;
              const barX = PADDING.left + datumIndex * groupWidth + (groupWidth - barWidth * series.length) / 2 + seriesIndex * barWidth;
              const top = value >= 0 ? y(value) : zeroY;
              const height = Math.max(1, Math.abs(y(value) - zeroY));
              return (
                <rect key={`${datum.label}-${item.key}`} x={barX} y={top} width={Math.max(barWidth - 2, 2)} height={height} rx="3" fill={item.color} opacity="0.9">
                  <title>{`${datum.label} · ${item.label}: ${valueFormatter(value)}`}</title>
                </rect>
              );
            }),
          )}

          {data.map((datum, index) => index % labelEvery === 0 || index === data.length - 1 ? (
            <text key={datum.label} x={type === "bar" ? PADDING.left + index * groupWidth + groupWidth / 2 : x(index)} y={HEIGHT - 16} textAnchor="middle" fontSize="10" fill="#5c93aa">
              {datum.label}
            </text>
          ) : null)}
        </svg>
      </div>
    </section>
  );
}
