import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface KpiCardProps {
  label: string;
  value: number | string;
  sub?: string;
  /** Semantic color key for left-border accent */
  accent?: 'brand' | 'blue' | 'green' | 'amber';
  trend?: number; // positive = up, negative = down
  /** Whether a positive trend is good (green) or bad (red) */
  trendGoodDirection?: 'up' | 'down';
  sparkline?: number[];
  pulse?: boolean; // pulsing accent for urgent KPIs
  onClick?: () => void;
}

const ACCENT = {
  brand: { border: 'border-l-brand', text: 'text-brand' },
  blue:  { border: 'border-l-accent-blue',  text: 'text-accent-blue'  },
  green: { border: 'border-l-accent-green', text: 'text-accent-green' },
  amber: { border: 'border-l-accent-amber', text: 'text-accent-amber' },
};

export function KpiCard({ label, value, sub, accent = 'blue', trend, trendGoodDirection = 'up', sparkline, pulse = false, onClick }: KpiCardProps) {
  const accentCfg = ACCENT[accent];

  const trendPositive = trend !== undefined && trend > 0;
  const trendIsGood =
    trendGoodDirection === 'up' ? trendPositive : !trendPositive;

  return (
    <div
      onClick={onClick}
      className={`
        bg-surface-2 ring-1 ring-surface-5 rounded-lg p-5 border-l-2
        ${accentCfg.border}
        ${pulse ? 'animate-pulse-border' : ''}
        ${onClick ? 'cursor-pointer hover:bg-surface-3 transition-colors' : ''}
        flex flex-col gap-3
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">{label}</span>
        {trend !== undefined && trend !== 0 && (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${trendIsGood ? 'text-accent-green' : 'text-brand'}`}>
            <svg className={`w-3 h-3 ${trend > 0 ? '' : 'rotate-180'}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd"/>
            </svg>
            {Math.abs(trend)}
          </span>
        )}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <div className={`text-xl font-bold font-inter-nums ${accentCfg.text}`}>{value}</div>
          {sub && <div className="text-xs text-text-muted mt-0.5">{sub}</div>}
        </div>

        {sparkline && sparkline.length > 1 && (
          <div className="w-20 h-10 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparkline.map((v, i) => ({ i, v }))}>
                <Line
                  type="monotone"
                  dataKey="v"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  dot={false}
                  className={accentCfg.text}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
