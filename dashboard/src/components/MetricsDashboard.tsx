/**
 * Metrics Dashboard — FR-17
 * Supervisor + super_admin only.
 * FRT (first reply time) | AHT (avg handle time) | CSAT
 * Data: GET /api/metrics?agent_id&channel&from&to
 */
import { useState, useEffect } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  type PieLabelRenderProps,
} from 'recharts';
import { ChartBarSkeleton } from './ui/Skeleton';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetricsData {
  frt: {
    avg_s: number;
    by_agent: { name: string; avg_s: number }[];
    over_time: { date: string; avg_s: number }[];
  };
  aht: {
    avg_s: number;
    by_channel: { channel: string; avg_s: number }[];
    over_time: { date: string; avg_s: number }[];
  };
  csat: {
    avg: number | null;
    count: number;
    distribution: { score: number; count: number }[];
    by_agent: { name: string; avg: number; count: number }[];
  };
  summary: {
    total_tickets: number;
    resolved: number;
    escalated: number;
    sla_breached: number;
    resolution_rate: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSeconds(s: number | null | undefined): string {
  const n = Number(s);
  if (!n || isNaN(n)) return '—';
  if (n < 60)   return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

// Semantic chart colors
const FRT_COLOR   = '#3B82F6'; // blue
const AHT_COLOR   = '#22C55E'; // green
const CSAT_COLORS = ['#E63946', '#F59E0B', '#8B92A5', '#22C55E', '#3B82F6']; // 1★→5★

const CHANNEL_COLORS: Record<string, string> = {
  web:      '#3B82F6',
  line:     '#22C55E',
  facebook: '#8B5CF6',
  email:    '#F59E0B',
};

const API  = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function getToken() {
  try { return (JSON.parse(localStorage.getItem('auth_user') ?? '{}')).token ?? ''; } catch { return ''; }
}

// ── Custom chart tooltip ───────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-3 ring-1 ring-surface-5 rounded-lg shadow-panel px-3 py-2 text-xs">
      {label && <p className="text-text-muted mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color ?? 'var(--text-primary)' }}>
          {formatter ? formatter(p.value) : p.value}
        </p>
      ))}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

interface Filters { agent_id: string; channel: string; from: string; to: string; range: '7d' | '30d' | 'custom' }

// ── Main ──────────────────────────────────────────────────────────────────────

export default function MetricsDashboard() {
  const [filters, setFilters] = useState<Filters>({
    agent_id: '', channel: '', from: '', to: '',
    range: '7d',
  });
  const [data, setData]       = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const load = () => {
    setLoading(true); setError('');
    const params = new URLSearchParams();
    if (filters.agent_id) params.set('agent_id', filters.agent_id);
    if (filters.channel)  params.set('channel',  filters.channel);
    if (filters.range !== 'custom') {
      params.set('range', filters.range);
    } else {
      if (filters.from) params.set('from', filters.from);
      if (filters.to)   params.set('to',   filters.to);
    }

    fetch(`${API}/api/metrics?${params}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filters.range, filters.agent_id, filters.channel]);

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Metrics</h2>
            <p className="text-sm text-text-secondary mt-0.5">FRT · AHT · CSAT performance</p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary bg-surface-3 ring-1 ring-surface-5 rounded-md px-3 py-1.5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
            </svg>
            Refresh
          </button>
        </div>

        {/* Filters */}
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg px-4 py-3 flex flex-wrap items-center gap-4">
          {/* Range pills */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Period</span>
            <div className="flex bg-surface-3 ring-1 ring-surface-5 rounded-md overflow-hidden p-0.5 gap-0.5">
              {(['7d', '30d', 'custom'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setFilters(f => ({ ...f, range: r }))}
                  className={`text-xs px-3 py-1 rounded transition-colors ${
                    filters.range === r
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface-4'
                  }`}
                >
                  {r === '7d' ? '7 days' : r === '30d' ? '30 days' : 'Custom'}
                </button>
              ))}
            </div>
          </div>

          {filters.range === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={filters.from}
                onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
                className="text-xs bg-surface-3 ring-1 ring-surface-5 rounded px-2 py-1 text-text-primary outline-none focus:ring-brand transition-all [color-scheme:dark]"
              />
              <span className="text-text-muted text-xs">–</span>
              <input
                type="date"
                value={filters.to}
                onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
                className="text-xs bg-surface-3 ring-1 ring-surface-5 rounded px-2 py-1 text-text-primary outline-none focus:ring-brand transition-all [color-scheme:dark]"
              />
              <button
                onClick={load}
                className="text-xs bg-brand hover:bg-brand-dim text-white px-3 py-1 rounded transition-colors"
              >
                Apply
              </button>
            </div>
          )}

          {/* Channel */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Channel</span>
            <div className="flex bg-surface-3 ring-1 ring-surface-5 rounded-md overflow-hidden p-0.5 gap-0.5">
              {['', 'web', 'line', 'facebook', 'email'].map(c => (
                <button
                  key={c || 'all'}
                  onClick={() => setFilters(f => ({ ...f, channel: c }))}
                  className={`text-xs px-2.5 py-1 rounded capitalize transition-colors ${
                    filters.channel === c
                      ? 'bg-brand text-white'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface-4'
                  }`}
                >
                  {c || 'All'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-brand/10 ring-1 ring-brand/20 text-brand text-xs px-4 py-3 rounded-lg">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
            </svg>
            {error}
          </div>
        )}

        {loading ? (
          <LoadingSkeleton />
        ) : data ? (
          <MetricsContent data={data} />
        ) : (
          <div className="flex items-center justify-center h-48 bg-surface-2 ring-1 ring-surface-5 ring-dashed rounded-lg">
            <p className="text-sm text-text-muted">No data — backend may be offline</p>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-surface-2 ring-1 ring-surface-5 rounded-lg px-4 py-3.5 space-y-2">
            <div className="h-5 w-16 bg-surface-4 animate-pulse rounded" />
            <div className="h-2.5 w-20 bg-surface-4 animate-pulse rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChartBarSkeleton bars={7} />
        <ChartBarSkeleton bars={5} />
      </div>
    </div>
  );
}

// ── Content ───────────────────────────────────────────────────────────────────

function MetricsContent({ data }: { data: MetricsData }) {
  return (
    <div className="space-y-6">

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricKpiCard label="Total Tickets"   value={String(data.summary.total_tickets ?? '—')} />
        <MetricKpiCard label="Resolved"        value={String(data.summary.resolved ?? '—')} accent="green" />
        <MetricKpiCard
          label="Resolution Rate"
          value={data.summary.resolution_rate != null ? `${Math.round(Number(data.summary.resolution_rate) * 100)}%` : '—'}
          accent="blue"
        />
        <MetricKpiCard label="Escalated"   value={String(data.summary.escalated ?? '—')}  alert={Number(data.summary.escalated) > 0} />
        <MetricKpiCard label="SLA Breached" value={String(data.summary.sla_breached ?? '—')} alert={Number(data.summary.sla_breached) > 0} />
      </div>

      {/* FRT section */}
      <Section title="First Reply Time (FRT)" color={FRT_COLOR}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <HeroMetric value={fmtSeconds(data.frt.avg_s)} label="average" color={FRT_COLOR} />
            <ChartBox title="FRT over time">
              {data.frt.over_time?.length
                ? <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={data.frt.over_time}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-5)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
                      <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                      <Line type="monotone" dataKey="avg_s" stroke={FRT_COLOR} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                : <NoData />
              }
            </ChartBox>
          </div>

          <ChartBox title="FRT by agent">
            {data.frt.by_agent?.length
              ? <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.frt.by_agent} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-5)" />
                    <XAxis type="number" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={80} />
                    <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                    <Bar dataKey="avg_s" fill={FRT_COLOR} radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </div>
      </Section>

      {/* AHT section */}
      <Section title="Average Handle Time (AHT)" color={AHT_COLOR}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <HeroMetric value={fmtSeconds(data.aht.avg_s)} label="average" color={AHT_COLOR} />
            <ChartBox title="AHT over time">
              {data.aht.over_time?.length
                ? <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={data.aht.over_time}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-5)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                      <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
                      <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                      <Line type="monotone" dataKey="avg_s" stroke={AHT_COLOR} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                : <NoData />
              }
            </ChartBox>
          </div>

          <ChartBox title="AHT by channel">
            {data.aht.by_channel?.length
              ? <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.aht.by_channel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-5)" />
                    <XAxis dataKey="channel" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
                    <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                    <Bar dataKey="avg_s" radius={[3, 3, 0, 0]}>
                      {data.aht.by_channel.map((entry, i) => (
                        <Cell key={i} fill={CHANNEL_COLORS[entry.channel] ?? AHT_COLOR} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </div>
      </Section>

      {/* CSAT section */}
      <Section title="Customer Satisfaction (CSAT)" color="#F59E0B">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Hero CSAT score */}
          <div className="bg-surface-3 ring-1 ring-surface-5 rounded-lg flex flex-col items-center justify-center py-8 gap-2">
            <span
              className="text-5xl font-bold font-inter-nums tabular-nums"
              style={{ color: data.csat.avg != null && Number(data.csat.avg) >= 4 ? '#22C55E' : Number(data.csat.avg) >= 3 ? '#F59E0B' : '#E63946' }}
            >
              {data.csat.avg != null ? Number(data.csat.avg).toFixed(2) : '—'}
            </span>
            <span className="text-xs text-text-muted">avg score (1–5 ★)</span>
            <span className="text-[10px] text-text-muted">{data.csat.count} responses</span>
          </div>

          <ChartBox title="Score distribution">
            {data.csat.distribution?.length
              ? <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={data.csat.distribution}
                      dataKey="count"
                      nameKey="score"
                      cx="50%" cy="50%"
                      outerRadius={70}
                      label={({ payload }: PieLabelRenderProps & { payload?: { score?: number } }) =>
                        payload?.score ? `${payload.score}★` : ''
                      }
                    >
                      {data.csat.distribution.map((_, i) => (
                        <Cell key={i} fill={CSAT_COLORS[i % CSAT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: unknown, _: unknown, p: unknown) => [
                        `${v} responses`,
                        `${(p as { payload: { score: number } }).payload.score}★`,
                      ]}
                      contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--surface-5)', borderRadius: 8, fontSize: 11 }}
                      labelStyle={{ color: 'var(--text-muted)' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10, color: 'var(--text-muted)' }} formatter={v => `${v}★`} />
                  </PieChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>

          <ChartBox title="CSAT by agent">
            {data.csat.by_agent?.length
              ? <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.csat.by_agent} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-5)" />
                    <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fill: 'var(--text-muted)' }} width={70} />
                    <Tooltip
                      formatter={(v: unknown) => [(v as number).toFixed(2), 'Avg CSAT']}
                      contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--surface-5)', borderRadius: 8, fontSize: 11 }}
                    />
                    <Bar dataKey="avg" radius={[0, 3, 3, 0]}>
                      {data.csat.by_agent.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={entry.avg >= 4 ? '#22C55E' : entry.avg >= 3 ? '#F59E0B' : '#E63946'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </div>
      </Section>

    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function MetricKpiCard({ label, value, alert, accent }: { label: string; value: string; alert?: boolean; accent?: 'green' | 'blue' }) {
  const valueColor = alert
    ? 'text-brand'
    : accent === 'green' ? 'text-accent-green'
    : accent === 'blue'  ? 'text-accent-blue'
    : 'text-text-primary';

  return (
    <div className={`bg-surface-2 ring-1 ring-surface-5 rounded-lg px-4 py-3.5 ${alert ? 'ring-brand/30' : ''}`}>
      <div className={`text-lg font-bold font-inter-nums tabular-nums ${valueColor}`}>{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function HeroMetric({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      <span className="text-3xl font-bold font-inter-nums tabular-nums" style={{ color }}>{value}</span>
      <span className="text-xs text-text-muted">{label}</span>
    </div>
  );
}

function Section({ title, children, color }: { title: string; children: React.ReactNode; color?: string }) {
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-5">
        {color && <div className="w-1 h-4 rounded-full shrink-0" style={{ background: color }} />}
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-3 ring-1 ring-surface-5 rounded-lg p-3">
      <p className="text-[10px] text-text-muted uppercase tracking-wide mb-3">{title}</p>
      {children}
    </div>
  );
}

function NoData() {
  return (
    <div className="h-32 flex items-center justify-center rounded-lg border border-dashed border-surface-5 text-xs text-text-muted">
      No data available
    </div>
  );
}
