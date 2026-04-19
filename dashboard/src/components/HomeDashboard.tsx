import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { Ticket, Priority, Agent, InboxView, StatusFilter } from '../types';
import { api } from '../api';
import { KpiCard } from './ui/KpiCard';
import { Avatar } from './ui/Avatar';
import { StatusBadge, ChannelBadge, PriorityBadge } from './ui/Badge';
import { KpiCardSkeleton, TableRowSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ts: string | number | null | undefined): string {
  if (!ts) return '—';
  const asNum = typeof ts === 'number' ? ts : /^\d+$/.test(String(ts)) ? Number(ts) : NaN;
  const d = isNaN(asNum) ? new Date(ts as string) : new Date(asNum * 1000);
  if (isNaN(d.getTime())) return '—';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function getUrgencyLevel(ticket: Ticket): 'normal' | 'warning' | 'critical' {
  if (ticket.sla_breached) return 'critical';
  const ts = ticket.sla_deadline ?? ticket.sla_breach_at;
  if (ts) {
    const deadline = new Date(ts).getTime();
    const minsLeft = (deadline - Date.now()) / 60000;
    if (minsLeft < 0) return 'critical';
    if (minsLeft < 60) return 'warning';
    return 'normal';
  }
  const created = ticket.created_at;
  if (!created) return 'normal';
  const epochMs = typeof created === 'number' ? created * 1000
    : /^\d+$/.test(String(created)) ? Number(created) * 1000
    : new Date(created).getTime();
  if (isNaN(epochMs)) return 'normal';
  const ageH = (Date.now() - epochMs) / 3600000;
  if (ageH > 24) return 'critical';
  if (ageH > 4) return 'warning';
  return 'normal';
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const CHANNEL_LABELS: Record<string, string> = {
  web: 'Web', line: 'LINE', facebook: 'Facebook', email: 'Email',
};
const CHANNEL_PIE_COLORS: Record<string, string> = {
  web: '#3b82f6', line: '#22c55e', facebook: '#6366f1', email: '#f59e0b',
};
const CHANNEL_PIE_FALLBACK = '#6b7280';

// ── Ticket Row ────────────────────────────────────────────────────────────────

const URGENCY_ROW: Record<string, string> = {
  critical: 'border-l-2 border-l-red-500',
  warning:  'border-l-2 border-l-amber-400',
  normal:   '',
};
const URGENCY_TIME: Record<string, string> = {
  critical: 'text-red-500 font-semibold',
  warning:  'text-amber-500 font-semibold',
  normal:   'text-text-muted',
};

function TicketRow({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const name = ticket.customer?.name ?? 'Unknown';
  const urgency = getUrgencyLevel(ticket);
  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-3 px-4 py-3 border-b border-surface-5 hover:bg-surface-3 cursor-pointer transition-colors duration-100 ${URGENCY_ROW[urgency]}`}
    >
      <Avatar name={name} size="sm" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold text-text-primary truncate">{name}</div>
        <div className="text-xs text-text-secondary truncate mt-0.5">{ticket.last_message ?? '—'}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ChannelBadge channel={ticket.channel as any} size="xs" />
        {ticket.priority !== 3 && <PriorityBadge priority={ticket.priority as Priority} size="xs" />}
        <StatusBadge status={ticket.status} size="xs" />
        <span className={`text-[10px] w-8 text-right tabular-nums ${URGENCY_TIME[urgency]}`}>
          {relativeTime(ticket.last_message_at ?? ticket.created_at)}
        </span>
      </div>
    </div>
  );
}

// ── Ticket Table ──────────────────────────────────────────────────────────────

function TicketTable({
  title, badge, tickets, loading, onTicketClick,
}: {
  title: string; badge?: React.ReactNode; tickets: Ticket[];
  loading: boolean; onTicketClick: (id: string) => void;
}) {
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-surface-5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{title}</span>
          {badge}
        </div>
        <span className="text-xs text-text-muted">{tickets.length} tickets</span>
      </div>
      <div className="overflow-y-auto flex-1">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} cols={4} />)
          : tickets.length === 0
            ? <EmptyState title="No tickets" className="h-32" />
            : tickets.map(t => <TicketRow key={t.id} ticket={t} onClick={() => onTicketClick(t.id)} />)
        }
      </div>
    </div>
  );
}

// ── Escalated Strip ───────────────────────────────────────────────────────────

function EscalatedStrip({ tickets, onTicketClick }: { tickets: Ticket[]; onTicketClick: (id: string) => void }) {
  if (tickets.length === 0) return null;
  const shown = tickets.slice(0, 3);
  return (
    <div className="rounded-lg bg-red-500/8 border border-red-500/25 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs font-semibold text-red-500 uppercase tracking-wide">
          {tickets.length} ticket{tickets.length !== 1 ? 's' : ''} need immediate attention
        </span>
      </div>
      {shown.map(t => (
        <div key={t.id} onClick={() => onTicketClick(t.id)}
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
          <Avatar name={t.customer?.name ?? 'Unknown'} size="xs" className="shrink-0" />
          <span className="text-xs font-medium text-text-primary truncate flex-1">
            {t.customer?.name ?? 'Unknown'}
          </span>
          <ChannelBadge channel={t.channel as any} size="xs" />
          <span className="text-[10px] text-red-400 tabular-nums w-8 text-right shrink-0">
            {relativeTime(t.last_message_at ?? t.created_at)}
          </span>
        </div>
      ))}
      {tickets.length > 3 && (
        <span className="text-[10px] text-text-muted mt-0.5">+{tickets.length - 3} more — go to Inbox</span>
      )}
    </div>
  );
}

// ── Resolution Card ───────────────────────────────────────────────────────────

function ResolutionCard({ total, resolved }: { total: number; resolved: number }) {
  const rate = total > 0 ? Math.round((resolved / total) * 100) : null;
  const color = rate == null ? 'text-text-muted' : rate >= 70 ? 'text-green-500' : rate >= 40 ? 'text-amber-500' : 'text-red-500';
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Resolution Today</span>
      <div className={`text-3xl font-bold tabular-nums ${color}`}>
        {rate != null ? `${rate}%` : '—'}
      </div>
      <span className="text-xs text-text-secondary">
        {resolved} resolved / {total} opened
      </span>
      {rate != null && (
        <div className="mt-2 h-1.5 rounded-full bg-surface-5 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${rate >= 70 ? 'bg-green-500' : rate >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${rate}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Channel Pie Chart ─────────────────────────────────────────────────────────

function ChannelPie({ data }: { data: { channel: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  const sorted = [...data].sort((a, b) => b.count - a.count);

  if (sorted.length === 0) {
    return (
      <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-4 flex flex-col gap-3">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Channels Today</span>
        <span className="text-xs text-text-muted">No data yet</span>
      </div>
    );
  }

  const pieData = sorted.map(d => ({
    name: CHANNEL_LABELS[d.channel] ?? d.channel,
    value: d.count,
    color: CHANNEL_PIE_COLORS[d.channel] ?? CHANNEL_PIE_FALLBACK,
  }));

  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-4 flex flex-col gap-3">
      <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Channels Today</span>
      <div className="flex items-center gap-4">
        <div className="w-24 h-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" innerRadius="55%" outerRadius="80%" paddingAngle={2} startAngle={90} endAngle={-270} strokeWidth={0}>
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-5)', borderRadius: 6, fontSize: 10 }}
                formatter={(v: number, name: string) => [`${v} (${Math.round(v / total * 100)}%)`, name]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-col gap-1.5 min-w-0 flex-1">
          {pieData.map(d => (
            <div key={d.name} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
              <span className="text-xs text-text-secondary truncate flex-1">{d.name}</span>
              <span className="text-xs tabular-nums text-text-primary font-medium shrink-0">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Today's Summary ───────────────────────────────────────────────────────────

function TodaySummary({ opened, resolved, pending, escalated }: {
  opened: number; resolved: number; pending: number; escalated: number;
}) {
  const rows = [
    { label: 'Opened today',   value: opened,   color: 'text-accent-blue'  },
    { label: 'Resolved today', value: resolved,  color: 'text-green-500'    },
    { label: 'Pending reply',  value: pending,   color: 'text-purple-400'   },
    { label: 'Escalated',      value: escalated, color: 'text-brand'        },
  ];
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-4 flex flex-col gap-3">
      <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Today's Summary</span>
      <div className="flex flex-col gap-2">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">{r.label}</span>
            <span className={`text-sm font-bold tabular-nums ${r.color}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agent Activity ────────────────────────────────────────────────────────────

const AGENT_DOT: Record<string, string> = {
  Available:      'bg-green-500',
  Busy:           'bg-amber-500',
  Break:          'bg-text-muted',
  after_call_work:'bg-text-muted',
  Offline:        'bg-surface-5',
  away:           'bg-surface-5',
};

function AgentActivity({ agents }: { agents: Agent[] }) {
  const active = agents.filter(a => a.active !== false && (a.state ?? a.status) !== 'Offline' && (a.state ?? a.status) !== 'away');
  if (active.length === 0) return null;
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-text-primary">Agent Activity</span>
        <span className="text-[10px] text-text-muted">{active.length} online</span>
      </div>
      <div className="flex gap-2">
        {active.map(a => {
          const state = a.state ?? a.status ?? 'Offline';
          const tickets = Number(a.active_chats ?? a.active_conversation_count ?? 0);
          const max = a.max_chats ?? a.max_capacity ?? 0;
          const dotClass = AGENT_DOT[state] ?? 'bg-surface-5';
          return (
            <div key={a.id} className="flex items-center gap-2 bg-surface-3 rounded-md px-3 py-1.5 flex-1 min-w-0">
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
              <span className="text-xs font-medium text-text-primary truncate flex-1">{a.name}</span>
              <span className="text-[10px] tabular-nums text-text-muted shrink-0">
                {tickets}{max > 0 ? `/${max}` : ''} tickets
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Home Dashboard ────────────────────────────────────────────────────────────

interface HomeDashboardProps {
  onSelectTicket: (id: string) => void;
  onNavigateInbox: (view: InboxView, filter: StatusFilter) => void;
}

export default function HomeDashboard({ onSelectTicket, onNavigateInbox }: HomeDashboardProps) {
  const navigate = useNavigate();
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState({ open: 0, active: 0, escalated: 0, pending: 0, resolved: 0, closed: 0 });
  const [analytics, setAnalytics] = useState<{ volume: { total: number; resolved: number; by_channel: { channel: string; count: number }[] } } | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const loadRef = useRef<() => void>(() => {});

  const authUser = (() => {
    try { return JSON.parse(localStorage.getItem('auth_user') ?? '{}'); } catch { return {}; }
  })();
  const userName: string = authUser.name ?? '';
  const isSupervisorPlus = ['supervisor', 'admin', 'super_admin'].includes(authUser.role);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const calls: Promise<any>[] = [
          api.getTickets('all_open', ''),
          api.getTicketStats(),
          api.getAnalytics({ date_range: 'today' }),
        ];
        if (isSupervisorPlus) calls.push(api.getAgents());

        const [raw, statsData, analyticsData, agentsData] = await Promise.all(calls);
        const data: Ticket[] = Array.isArray(raw) ? raw : (raw as { tickets: Ticket[] }).tickets ?? [];
        setAllTickets(data);
        setStats(statsData);
        setAnalytics(analyticsData as any);
        if (isSupervisorPlus && agentsData) setAgents(agentsData);
        setLastUpdated(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load. Check your connection.');
      } finally {
        setLoading(false);
      }
    };
    loadRef.current = load;
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!lastUpdated) return;
    const tick = setInterval(() => setSecondsAgo(Math.floor((Date.now() - lastUpdated) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

  const handleTicketClick = (id: string) => { onSelectTicket(id); navigate('/inbox'); };

  const toEpoch = (ts: string | number): number => {
    if (typeof ts === 'number') return ts;
    if (/^\d+$/.test(ts)) return Number(ts);
    return new Date(ts).getTime() / 1000;
  };
  const sortByCreated = (a: Ticket, b: Ticket) => toEpoch(b.created_at) - toEpoch(a.created_at);

  const vipTickets = useMemo(() =>
    [...allTickets].filter(t => t.priority === 1).sort(sortByCreated).slice(0, 15), [allTickets]);

  const latestTickets = useMemo(() =>
    [...allTickets].filter(t => t.priority !== 1).sort(sortByCreated).slice(0, 15), [allTickets]);

  const escalatedTickets = useMemo(() =>
    allTickets.filter(t => t.status === 'escalated').sort(sortByCreated), [allTickets]);

  const openCount      = stats.open;
  const activeCount    = stats.active;
  const escalatedCount = stats.escalated;
  const pendingCount   = stats.pending;
  const vipCount       = allTickets.filter(t => t.priority === 1).length;

  const updatedLabel = lastUpdated
    ? secondsAgo < 5 ? 'Just updated' : `Updated ${secondsAgo}s ago`
    : null;

  const firstLoad = loading && allTickets.length === 0;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Error banner */}
        {error && (
          <div className="flex items-center justify-between gap-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
            <span className="text-sm text-red-500">{error}</span>
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={() => loadRef.current()} className="text-xs font-semibold text-red-500 hover:text-red-400 transition-colors">Retry</button>
              <button onClick={() => setError(null)} className="text-xs text-text-muted hover:text-text-secondary transition-colors">Dismiss</button>
            </div>
          </div>
        )}

        {/* Greeting header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-text-primary">
              {getGreeting()}{userName ? `, ${userName.split(' ')[0]}` : ''}.
            </h2>
            {escalatedCount === 0 && (
              <p className="text-sm text-text-secondary mt-0.5">Here's what's happening today.</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0 pt-0.5">
            {updatedLabel && <span className="text-[10px] text-text-muted tabular-nums">{updatedLabel}</span>}
            <button
              onClick={() => loadRef.current()} disabled={loading} title="Refresh"
              className="p-1.5 rounded-md hover:bg-surface-3 text-text-muted hover:text-text-secondary transition-colors disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={loading ? 'animate-spin' : ''}>
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Escalated strip */}
        <EscalatedStrip tickets={escalatedTickets} onTicketClick={handleTicketClick} />

        {/* KPI row */}
        {firstLoad ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <KpiCard label="Open Tickets" value={openCount} sub="currently open" accent="blue"
              onClick={() => onNavigateInbox('all_open', 'Open_Live')} />
            <KpiCard label="Active Chats" value={activeCount} sub="in progress" accent="green"
              onClick={() => onNavigateInbox('all_open', 'In_Progress')} />
            <KpiCard label="Escalated" value={escalatedCount} sub="need attention" accent="brand"
              pulse={escalatedCount > 0} onClick={() => onNavigateInbox('all_open', 'Escalated')} />
            <KpiCard label="VIP Tickets" value={vipCount} sub="priority 1" accent="amber"
              onClick={() => onNavigateInbox('by_priority', 'all')} />
            <KpiCard label="Pending" value={pendingCount} sub="awaiting customer" accent="purple"
              onClick={() => onNavigateInbox('all_open', 'Pending_Customer')} />
          </div>
        )}

        {/* Insights row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <ResolutionCard
            total={analytics?.volume.total ?? 0}
            resolved={analytics?.volume.resolved ?? 0}
          />
          <ChannelPie data={analytics?.volume.by_channel ?? []} />
          <TodaySummary
            opened={analytics?.volume.total ?? 0}
            resolved={analytics?.volume.resolved ?? 0}
            pending={pendingCount}
            escalated={escalatedCount}
          />
        </div>

        {/* Agent activity — supervisor / admin / super_admin only */}
        {isSupervisorPlus && agents.length > 0 && <AgentActivity agents={agents} />}

        {/* Ticket tables */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5"
          style={{ height: 'calc(100vh - 320px)', minHeight: 300 }}>
          <TicketTable
            title="VIP Tickets"
            badge={<span className="text-[10px] font-bold bg-brand/10 text-brand px-2 py-0.5 rounded-full">VIP</span>}
            tickets={vipTickets} loading={firstLoad} onTicketClick={handleTicketClick}
          />
          <TicketTable title="Latest Tickets" tickets={latestTickets} loading={firstLoad} onTicketClick={handleTicketClick} />
        </div>

      </div>
    </div>
  );
}
