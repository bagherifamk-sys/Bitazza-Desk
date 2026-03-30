import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { AnalyticsFilters, Channel, TicketCategory } from '../types';
import { api } from '../api';
import { Tabs } from './ui/Tabs';
import { ChartBarSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  volume?: {
    total: number;
    by_day: { date: string; count: number }[];
    by_channel: { channel: string; count: number }[];
    by_category: { category: string; count: number }[];
  };
  response_time?: {
    avg_s: number; median_s: number; p90_s: number;
    by_day: { date: string; avg_s: number }[];
  };
  resolution?: {
    avg_s: number;
    by_channel: { channel: string; avg_s: number }[];
  };
  bot?: {
    resolution_rate: number; handoff_rate: number;
    by_day: { date: string; bot: number; human: number }[];
  };
  csat?: {
    avg: number | null; count: number;
    distribution: { score: number; count: number }[];
    by_channel: { channel: string; avg: number }[];
  };
  intent?: {
    top: { category: string; count: number; pct: number }[];
  };
}

const TABS = ['Volume', 'Response Time', 'Resolution', 'Bot Performance', 'CSAT', 'Intent'] as const;
type Tab = typeof TABS[number];

const DATE_RANGES = [
  { id: 'today' as const, label: 'Today' },
  { id: '7d'   as const, label: '7 days' },
  { id: '30d'  as const, label: '30 days' },
];

const CHANNELS: Channel[] = ['web', 'line', 'facebook', 'email'];
const CATEGORIES: TicketCategory[] = [
  'kyc','deposit_fiat','deposit_crypto','withdrawal_fiat','withdrawal_crypto',
  'change_information','account_security','trading_platform','general',
];

function fmtSeconds(s: number | null | undefined): string {
  const n = Number(s);
  if (!n || isNaN(n)) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

// ── Semantic chart colors ─────────────────────────────────────────────────────
const CHANNEL_COLORS: Record<string, string> = {
  web: '#3B82F6', line: '#22C55E', facebook: '#8B5CF6', email: '#F59E0B',
};
const CHART_COLORS = ['#E63946', '#3B82F6', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

// ── Custom chart tooltip ──────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-3 ring-1 ring-surface-5 rounded-lg px-3 py-2 shadow-panel text-xs">
      {label && <p className="text-text-muted mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-text-secondary">{p.name ?? p.dataKey}:</span>
          <span className="text-text-primary font-medium">
            {formatter ? formatter(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function ChartBox({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-5 mb-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg px-4 py-3.5">
      <div className="text-lg font-bold font-inter-nums text-text-primary">{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function MetricRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-${Math.min(4, items.length)} gap-3 mb-5`}>
      {items.map(i => <MetricCard key={i.label} {...i} />)}
    </div>
  );
}

function NoData() {
  return (
    <EmptyState
      title="No data available"
      description="Try a wider date range or check your backend connection."
      className="h-48 border border-dashed border-surface-5 rounded-lg"
    />
  );
}

// ── Chart axis/grid defaults ──────────────────────────────────────────────────
const AXIS_STYLE = { fontSize: 11, fill: '#8B92A5' };
const GRID_COLOR = 'var(--surface-5)';

// ── Tab content ───────────────────────────────────────────────────────────────

function TabContent({ tab, data }: { tab: Tab; data: AnalyticsData | null }) {
  if (!data) return <NoData />;

  switch (tab) {
    case 'Volume': {
      const v = data.volume;
      return (
        <>
          <MetricRow items={[
            { label: 'Total',         value: String(v?.total ?? '—') },
            { label: 'Top Channel',   value: v?.by_channel?.[0]?.channel ?? '—' },
            { label: 'Top Category',  value: v?.by_category?.[0]?.category?.replace(/_/g, ' ') ?? '—' },
          ]} />
          <ChartBox title="Tickets per day">
            {v?.by_day?.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={v.by_day}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="date" tick={AXIS_STYLE} />
                  <YAxis tick={AXIS_STYLE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="count" name="Tickets" stroke="#E63946" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartBox>
          <ChartBox title="Volume by channel">
            {v?.by_channel?.length ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={v.by_channel}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="channel" tick={AXIS_STYLE} />
                  <YAxis tick={AXIS_STYLE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="Tickets" radius={[3, 3, 0, 0]}>
                    {v.by_channel.map((entry, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[entry.channel] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartBox>
        </>
      );
    }

    case 'Response Time': {
      const rt = data.response_time;
      return (
        <>
          <MetricRow items={[
            { label: 'Avg First Reply', value: fmtSeconds(rt?.avg_s) },
            { label: 'Median',          value: fmtSeconds(rt?.median_s) },
            { label: 'P90',             value: fmtSeconds(rt?.p90_s) },
          ]} />
          <ChartBox title="Avg first reply time per day">
            {rt?.by_day?.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={rt.by_day}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="date" tick={AXIS_STYLE} />
                  <YAxis tick={AXIS_STYLE} />
                  <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                  <Line type="monotone" dataKey="avg_s" name="Avg Reply" stroke="#3B82F6" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartBox>
        </>
      );
    }

    case 'Resolution': {
      const res = data.resolution;
      return (
        <>
          <MetricRow items={[{ label: 'Avg Resolution', value: fmtSeconds(res?.avg_s) }]} />
          <ChartBox title="Avg resolution time by channel">
            {res?.by_channel?.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={res.by_channel}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="channel" tick={AXIS_STYLE} />
                  <YAxis tick={AXIS_STYLE} />
                  <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                  <Bar dataKey="avg_s" name="Avg Resolution" radius={[3, 3, 0, 0]}>
                    {res.by_channel.map((entry, i) => (
                      <Cell key={i} fill={CHANNEL_COLORS[entry.channel] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartBox>
        </>
      );
    }

    case 'Bot Performance': {
      const bot = data.bot;
      return (
        <>
          <MetricRow items={[
            { label: 'Bot Resolution Rate', value: bot ? `${Math.round(bot.resolution_rate * 100)}%` : '—' },
            { label: 'Handoff Rate',        value: bot ? `${Math.round(bot.handoff_rate * 100)}%` : '—' },
          ]} />
          <ChartBox title="Bot vs Human resolutions per day">
            {bot?.by_day?.length ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={bot.by_day}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                  <XAxis dataKey="date" tick={AXIS_STYLE} />
                  <YAxis tick={AXIS_STYLE} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ ...AXIS_STYLE }} />
                  <Bar dataKey="bot"   name="Bot"   fill="#22C55E" radius={[3,3,0,0]} />
                  <Bar dataKey="human" name="Human" fill="#3B82F6" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <NoData />}
          </ChartBox>
        </>
      );
    }

    case 'CSAT': {
      const csat = data.csat;
      return (
        <>
          <MetricRow items={[
            { label: 'Avg CSAT',   value: csat?.avg != null ? `${Number(csat.avg).toFixed(2)} ★` : '—' },
            { label: 'Responses',  value: String(csat?.count ?? '—') },
          ]} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartBox title="Score distribution">
              {csat?.distribution?.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={csat.distribution}
                      dataKey="count"
                      nameKey="score"
                      cx="50%" cy="50%"
                      outerRadius={75}
                      label={({ payload }: any) => payload?.score ? `${payload.score}★` : ''}
                    >
                      {csat.distribution.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <NoData />}
            </ChartBox>
            <ChartBox title="Avg CSAT by channel">
              {csat?.by_channel?.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={csat.by_channel}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                    <XAxis dataKey="channel" tick={AXIS_STYLE} />
                    <YAxis domain={[0, 5]} tick={AXIS_STYLE} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="avg" name="CSAT" radius={[3,3,0,0]}>
                      {csat.by_channel.map((entry, i) => (
                        <Cell key={i} fill={CHANNEL_COLORS[entry.channel] ?? CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : <NoData />}
            </ChartBox>
          </div>
        </>
      );
    }

    case 'Intent': {
      const intent = data.intent;
      return (
        <ChartBox title="Top categories by volume">
          {intent?.top?.length ? (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={intent.top} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                  <XAxis type="number" tick={AXIS_STYLE} />
                  <YAxis dataKey="category" type="category" tick={AXIS_STYLE} width={130}
                    tickFormatter={(v: string) => v.replace(/_/g, ' ')} />
                  <Tooltip content={<ChartTooltip formatter={(v: number, _: any, p: any) =>
                    `${v} (${Math.round((p?.payload?.pct ?? 0) * 100)}%)`
                  } />} />
                  <Bar dataKey="count" name="Tickets" radius={[0,3,3,0]}>
                    {intent.top.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-1">
                {intent.top.map(r => (
                  <div key={r.category} className="flex items-center justify-between text-xs py-1 border-b border-surface-5 last:border-0">
                    <span className="text-text-secondary capitalize">{r.category.replace(/_/g, ' ')}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-text-primary font-mono tabular-nums">{r.count}</span>
                      <span className="text-text-muted w-10 text-right tabular-nums">{Math.round(r.pct * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <NoData />}
        </ChartBox>
      );
    }

    default: return <NoData />;
  }
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const [tab, setTab]         = useState<Tab>('Volume');
  const [filters, setFilters] = useState<AnalyticsFilters>({ date_range: '7d' });
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    api.getAnalytics(filters)
      .then(d => setData(d as AnalyticsData))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [filters]);

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="max-w-5xl mx-auto p-6">

        {/* Header + filters */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <h2 className="text-lg font-bold text-text-primary">Analytics</h2>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Date range */}
            <div className="flex bg-surface-3 ring-1 ring-surface-5 rounded-md overflow-hidden">
              {DATE_RANGES.map(r => (
                <button key={r.id}
                  onClick={() => setFilters(f => ({ ...f, date_range: r.id }))}
                  className={`text-xs px-3 py-1.5 transition-colors ${
                    filters.date_range === r.id ? 'bg-brand text-white' : 'text-text-secondary hover:text-text-primary'
                  }`}>
                  {r.label}
                </button>
              ))}
            </div>

            {/* Channel filter */}
            <select
              value={filters.channel ?? ''}
              onChange={e => setFilters(f => ({ ...f, channel: (e.target.value as Channel) || undefined }))}
              className="text-xs bg-surface-3 ring-1 ring-surface-5 text-text-primary px-2.5 py-1.5 rounded-md outline-none focus:ring-brand"
            >
              <option value="">All channels</option>
              {CHANNELS.map(c => <option key={c} value={c} className="bg-surface-3">{c}</option>)}
            </select>

            {/* Category filter */}
            <select
              value={filters.category ?? ''}
              onChange={e => setFilters(f => ({ ...f, category: (e.target.value as TicketCategory) || undefined }))}
              className="text-xs bg-surface-3 ring-1 ring-surface-5 text-text-primary px-2.5 py-1.5 rounded-md outline-none focus:ring-brand"
            >
              <option value="">All categories</option>
              {CATEGORIES.map(c => <option key={c} value={c} className="bg-surface-3">{c.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          tabs={TABS.map(t => ({ id: t, label: t }))}
          activeId={tab}
          onChange={id => setTab(id as Tab)}
          className="mb-5"
        />

        {error && (
          <div className="flex items-center gap-2 bg-brand/10 ring-1 ring-brand/20 text-brand text-xs px-4 py-3 rounded-lg mb-5">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[1,2,3].map(i => (
                <div key={i} className="bg-surface-2 ring-1 ring-surface-5 rounded-lg px-4 py-4">
                  <div className="h-6 w-16 bg-surface-4 animate-pulse rounded mb-2" />
                  <div className="h-3 w-24 bg-surface-4 animate-pulse rounded" />
                </div>
              ))}
            </div>
            <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-5">
              <ChartBarSkeleton bars={10} />
            </div>
          </div>
        ) : (
          <TabContent tab={tab} data={data} />
        )}
      </div>
    </div>
  );
}
