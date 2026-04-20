/**
 * Insights Dashboard
 * Unified view of all analytics + metrics data.
 * Tabs: Overview · Volume · Response Times · Resolution · Bot Performance · CSAT · Agent Breakdown · Intent
 * Agent Breakdown tab is only rendered for users with section.metrics permission.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '../api';
import { Tabs, type TabItem } from './ui/Tabs';
import { KpiCard } from './ui/KpiCard';
import { ChartBarSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';
import { usePerm } from '../PermissionContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface InsightsData {
  summary: {
    total_tickets: number;
    resolved: number;
    escalated: number;
    sla_breached: number;
    resolution_rate: number;
    avg_frt_s: number | null;
    avg_aht_s: number | null;
    csat_avg: number | null;
    bot_resolution_rate: number;
  };
  volume: {
    total: number;
    by_day: { date: string; count: number }[];
    by_channel: { channel: string; count: number }[];
    by_category: { category: string; count: number }[];
  };
  response_time: {
    avg_s: number | null;
    median_s: number | null;
    p90_s: number | null;
    over_time: { date: string; avg_s: number }[];
  };
  resolution: {
    avg_s: number | null;
    by_channel: { channel: string; avg_s: number }[];
    over_time: { date: string; avg_s: number }[];
  };
  bot: {
    resolution_rate: number;
    handoff_rate: number;
    bot_total: number;
    human_total: number;
    by_day: { date: string; bot: number; human: number }[];
    by_bot: {
      bot_name: string;
      total: number;
      resolved: number;
      escalated: number;
      resolution_rate: number;
      escalation_rate: number;
      csat_avg: number | null;
    }[];
  };
  csat: {
    avg: number | null;
    count: number;
    distribution: { score: number; count: number }[];
    by_channel: { channel: string; avg: number }[];
  };
  intent: {
    top: { category: string; count: number; pct: number }[];
  };
  agent_leaderboard: {
    agent_id: string;
    name: string;
    total: number;
    resolved: number;
    fcr: number;
    sla_breaches: number;
    sla_breach_rate: number;
    avg_frt_s: number | null;
    avg_aht_s: number | null;
    csat_avg: number | null;
    csat_count: number;
  }[] | null;
  sla_breakdown: {
    by_agent:    { name: string; breaches: number; total: number; breach_rate: number }[];
    by_category: { category: string; breaches: number; total: number; breach_rate: number }[];
  } | null;
  queue_health: {
    open_total: number;
    age_lt_1h: number;
    age_1h_4h: number;
    age_4h_24h: number;
    age_gt_24h: number;
    unassigned: number;
    pending_customer: number;
    reopened_30d: number;
    closed_30d: number;
  } | null;
  peak_hours: { dow: number; hour: number; count: number }[] | null;
  low_csat: {
    id: string;
    csat_score: number;
    channel: string;
    category: string | null;
    created_at: string;
    updated_at: string;
    agent_name: string | null;
    customer_name: string | null;
  }[] | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RANGES = [
  { id: 'today', label: 'Today' },
  { id: '7d',   label: '7 days' },
  { id: '30d',  label: '30 days' },
] as const;

const CHANNELS = ['web', 'line', 'facebook', 'email'] as const;

const CATEGORIES = [
  'kyc_verification', 'account_restriction', 'password_2fa_reset',
  'fraud_security', 'withdrawal_issue',
] as const;

const CHANNEL_COLORS: Record<string, string> = {
  web: '#3B82F6', line: '#22C55E', facebook: '#8B5CF6', email: '#F59E0B',
};

const CHART_COLORS = ['#E63946','#3B82F6','#22C55E','#F59E0B','#8B5CF6','#EC4899','#14B8A6','#F97316'];
const CSAT_COLORS  = ['#E63946','#F59E0B','#8B92A5','#22C55E','#3B82F6'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSeconds(s: number | null | undefined): string {
  const n = Number(s);
  if (!n || isNaN(n)) return '—';
  if (n < 60)   return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${Math.floor(n % 60)}s`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '—';
  return `${Math.round(Number(n) * 100)}%`;
}

function fmtCsat(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function labelCategory(cat: string): string {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Custom chart tooltip ──────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string }[];
  label?: string;
  formatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-3 ring-1 ring-surface-5 rounded-lg px-3 py-2 shadow-panel text-xs">
      {label && <p className="text-text-muted mb-1">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-text-secondary">{p.name}:</span>
          <span className="font-semibold text-text-primary">
            {formatter ? formatter(p.value) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
      {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ data }: { data: InsightsData }) {
  const s = data.summary;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Total Tickets"    value={String(s.total_tickets)}    accent="blue" />
        <KpiCard label="Resolved"         value={String(s.resolved)}         accent="green" />
        <KpiCard label="Escalated"        value={String(s.escalated)}        accent="brand" />
        <KpiCard label="SLA Breached"     value={String(s.sla_breached)}     accent="amber" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard label="Resolution Rate"  value={fmtPct(s.resolution_rate)}  accent="green" />
        <KpiCard label="Avg FRT"          value={fmtSeconds(s.avg_frt_s)}    accent="blue" />
        <KpiCard label="Avg AHT"          value={fmtSeconds(s.avg_aht_s)}    accent="blue" />
        <KpiCard label="CSAT Score"       value={fmtCsat(s.csat_avg)}        accent="amber" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Bot Resolution Rate</p>
          <p className="text-2xl font-bold text-text-primary">{fmtPct(s.bot_resolution_rate)}</p>
          <div className="mt-3 h-2 rounded-full bg-surface-4 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-blue transition-all"
              style={{ width: `${Math.min((s.bot_resolution_rate ?? 0) * 100, 100)}%` }}
            />
          </div>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Escalation Rate</p>
          <p className="text-2xl font-bold text-text-primary">{fmtPct(data.bot.handoff_rate)}</p>
          <div className="mt-3 h-2 rounded-full bg-surface-4 overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${Math.min((data.bot.handoff_rate ?? 0) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Volume tab ────────────────────────────────────────────────────────────────

function VolumeTab({ data }: { data: InsightsData }) {
  const { by_day, by_channel, by_category } = data.volume;
  return (
    <div className="space-y-8">
      <div>
        <SectionHeader title="Tickets Over Time" />
        {by_day?.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={by_day}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="count" name="Tickets" stroke="#3B82F6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <ChartBarSkeleton />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <SectionHeader title="By Channel" />
          {by_channel?.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={by_channel} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <YAxis dataKey="channel" type="category" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={64} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Tickets" radius={[0,3,3,0]}>
                  {by_channel.map((entry) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] ?? CHART_COLORS[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No channel data" />}
        </div>

        <div>
          <SectionHeader title="By Category (Top 9)" />
          {by_category?.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={by_category} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <YAxis dataKey="category" type="category" tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} width={120}
                  tickFormatter={labelCategory} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="Tickets" fill="#E63946" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No category data" />}
        </div>
      </div>
    </div>
  );
}

// ── Response Times tab ────────────────────────────────────────────────────────

function ResponseTimesTab({ data }: { data: InsightsData }) {
  const rt = data.response_time;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5 text-center">
          <p className="text-xs text-text-muted mb-1">Avg FRT</p>
          <p className="text-2xl font-bold text-accent-blue">{fmtSeconds(rt.avg_s)}</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5 text-center">
          <p className="text-xs text-text-muted mb-1">Median FRT</p>
          <p className="text-2xl font-bold text-accent-green">{fmtSeconds(rt.median_s)}</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5 text-center">
          <p className="text-xs text-text-muted mb-1">P90 FRT</p>
          <p className="text-2xl font-bold text-text-primary">{fmtSeconds(rt.p90_s)}</p>
        </div>
      </div>

      <div>
        <SectionHeader title="FRT Over Time" subtitle="Average first reply time per day" />
        {rt.over_time?.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rt.over_time}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
              <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
              <Line type="monotone" dataKey="avg_s" name="Avg FRT" stroke="#3B82F6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <EmptyState title="No FRT trend data for this period" />}
      </div>
    </div>
  );
}

// ── Resolution tab ────────────────────────────────────────────────────────────

function ResolutionTab({ data }: { data: InsightsData }) {
  const res = data.resolution;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Avg Handle Time (AHT)</p>
          <p className="text-2xl font-bold text-accent-green">{fmtSeconds(res.avg_s)}</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Resolution Rate</p>
          <p className="text-2xl font-bold text-text-primary">{fmtPct(data.summary.resolution_rate)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <SectionHeader title="AHT by Channel" />
          {res.by_channel?.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={res.by_channel} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
                <YAxis dataKey="channel" type="category" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={64} />
                <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                <Bar dataKey="avg_s" name="Avg AHT" radius={[0,3,3,0]}>
                  {res.by_channel.map((entry) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] ?? '#3B82F6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No channel breakdown data" />}
        </div>

        <div>
          <SectionHeader title="AHT Over Time" />
          {res.over_time?.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={res.over_time}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
                <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                <Line type="monotone" dataKey="avg_s" name="Avg AHT" stroke="#22C55E" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No AHT trend data for this period" />}
        </div>
      </div>
    </div>
  );
}

// ── Bot Performance tab ───────────────────────────────────────────────────────

function BotPerformanceTab({ data }: { data: InsightsData }) {
  const bot = data.bot;
  return (
    <div className="space-y-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Bot Tickets</p>
          <p className="text-2xl font-bold text-text-primary">{bot.bot_total ?? 0}</p>
          <p className="text-xs text-text-muted mt-1">Unclassified or bot-handled</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Human Tickets</p>
          <p className="text-2xl font-bold text-text-primary">{bot.human_total ?? 0}</p>
          <p className="text-xs text-text-muted mt-1">Non-web channels</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Bot Resolution Rate</p>
          <p className="text-2xl font-bold text-accent-blue">{fmtPct(bot.resolution_rate)}</p>
          <p className="text-xs text-text-muted mt-1">Web tickets closed without escalation</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Escalation Rate</p>
          <p className="text-2xl font-bold text-brand">{fmtPct(bot.handoff_rate)}</p>
          <p className="text-xs text-text-muted mt-1">All tickets handed off to human agents</p>
        </div>
      </div>

      {/* Bot vs Human volume chart */}
      <div>
        <SectionHeader title="Bot vs Human Volume" subtitle="Daily ticket count by handler type" />
        {bot.by_day?.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bot.by_day}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="bot"   name="Bot"   stackId="a" fill="#3B82F6" />
              <Bar dataKey="human" name="Human" stackId="a" fill="#E63946" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState title="No bot performance data for this period" />}
      </div>

      {/* Per-bot breakdown table */}
      <div>
        <SectionHeader title="Performance by Bot" subtitle="Tickets, resolution rate, escalation rate and CSAT per bot" />
        {bot.by_bot?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-5 text-text-muted text-xs">
                  <th className="text-left py-2 pr-4 font-medium">Bot</th>
                  <th className="text-right py-2 px-3 font-medium">Tickets</th>
                  <th className="text-right py-2 px-3 font-medium">Resolved</th>
                  <th className="text-right py-2 px-3 font-medium">Escalated</th>
                  <th className="text-right py-2 px-3 font-medium">Res. Rate</th>
                  <th className="text-right py-2 px-3 font-medium">Esc. Rate</th>
                  <th className="text-right py-2 pl-3 font-medium">CSAT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-5">
                {bot.by_bot.map((row) => (
                  <tr key={row.bot_name} className="hover:bg-surface-3 transition-colors">
                    <td className="py-2.5 pr-4 font-medium text-text-primary">{row.bot_name}</td>
                    <td className="text-right py-2.5 px-3 text-text-secondary">{row.total}</td>
                    <td className="text-right py-2.5 px-3 text-accent-green">{row.resolved}</td>
                    <td className="text-right py-2.5 px-3 text-brand">{row.escalated}</td>
                    <td className="text-right py-2.5 px-3 text-accent-blue font-medium">{fmtPct(row.resolution_rate)}</td>
                    <td className="text-right py-2.5 px-3 text-brand font-medium">{fmtPct(row.escalation_rate)}</td>
                    <td className="text-right py-2.5 pl-3 text-accent-yellow font-medium">{fmtCsat(row.csat_avg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No bot data for this period" />}
      </div>

      {/* Resolution & escalation rate charts per bot */}
      {bot.by_bot?.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <SectionHeader title="Resolution Rate by Bot" />
            <ResponsiveContainer width="100%" height={Math.max(180, bot.by_bot.length * 36)}>
              <BarChart data={bot.by_bot} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <YAxis type="category" dataKey="bot_name" width={120} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <Tooltip formatter={(v: number) => [`${(v * 100).toFixed(1)}%`]} />
                <Bar dataKey="resolution_rate" name="Resolution Rate" fill="#3B82F6" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <SectionHeader title="Escalation Rate by Bot" />
            <ResponsiveContainer width="100%" height={Math.max(180, bot.by_bot.length * 36)}>
              <BarChart data={bot.by_bot} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <YAxis type="category" dataKey="bot_name" width={120} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <Tooltip formatter={(v: number) => [`${(v * 100).toFixed(1)}%`]} />
                <Bar dataKey="escalation_rate" name="Escalation Rate" fill="#E63946" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CSAT tab ──────────────────────────────────────────────────────────────────

function CSATTab({ data }: { data: InsightsData }) {
  const csat = data.csat;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Avg CSAT Score</p>
          <p className="text-3xl font-bold text-accent-yellow">{fmtCsat(csat.avg)}</p>
          <p className="text-xs text-text-muted mt-1">out of 5</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Responses Collected</p>
          <p className="text-3xl font-bold text-text-primary">{csat.count}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <SectionHeader title="Score Distribution" subtitle="1★ to 5★" />
          {csat.distribution?.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={csat.distribution}
                  dataKey="count"
                  nameKey="score"
                  cx="50%" cy="50%"
                  outerRadius={80}
                  label={(props) => `${(props as unknown as Record<string, unknown>).score}★ ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {csat.distribution.map((_entry, i) => (
                    <Cell key={i} fill={CSAT_COLORS[i] ?? CHART_COLORS[i]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${v} responses`]} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No CSAT data for this period" />}
        </div>

        <div>
          <SectionHeader title="Avg CSAT by Channel" />
          {csat.by_channel?.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={csat.by_channel} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" domain={[0,5]} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <YAxis dataKey="channel" type="category" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={64} />
                <Tooltip content={<ChartTooltip formatter={v => `${Number(v).toFixed(2)} / 5`} />} />
                <Bar dataKey="avg" name="Avg CSAT" radius={[0,3,3,0]}>
                  {csat.by_channel.map((entry) => (
                    <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] ?? CHART_COLORS[0]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No channel CSAT data" />}
        </div>
      </div>
    </div>
  );
}

// ── Intent tab ────────────────────────────────────────────────────────────────

function IntentTab({ data }: { data: InsightsData }) {
  const top = data.intent?.top ?? [];
  return (
    <div className="space-y-6">
      <SectionHeader title="Top Intent Categories" subtitle="Tickets by category — top 9" />
      {top.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Chart */}
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={top} margin={{ top: 4, right: 8, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" />
              <XAxis
                dataKey="category"
                tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                tickFormatter={labelCategory}
                angle={-35}
                textAnchor="end"
                interval={0}
              />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="count" name="Tickets" radius={[3,3,0,0]}>
                {top.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Legend / breakdown list */}
          <div className="space-y-3">
            {top.map((entry, i) => (
              <div key={entry.category} className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="text-xs text-text-secondary w-40 shrink-0">{labelCategory(entry.category)}</span>
                <div className="flex-1 h-1.5 rounded-full bg-surface-4 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.round(entry.pct * 100)}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                </div>
                <span className="text-xs font-semibold text-text-primary w-8 text-right shrink-0">{entry.count}</span>
                <span className="text-xs text-text-muted w-8 text-right shrink-0">{Math.round(entry.pct * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : <EmptyState title="No category data for this period" />}
    </div>
  );
}

// ── Agent Leaderboard tab ─────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function AgentLeaderboardTab({ data }: { data: InsightsData }) {
  const rows = data.agent_leaderboard;
  if (!rows) return <EmptyState title="You need the Metrics permission to view the agent leaderboard." />;

  const [sortKey, setSortKey] = useState<string>('total');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = [...rows].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey] as number ?? 0;
    const bv = (b as Record<string, unknown>)[sortKey] as number ?? 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  function handleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  function Th({ k, label }: { k: string; label: string }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => handleSort(k)}
        className={`text-right py-2 px-3 font-medium cursor-pointer select-none whitespace-nowrap hover:text-text-primary transition-colors ${active ? 'text-text-primary' : ''}`}
      >
        {label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
      </th>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader title="Agent Leaderboard" subtitle="Click any column header to sort — section.metrics required" />
      {sorted.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-5 text-text-muted text-xs">
                <th className="text-left py-2 pr-4 font-medium">Agent</th>
                <Th k="total"          label="Tickets" />
                <Th k="resolved"       label="Resolved" />
                <Th k="fcr"            label="FCR" />
                <Th k="sla_breaches"   label="SLA Breaches" />
                <Th k="sla_breach_rate" label="SLA Breach %" />
                <Th k="avg_frt_s"      label="Avg FRT" />
                <Th k="avg_aht_s"      label="Avg AHT" />
                <Th k="csat_avg"       label="CSAT" />
                <th className="text-right py-2 pl-3 font-medium text-text-muted text-xs">CSAT Responses</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-5">
              {sorted.map((r) => {
                const resRate = r.total > 0 ? r.resolved / r.total : 0;
                const fcrRate = r.resolved > 0 ? r.fcr / r.resolved : 0;
                return (
                  <tr key={r.agent_id} className="hover:bg-surface-3 transition-colors">
                    <td className="py-2.5 pr-4 font-medium text-text-primary whitespace-nowrap">{r.name}</td>
                    <td className="text-right py-2.5 px-3 text-text-secondary">{r.total}</td>
                    <td className="text-right py-2.5 px-3">
                      <span className="text-accent-green font-medium">{r.resolved}</span>
                      <span className="text-text-muted text-xs ml-1">({fmtPct(resRate)})</span>
                    </td>
                    <td className="text-right py-2.5 px-3">
                      <span className="text-accent-blue font-medium">{r.fcr}</span>
                      <span className="text-text-muted text-xs ml-1">({fmtPct(fcrRate)})</span>
                    </td>
                    <td className="text-right py-2.5 px-3 text-brand font-medium">{r.sla_breaches}</td>
                    <td className="text-right py-2.5 px-3">
                      <span className={`font-medium ${r.sla_breach_rate > 0.2 ? 'text-brand' : 'text-text-secondary'}`}>
                        {fmtPct(r.sla_breach_rate)}
                      </span>
                    </td>
                    <td className="text-right py-2.5 px-3 text-text-secondary">{fmtSeconds(r.avg_frt_s)}</td>
                    <td className="text-right py-2.5 px-3 text-text-secondary">{fmtSeconds(r.avg_aht_s)}</td>
                    <td className="text-right py-2.5 px-3">
                      <span className={`font-medium ${r.csat_avg == null ? 'text-text-muted' : r.csat_avg >= 4 ? 'text-accent-green' : r.csat_avg >= 3 ? 'text-accent-yellow' : 'text-brand'}`}>
                        {fmtCsat(r.csat_avg)}
                      </span>
                    </td>
                    <td className="text-right py-2.5 pl-3 text-text-muted text-xs">{r.csat_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="No agent data for this period" />}
    </div>
  );
}

// ── Queue Health tab ──────────────────────────────────────────────────────────

function QueueHealthTab({ data }: { data: InsightsData }) {
  const qh = data.queue_health;
  const ph = data.peak_hours;

  if (!qh) return <EmptyState title="You need the Metrics permission to view queue health." />;

  const ageBuckets = [
    { label: '< 1h',    value: qh.age_lt_1h,   color: '#22C55E' },
    { label: '1–4h',    value: qh.age_1h_4h,   color: '#F59E0B' },
    { label: '4–24h',   value: qh.age_4h_24h,  color: '#F97316' },
    { label: '> 24h',   value: qh.age_gt_24h,  color: '#E63946' },
  ];

  const reopenRate = qh.closed_30d > 0 ? qh.reopened_30d / qh.closed_30d : 0;

  // Build heatmap matrix: 7 rows (dow) × 24 cols (hour)
  const heatMax = ph ? Math.max(...ph.map(r => r.count), 1) : 1;
  const heatMap: Record<string, number> = {};
  if (ph) ph.forEach(r => { heatMap[`${r.dow}-${r.hour}`] = r.count; });

  function heatColor(count: number): string {
    if (!count) return 'var(--color-surface-3)';
    const intensity = count / heatMax;
    if (intensity < 0.25) return '#1e3a5f';
    if (intensity < 0.5)  return '#1d4ed8';
    if (intensity < 0.75) return '#3B82F6';
    return '#93c5fd';
  }

  return (
    <div className="space-y-6">

      {/* Backlog KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Open Tickets</p>
          <p className="text-2xl font-bold text-text-primary">{qh.open_total}</p>
          <p className="text-xs text-text-muted mt-1">In current backlog</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Unassigned</p>
          <p className={`text-2xl font-bold ${qh.unassigned > 0 ? 'text-brand' : 'text-accent-green'}`}>{qh.unassigned}</p>
          <p className="text-xs text-text-muted mt-1">No agent or bot assigned</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Pending Customer</p>
          <p className="text-2xl font-bold text-accent-yellow">{qh.pending_customer}</p>
          <p className="text-xs text-text-muted mt-1">Waiting on customer reply</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Reopen Rate (30d)</p>
          <p className={`text-2xl font-bold ${reopenRate > 0.05 ? 'text-brand' : 'text-text-primary'}`}>{fmtPct(reopenRate)}</p>
          <p className="text-xs text-text-muted mt-1">{qh.reopened_30d} reopened / {qh.closed_30d} closed</p>
        </div>
      </div>

      {/* Backlog age distribution */}
      <div>
        <SectionHeader title="Backlog Age Distribution" subtitle="Open tickets grouped by time since creation" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {ageBuckets.map(b => (
            <div key={b.label} className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
                <p className="text-xs text-text-muted">{b.label}</p>
              </div>
              <p className="text-xl font-bold text-text-primary">{b.value}</p>
              <p className="text-xs text-text-muted mt-0.5">
                {qh.open_total > 0 ? fmtPct(b.value / qh.open_total) : '—'} of backlog
              </p>
            </div>
          ))}
        </div>
        {qh.open_total > 0 && (
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={ageBuckets}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="value" name="Tickets" radius={[3, 3, 0, 0]}>
                {ageBuckets.map((b, i) => <Cell key={i} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Peak hours heatmap */}
      {ph && ph.length > 0 && (
        <div>
          <SectionHeader title="Peak Hours Heatmap" subtitle="Ticket volume by hour of day × day of week" />
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="w-8 pr-2 text-right text-text-muted font-normal" />
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} className="w-7 text-center text-text-muted font-normal pb-1">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DOW_LABELS.map((day, dow) => (
                  <tr key={dow}>
                    <td className="pr-2 text-right text-text-muted font-medium whitespace-nowrap py-0.5">{day}</td>
                    {Array.from({ length: 24 }, (_, hour) => {
                      const cnt = heatMap[`${dow}-${hour}`] ?? 0;
                      return (
                        <td key={hour} className="p-px">
                          <div
                            title={`${day} ${hour}:00 — ${cnt} tickets`}
                            className="w-6 h-6 rounded-sm cursor-default transition-opacity hover:opacity-80"
                            style={{ backgroundColor: heatColor(cnt) }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-text-muted">Low</span>
              {['#1e3a5f','#1d4ed8','#3B82F6','#93c5fd'].map(c => (
                <span key={c} className="w-5 h-3 rounded-sm inline-block" style={{ backgroundColor: c }} />
              ))}
              <span className="text-xs text-text-muted">High</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SLA & Quality tab ─────────────────────────────────────────────────────────

function SlaQualityTab({ data }: { data: InsightsData }) {
  const sla  = data.sla_breakdown;
  const lc   = data.low_csat;

  if (!sla || !lc) return <EmptyState title="You need the Metrics permission to view SLA & Quality." />;

  return (
    <div className="space-y-8">

      {/* SLA by agent + by category */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <SectionHeader title="SLA Breaches by Agent" subtitle="Agents with most breaches in period" />
          {sla.by_agent?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-5 text-text-muted text-xs">
                    <th className="text-left py-2 pr-3 font-medium">Agent</th>
                    <th className="text-right py-2 px-3 font-medium">Breaches</th>
                    <th className="text-right py-2 px-3 font-medium">Total</th>
                    <th className="text-right py-2 pl-3 font-medium">Breach %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-5">
                  {sla.by_agent.map(r => (
                    <tr key={r.name} className="hover:bg-surface-3 transition-colors">
                      <td className="py-2.5 pr-3 text-text-primary font-medium">{r.name}</td>
                      <td className="text-right py-2.5 px-3 text-brand font-semibold">{r.breaches}</td>
                      <td className="text-right py-2.5 px-3 text-text-secondary">{r.total}</td>
                      <td className="text-right py-2.5 pl-3">
                        <span className={`font-medium ${r.breach_rate > 0.2 ? 'text-brand' : 'text-text-secondary'}`}>
                          {fmtPct(r.breach_rate)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No SLA breach data" />}
        </div>

        <div>
          <SectionHeader title="SLA Breaches by Category" subtitle="Categories with highest breach rates" />
          {sla.by_category?.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={sla.by_category} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" domain={[0, 1]} tickFormatter={v => `${Math.round(v * 100)}%`} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <YAxis type="category" dataKey="category" width={140} tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }} />
                <Tooltip formatter={(v: unknown) => [`${(Number(v) * 100).toFixed(1)}%`]} />
                <Bar dataKey="breach_rate" name="Breach Rate" fill="#E63946" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No SLA category data" />}
        </div>
      </div>

      {/* Low CSAT drill-down */}
      <div>
        <SectionHeader
          title="Low CSAT Tickets (1–2 ★)"
          subtitle={`${lc.length} tickets with poor ratings — review for coaching opportunities`}
        />
        {lc.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-5 text-text-muted text-xs">
                  <th className="text-left py-2 pr-3 font-medium">Score</th>
                  <th className="text-left py-2 px-3 font-medium">Agent</th>
                  <th className="text-left py-2 px-3 font-medium">Channel</th>
                  <th className="text-left py-2 px-3 font-medium">Category</th>
                  <th className="text-left py-2 px-3 font-medium">Customer</th>
                  <th className="text-right py-2 pl-3 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-5">
                {lc.map(r => (
                  <tr key={r.id} className="hover:bg-surface-3 transition-colors">
                    <td className="py-2.5 pr-3">
                      <span className={`font-bold text-base ${r.csat_score === 1 ? 'text-brand' : 'text-accent-yellow'}`}>
                        {'★'.repeat(r.csat_score)}{'☆'.repeat(5 - r.csat_score)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-text-primary">{r.agent_name ?? <span className="text-text-muted italic">Bot</span>}</td>
                    <td className="py-2.5 px-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-surface-4 text-text-secondary capitalize">{r.channel}</span>
                    </td>
                    <td className="py-2.5 px-3 text-text-secondary text-xs">{r.category ? labelCategory(r.category) : '—'}</td>
                    <td className="py-2.5 px-3 text-text-secondary">{r.customer_name ?? '—'}</td>
                    <td className="py-2.5 pl-3 text-right text-text-muted text-xs whitespace-nowrap">
                      {new Date(r.updated_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No low CSAT tickets for this period" />}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const BASE_TAB_ITEMS: TabItem[] = [
  { id: 'overview',       label: 'Overview' },
  { id: 'volume',         label: 'Volume' },
  { id: 'response_times', label: 'Response Times' },
  { id: 'resolution',     label: 'Resolution' },
  { id: 'bot',            label: 'Bot Performance' },
  { id: 'csat',           label: 'CSAT' },
  { id: 'intent',         label: 'Intent' },
];

const SUPERVISOR_TAB_ITEMS: TabItem[] = [
  { id: 'agent_leaderboard', label: 'Agent Leaderboard' },
  { id: 'queue_health',      label: 'Queue Health' },
  { id: 'sla_quality',       label: 'SLA & Quality' },
];

export default function InsightsDashboard() {
  const canSeeAgentBreakdown = usePerm('section.metrics');
  const tabs = canSeeAgentBreakdown ? [...BASE_TAB_ITEMS, ...SUPERVISOR_TAB_ITEMS] : BASE_TAB_ITEMS;

  const [activeTab, setActiveTab]   = useState<string>('overview');
  const [range, setRange]           = useState<'today' | '7d' | '30d'>('30d');
  const [channel, setChannel]       = useState('');
  const [category, setCategory]     = useState('');
  const [data, setData]             = useState<InsightsData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getInsights({
        range,
        ...(channel  ? { channel }  : {}),
        ...(category ? { category } : {}),
      });
      setData(result as unknown as InsightsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights');
    } finally {
      setLoading(false);
    }
  }, [range, channel, category]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-surface-0">

      {/* Header + filters */}
      <div className="shrink-0 px-6 pt-5 pb-4 border-b border-surface-5 bg-surface-1">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-base font-bold text-text-primary">Insights</h1>
            <p className="text-xs text-text-muted mt-0.5">Unified performance view across all channels and teams</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Date range */}
            <div className="flex rounded-lg ring-1 ring-surface-5 overflow-hidden">
              {RANGES.map(r => (
                <button
                  key={r.id}
                  onClick={() => setRange(r.id)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    range === r.id
                      ? 'bg-brand text-white'
                      : 'bg-surface-3 text-text-secondary hover:bg-surface-4'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Channel filter */}
            <select
              value={channel}
              onChange={e => setChannel(e.target.value)}
              className="text-xs bg-surface-3 ring-1 ring-surface-5 rounded-lg px-2.5 py-1.5 text-text-secondary outline-none hover:bg-surface-4 transition-colors"
            >
              <option value="">All Channels</option>
              {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            {/* Category filter */}
            <select
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="text-xs bg-surface-3 ring-1 ring-surface-5 rounded-lg px-2.5 py-1.5 text-text-secondary outline-none hover:bg-surface-4 transition-colors"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{labelCategory(c)}</option>)}
            </select>

            {/* Refresh */}
            <button
              onClick={load}
              disabled={loading}
              className="p-1.5 rounded-lg ring-1 ring-surface-5 bg-surface-3 hover:bg-surface-4 transition-colors text-text-muted disabled:opacity-40"
              title="Refresh"
            >
              <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab rail */}
        <div className="mt-4">
          <Tabs
            tabs={tabs}
            activeId={activeTab}
            onChange={setActiveTab}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error ? (
          <div className="flex items-center gap-2 text-brand text-sm bg-brand/5 ring-1 ring-brand/20 rounded-lg px-4 py-3">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {error}
          </div>
        ) : loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 bg-surface-2 ring-1 ring-surface-5 rounded-xl animate-pulse" />
              ))}
            </div>
            <ChartBarSkeleton />
          </div>
        ) : data ? (
          <>
            {activeTab === 'overview'           && <OverviewTab          data={data} />}
            {activeTab === 'volume'             && <VolumeTab            data={data} />}
            {activeTab === 'response_times'     && <ResponseTimesTab     data={data} />}
            {activeTab === 'resolution'         && <ResolutionTab        data={data} />}
            {activeTab === 'bot'                && <BotPerformanceTab    data={data} />}
            {activeTab === 'csat'               && <CSATTab              data={data} />}
            {activeTab === 'intent'             && <IntentTab            data={data} />}
            {activeTab === 'agent_leaderboard'  && <AgentLeaderboardTab  data={data} />}
            {activeTab === 'queue_health'       && <QueueHealthTab       data={data} />}
            {activeTab === 'sla_quality'        && <SlaQualityTab        data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
}
