import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import type { AnalyticsFilters, Channel, TicketCategory } from '../types';
import { api } from '../api';

// ── Types matching /api/analytics response ────────────────────────────────────
interface AnalyticsData {
  volume?: {
    total: number;
    by_day: { date: string; count: number }[];
    by_channel: { channel: string; count: number }[];
    by_category: { category: string; count: number }[];
  };
  response_time?: {
    avg_s: number;
    median_s: number;
    p90_s: number;
    by_day: { date: string; avg_s: number }[];
  };
  resolution?: {
    avg_s: number;
    by_channel: { channel: string; avg_s: number }[];
  };
  bot?: {
    resolution_rate: number;
    handoff_rate: number;
    by_day: { date: string; bot: number; human: number }[];
  };
  csat?: {
    avg: number | null;
    count: number;
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

// Monochrome chart colors
const MONO = ['#000', '#333', '#666', '#999', '#CCC'];

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
    <div className="flex-1 overflow-y-auto p-6 bg-white">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 border-b border-[#EAEAEA] pb-4">
        <h2 className="text-sm font-bold text-[#000] uppercase tracking-wide">Analytics</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5 border border-[#EAEAEA] px-4 py-3">
        {/* Date range */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#999]">Period</span>
          <div className="flex border border-[#CCC] overflow-hidden">
            {DATE_RANGES.map(r => (
              <button
                key={r.id}
                onClick={() => setFilters(f => ({ ...f, date_range: r.id }))}
                className={`text-[11px] px-3 py-1 transition-colors border-r border-[#CCC] last:border-0 ${
                  filters.date_range === r.id ? 'bg-[#000] text-white' : 'text-[#333] hover:bg-[#f5f5f5]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Channel */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#999]">Channel</span>
          <select
            value={filters.channel ?? ''}
            onChange={e => setFilters(f => ({ ...f, channel: (e.target.value as Channel) || undefined }))}
            className="text-[11px] border border-[#CCC] px-2 py-1 outline-none focus:border-[#000]"
          >
            <option value="">All</option>
            {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Category */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#999]">Category</span>
          <select
            value={filters.category ?? ''}
            onChange={e => setFilters(f => ({ ...f, category: (e.target.value as TicketCategory) || undefined }))}
            className="text-[11px] border border-[#CCC] px-2 py-1 outline-none focus:border-[#000]"
          >
            <option value="">All</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 mb-5 border-b border-[#EAEAEA]">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-4 py-2 border-b-2 whitespace-nowrap transition-colors ${
              tab === t
                ? 'border-[#000] text-[#000] font-semibold'
                : 'border-transparent text-[#999] hover:text-[#333]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F] mb-4">{error}</div>
      )}

      {loading
        ? <div className="flex items-center justify-center h-48 text-[#999] text-sm">Loading…</div>
        : <TabContent tab={tab} data={data} />
      }
    </div>
  );
}

// ── Chart wrapper ─────────────────────────────────────────────────────────────
function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#EAEAEA] p-4 mb-4">
      <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wide mb-3">{title}</p>
      {children}
    </div>
  );
}

function KpiRow({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
      {items.map(i => (
        <div key={i.label} className="border border-[#EAEAEA] px-3 py-3">
          <div className="text-lg font-bold text-[#000]">{i.value}</div>
          <div className="text-[10px] text-[#999] mt-0.5 uppercase tracking-wide">{i.label}</div>
        </div>
      ))}
    </div>
  );
}

function NoData() {
  return (
    <div className="h-48 flex items-center justify-center border border-dashed border-[#EAEAEA] text-xs text-[#999]">
      No data — run backend analytics route
    </div>
  );
}

// ── Tab content ───────────────────────────────────────────────────────────────
function TabContent({ tab, data }: { tab: Tab; data: AnalyticsData | null }) {
  if (!data) return <NoData />;

  switch (tab) {

    case 'Volume': {
      const v = data.volume;
      return (
        <>
          <KpiRow items={[
            { label: 'Total', value: String(v?.total ?? '—') },
            { label: 'Top Channel', value: v?.by_channel?.[0]?.channel ?? '—' },
            { label: 'Top Category', value: v?.by_category?.[0]?.category?.replace(/_/g, ' ') ?? '—' },
          ]} />
          <ChartBox title="Tickets per day">
            {v?.by_day?.length
              ? <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={v.by_day}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#000" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
          <ChartBox title="Volume by channel">
            {v?.by_channel?.length
              ? <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={v.by_channel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="channel" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#000" />
                  </BarChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </>
      );
    }

    case 'Response Time': {
      const rt = data.response_time;
      return (
        <>
          <KpiRow items={[
            { label: 'Avg First Reply', value: fmtSeconds(rt?.avg_s) },
            { label: 'Median',          value: fmtSeconds(rt?.median_s) },
            { label: 'P90',             value: fmtSeconds(rt?.p90_s) },
          ]} />
          <ChartBox title="Avg first reply time per day (seconds)">
            {rt?.by_day?.length
              ? <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={rt.by_day}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: unknown) => fmtSeconds(v as number)} />
                    <Line type="monotone" dataKey="avg_s" stroke="#000" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </>
      );
    }

    case 'Resolution': {
      const res = data.resolution;
      return (
        <>
          <KpiRow items={[
            { label: 'Avg Resolution', value: fmtSeconds(res?.avg_s) },
          ]} />
          <ChartBox title="Avg resolution time by channel (seconds)">
            {res?.by_channel?.length
              ? <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={res.by_channel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="channel" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: unknown) => fmtSeconds(v as number)} />
                    <Bar dataKey="avg_s" fill="#333" />
                  </BarChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </>
      );
    }

    case 'Bot Performance': {
      const bot = data.bot;
      return (
        <>
          <KpiRow items={[
            { label: 'Bot Resolution Rate', value: bot ? `${Math.round(bot.resolution_rate * 100)}%` : '—' },
            { label: 'Handoff Rate',        value: bot ? `${Math.round(bot.handoff_rate * 100)}%` : '—' },
          ]} />
          <ChartBox title="Bot vs Human resolutions per day">
            {bot?.by_day?.length
              ? <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={bot.by_day}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="bot"   name="Bot"   fill="#000" />
                    <Bar dataKey="human" name="Human" fill="#999" />
                  </BarChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </>
      );
    }

    case 'CSAT': {
      const csat = data.csat;
      return (
        <>
          <KpiRow items={[
            { label: 'Avg CSAT', value: csat?.avg != null ? Number(csat.avg).toFixed(2) : '—' },
            { label: 'Responses', value: String(csat?.count ?? '—') },
          ]} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ChartBox title="Score distribution">
              {csat?.distribution?.length
                ? <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={csat.distribution}
                        dataKey="count"
                        nameKey="score"
                        cx="50%" cy="50%"
                        outerRadius={80}
                        label={({ payload }: { payload?: { score?: number; pct?: number } }) => payload?.score ? `${payload.score}★ ${Math.round((payload.pct ?? 0) * 100)}%` : ''}
                      >
                        {csat.distribution.map((_, i) => (
                          <Cell key={i} fill={MONO[i % MONO.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                : <NoData />
              }
            </ChartBox>
            <ChartBox title="Avg CSAT by channel">
              {csat?.by_channel?.length
                ? <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={csat.by_channel}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="channel" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 5]} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="avg" fill="#333" />
                    </BarChart>
                  </ResponsiveContainer>
                : <NoData />
              }
            </ChartBox>
          </div>
        </>
      );
    }

    case 'Intent': {
      const intent = data.intent;
      return (
        <>
          <ChartBox title="Top categories by volume">
            {intent?.top?.length
              ? <>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={intent.top} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis dataKey="category" type="category" tick={{ fontSize: 10 }} width={120} />
                      <Tooltip formatter={(v: unknown, _: unknown, p: unknown) => [`${v} (${Math.round(((p as { payload: { pct: number } }).payload.pct ?? 0) * 100)}%)`, 'Count']} />
                      <Bar dataKey="count" fill="#000" />
                    </BarChart>
                  </ResponsiveContainer>
                  <table className="w-full text-xs mt-3">
                    <thead>
                      <tr className="text-[#999] border-b border-[#EAEAEA]">
                        <th className="text-left pb-1 font-medium">Category</th>
                        <th className="text-right pb-1 font-medium">Count</th>
                        <th className="text-right pb-1 font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intent.top.map(r => (
                        <tr key={r.category} className="border-b border-[#f5f5f5] last:border-0">
                          <td className="py-1 text-[#333]">{r.category.replace(/_/g, ' ')}</td>
                          <td className="py-1 text-right text-[#333]">{r.count}</td>
                          <td className="py-1 text-right text-[#999]">{Math.round(r.pct * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              : <NoData />
            }
          </ChartBox>
        </>
      );
    }

    default: return <NoData />;
  }
}
