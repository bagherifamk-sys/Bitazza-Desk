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
    by_day: { date: string; bot: number; human: number }[];
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
  agent_breakdown: {
    frt_by_agent: { name: string; avg_s: number }[];
    aht_by_channel: { channel: string; avg_s: number }[];
    csat_by_agent: { name: string; avg: number; count: number }[];
  } | null;
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
  'fraud_security', 'withdrawal_issue', 'ai_handling',
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
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Bot Resolution Rate</p>
          <p className="text-2xl font-bold text-accent-blue">{fmtPct(bot.resolution_rate)}</p>
          <p className="text-xs text-text-muted mt-1">Web channel tickets resolved without escalation</p>
        </div>
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl p-5">
          <p className="text-xs text-text-muted mb-1">Escalation Rate</p>
          <p className="text-2xl font-bold text-brand">{fmtPct(bot.handoff_rate)}</p>
          <p className="text-xs text-text-muted mt-1">All tickets handed off to human agents</p>
        </div>
      </div>

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
                  label={({ score, percent }) => `${score}★ ${((percent ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {csat.distribution.map((entry, i) => (
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

// ── Agent Breakdown tab ───────────────────────────────────────────────────────

function AgentBreakdownTab({ data }: { data: InsightsData }) {
  const ab = data.agent_breakdown;
  if (!ab) {
    return (
      <EmptyState title="You need the Metrics permission to view agent-level breakdowns." />
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <SectionHeader title="FRT by Agent" subtitle="Fastest first reply times" />
          {ab.frt_by_agent?.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ab.frt_by_agent} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={100} />
                <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
                <Bar dataKey="avg_s" name="Avg FRT" fill="#3B82F6" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No agent FRT data" />}
        </div>

        <div>
          <SectionHeader title="CSAT by Agent" subtitle="Top 10 by rating" />
          {ab.csat_by_agent?.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={ab.csat_by_agent} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" horizontal={false} />
                <XAxis type="number" domain={[0,5]} tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} width={100} />
                <Tooltip content={<ChartTooltip formatter={v => `${Number(v).toFixed(2)} / 5`} />} />
                <Bar dataKey="avg" name="Avg CSAT" fill="#F59E0B" radius={[0,3,3,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyState title="No agent CSAT data" />}
        </div>
      </div>

      <div>
        <SectionHeader title="AHT by Channel" subtitle="Average handle time per channel" />
        {ab.aht_by_channel?.length ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={ab.aht_by_channel}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-5)" />
              <XAxis dataKey="channel" tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }} tickFormatter={v => fmtSeconds(v)} />
              <Tooltip content={<ChartTooltip formatter={fmtSeconds} />} />
              <Bar dataKey="avg_s" name="Avg AHT" radius={[3,3,0,0]}>
                {ab.aht_by_channel.map((entry) => (
                  <Cell key={entry.channel} fill={CHANNEL_COLORS[entry.channel] ?? '#22C55E'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : <EmptyState title="No AHT by channel data" />}
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

// ── Main component ────────────────────────────────────────────────────────────

const AGENT_TAB_ID = 'agent_breakdown';

const BASE_TAB_ITEMS: TabItem[] = [
  { id: 'overview',       label: 'Overview' },
  { id: 'volume',         label: 'Volume' },
  { id: 'response_times', label: 'Response Times' },
  { id: 'resolution',     label: 'Resolution' },
  { id: 'bot',            label: 'Bot Performance' },
  { id: 'csat',           label: 'CSAT' },
  { id: 'intent',         label: 'Intent' },
];

const AGENT_TAB_ITEM: TabItem = { id: AGENT_TAB_ID, label: 'Agent Breakdown' };

export default function InsightsDashboard() {
  const canSeeAgentBreakdown = usePerm('section.metrics');
  const tabs = canSeeAgentBreakdown ? [...BASE_TAB_ITEMS, AGENT_TAB_ITEM] : BASE_TAB_ITEMS;

  const [activeTab, setActiveTab]   = useState<string>('overview');
  const [range, setRange]           = useState<'today' | '7d' | '30d'>('7d');
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
            {activeTab === 'overview'        && <OverviewTab       data={data} />}
            {activeTab === 'volume'          && <VolumeTab         data={data} />}
            {activeTab === 'response_times'  && <ResponseTimesTab  data={data} />}
            {activeTab === 'resolution'      && <ResolutionTab     data={data} />}
            {activeTab === 'bot'             && <BotPerformanceTab data={data} />}
            {activeTab === 'csat'            && <CSATTab           data={data} />}
            {activeTab === 'agent_breakdown' && <AgentBreakdownTab data={data} />}
            {activeTab === 'intent'          && <IntentTab         data={data} />}
          </>
        ) : null}
      </div>
    </div>
  );
}
