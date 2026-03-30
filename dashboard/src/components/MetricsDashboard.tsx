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

const MONO = ['#000', '#333', '#555', '#777', '#999'];
const API  = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function getToken() {
  try { return (JSON.parse(localStorage.getItem('auth_user') ?? '{}')).token ?? ''; } catch { return ''; }
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

  useEffect(() => { load(); }, [filters.range, filters.agent_id, filters.channel]);

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">

      {/* Header */}
      <div className="flex items-center justify-between mb-4 border-b border-[#EAEAEA] pb-4">
        <h2 className="text-sm font-bold text-[#000] uppercase tracking-wide">Metrics</h2>
        <button onClick={load} className="text-xs text-[#000] hover:underline">↻ Refresh</button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5 border border-[#EAEAEA] px-4 py-3">
        {/* Range */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#999]">Period</span>
          <div className="flex border border-[#CCC] overflow-hidden">
            {(['7d', '30d', 'custom'] as const).map(r => (
              <button
                key={r}
                onClick={() => setFilters(f => ({ ...f, range: r }))}
                className={`text-[11px] px-3 py-1 border-r border-[#CCC] last:border-0 transition-colors ${
                  filters.range === r ? 'bg-[#000] text-white' : 'text-[#333] hover:bg-[#f5f5f5]'
                }`}
              >
                {r === '7d' ? '7 days' : r === '30d' ? '30 days' : 'Custom'}
              </button>
            ))}
          </div>
        </div>

        {filters.range === 'custom' && (
          <>
            <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
              className="text-[11px] border border-[#CCC] px-2 py-1 outline-none focus:border-[#000]" />
            <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
              className="text-[11px] border border-[#CCC] px-2 py-1 outline-none focus:border-[#000]" />
            <button onClick={load} className="text-[11px] border border-[#000] px-3 py-1 hover:bg-[#000] hover:text-white transition-colors">Apply</button>
          </>
        )}

        {/* Channel */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#999]">Channel</span>
          <select value={filters.channel} onChange={e => setFilters(f => ({ ...f, channel: e.target.value }))}
            className="text-[11px] border border-[#CCC] px-2 py-1 outline-none focus:border-[#000]">
            <option value="">All</option>
            {['web', 'line', 'facebook', 'email'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>
      )}

      {loading
        ? <div className="flex items-center justify-center h-48 text-[#999] text-sm">Loading…</div>
        : data
          ? <MetricsContent data={data} />
          : <div className="flex items-center justify-center h-48 border border-dashed border-[#EAEAEA] text-xs text-[#999]">No data — backend may be offline</div>
      }
    </div>
  );
}

// ── Content ───────────────────────────────────────────────────────────────────

function MetricsContent({ data }: { data: MetricsData }) {
  return (
    <div className="space-y-6">

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total Tickets"    value={String(data.summary.total_tickets ?? '—')} />
        <KpiCard label="Resolved"         value={String(data.summary.resolved ?? '—')} />
        <KpiCard label="Resolution Rate"  value={data.summary.resolution_rate != null ? `${Math.round(Number(data.summary.resolution_rate) * 100)}%` : '—'} />
        <KpiCard label="Escalated"        value={String(data.summary.escalated ?? '—')} alert={Number(data.summary.escalated) > 0} />
        <KpiCard label="SLA Breached"     value={String(data.summary.sla_breached ?? '—')} alert={Number(data.summary.sla_breached) > 0} />
      </div>

      {/* FRT section */}
      <Section title="First Reply Time (FRT)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="mb-3">
              <span className="text-2xl font-bold text-[#000]">{fmtSeconds(data.frt.avg_s)}</span>
              <span className="text-xs text-[#999] ml-2">average</span>
            </div>
            <ChartBox title="FRT over time">
              {data.frt.over_time?.length
                ? <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={data.frt.over_time}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtSeconds(v)} />
                      <Tooltip formatter={(v: unknown) => [fmtSeconds(v as number), 'Avg FRT']} />
                      <Line type="monotone" dataKey="avg_s" stroke="#000" strokeWidth={1.5} dot={false} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => fmtSeconds(v)} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} width={80} />
                    <Tooltip formatter={(v: unknown) => [fmtSeconds(v as number), 'Avg FRT']} />
                    <Bar dataKey="avg_s" fill="#000" />
                  </BarChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </div>
      </Section>

      {/* AHT section */}
      <Section title="Average Handle Time (AHT)">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="mb-3">
              <span className="text-2xl font-bold text-[#000]">{fmtSeconds(data.aht.avg_s)}</span>
              <span className="text-xs text-[#999] ml-2">average</span>
            </div>
            <ChartBox title="AHT over time">
              {data.aht.over_time?.length
                ? <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={data.aht.over_time}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtSeconds(v)} />
                      <Tooltip formatter={(v: unknown) => [fmtSeconds(v as number), 'Avg AHT']} />
                      <Line type="monotone" dataKey="avg_s" stroke="#333" strokeWidth={1.5} dot={false} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="channel" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={v => fmtSeconds(v)} />
                    <Tooltip formatter={(v: unknown) => [fmtSeconds(v as number), 'Avg AHT']} />
                    <Bar dataKey="avg_s" fill="#333" />
                  </BarChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>
        </div>
      </Section>

      {/* CSAT section */}
      <Section title="Customer Satisfaction (CSAT)">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col justify-center items-center border border-[#EAEAEA] p-4">
            <span className="text-4xl font-bold text-[#000]">
              {data.csat.avg != null ? Number(data.csat.avg).toFixed(2) : '—'}
            </span>
            <span className="text-xs text-[#999] mt-1">avg score (1–5)</span>
            <span className="text-xs text-[#CCC] mt-0.5">{data.csat.count} responses</span>
          </div>

          <ChartBox title="Score distribution">
            {data.csat.distribution?.length
              ? <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={data.csat.distribution} dataKey="count" nameKey="score"
                      cx="50%" cy="50%" outerRadius={70}
                      label={({ payload }: PieLabelRenderProps & { payload?: { score?: number } }) => payload?.score ? `${payload.score}★` : ''}>
                      {data.csat.distribution.map((_, i) => (
                        <Cell key={i} fill={MONO[i % MONO.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: unknown, _: unknown, p: unknown) => [`${v} responses`, `${(p as { payload: { score: number } }).payload.score}★`]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} formatter={v => `${v}★`} />
                  </PieChart>
                </ResponsiveContainer>
              : <NoData />
            }
          </ChartBox>

          <ChartBox title="CSAT by agent">
            {data.csat.by_agent?.length
              ? <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={data.csat.by_agent} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis type="number" domain={[0, 5]} tick={{ fontSize: 9 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 9 }} width={70} />
                    <Tooltip formatter={(v: unknown) => [(v as number).toFixed(2), 'Avg CSAT']} />
                    <Bar dataKey="avg" fill="#000" />
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

function KpiCard({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="border border-[#EAEAEA] px-3 py-3">
      <div className={`text-lg font-bold ${alert ? 'text-[#D32F2F]' : 'text-[#000]'}`}>{value}</div>
      <div className="text-[10px] text-[#999] mt-0.5 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-[#999] uppercase tracking-wide mb-3 border-b border-[#EAEAEA] pb-2">{title}</h3>
      {children}
    </div>
  );
}

function ChartBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-[#EAEAEA] p-3">
      <p className="text-[10px] text-[#999] uppercase tracking-wide mb-2">{title}</p>
      {children}
    </div>
  );
}

function NoData() {
  return (
    <div className="h-32 flex items-center justify-center border border-dashed border-[#EAEAEA] text-[10px] text-[#999]">
      No data
    </div>
  );
}
