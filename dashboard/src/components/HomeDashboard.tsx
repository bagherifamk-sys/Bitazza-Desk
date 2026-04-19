import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Ticket, Priority } from '../types';
import { api } from '../api';
import { KpiCard } from './ui/KpiCard';
import { Avatar } from './ui/Avatar';
import { StatusBadge, ChannelBadge, PriorityBadge } from './ui/Badge';
import { KpiCardSkeleton, TableRowSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ts: string | number | null | undefined): string {
  if (!ts) return '—';
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
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
  // Fallback: age-based heuristic when no SLA data
  const created = ticket.created_at;
  if (!created) return 'normal';
  const d = typeof created === 'number' ? new Date(created * 1000) : new Date(created);
  const ageH = (Date.now() - d.getTime()) / 3600000;
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
  title,
  badge,
  tickets,
  loading,
  onTicketClick,
}: {
  title: string;
  badge?: React.ReactNode;
  tickets: Ticket[];
  loading: boolean;
  onTicketClick: (id: string) => void;
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
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} cols={4} />)
        ) : tickets.length === 0 ? (
          <EmptyState title="No tickets" className="h-32" />
        ) : (
          tickets.map(t => (
            <TicketRow key={t.id} ticket={t} onClick={() => onTicketClick(t.id)} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Escalated Strip ───────────────────────────────────────────────────────────

function EscalatedStrip({
  tickets,
  onTicketClick,
}: {
  tickets: Ticket[];
  onTicketClick: (id: string) => void;
}) {
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
        <div
          key={t.id}
          onClick={() => onTicketClick(t.id)}
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
        >
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
        <span className="text-[10px] text-text-muted mt-0.5">
          +{tickets.length - 3} more — go to Inbox
        </span>
      )}
    </div>
  );
}

// ── Home Dashboard ────────────────────────────────────────────────────────────

interface HomeDashboardProps {
  onSelectTicket: (id: string) => void;
}

export default function HomeDashboard({ onSelectTicket }: HomeDashboardProps) {
  const navigate = useNavigate();
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState({ open: 0, active: 0, escalated: 0, pending: 0, resolved: 0, closed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const loadRef = useRef<() => void>(() => {});

  const userName = (() => {
    try { return JSON.parse(localStorage.getItem('auth_user') ?? '{}').name ?? ''; } catch { return ''; }
  })();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [raw, statsData] = await Promise.all([
          api.getTickets('all_open', ''),
          api.getTicketStats(),
        ]);
        const data: Ticket[] = Array.isArray(raw) ? raw : (raw as { tickets: Ticket[] }).tickets ?? [];
        setAllTickets(data);
        setStats(statsData);
        setLastUpdated(Date.now());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load tickets. Check your connection.');
      } finally {
        setLoading(false);
      }
    };
    loadRef.current = load;
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  // "Updated Xs ago" ticker
  useEffect(() => {
    if (!lastUpdated) return;
    const tick = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdated) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

  const handleTicketClick = (id: string) => {
    onSelectTicket(id);
    navigate('/inbox');
  };

  const sortByCreated = (a: Ticket, b: Ticket) => {
    const ta = typeof a.created_at === 'number' ? a.created_at : new Date(a.created_at).getTime() / 1000;
    const tb = typeof b.created_at === 'number' ? b.created_at : new Date(b.created_at).getTime() / 1000;
    return tb - ta;
  };

  const vipTickets = useMemo(() =>
    [...allTickets].filter(t => t.priority === 1).sort(sortByCreated).slice(0, 15),
    [allTickets]
  );

  const latestTickets = useMemo(() =>
    [...allTickets].filter(t => t.priority !== 1).sort(sortByCreated).slice(0, 15),
    [allTickets]
  );

  const escalatedTickets = useMemo(() =>
    allTickets.filter(t => t.status === 'escalated').sort(sortByCreated),
    [allTickets]
  );

  const openCount      = stats.open;
  const activeCount    = stats.active;
  const escalatedCount = stats.escalated;
  const pendingCount   = stats.pending;
  const vipCount       = stats.open > 0 ? allTickets.filter(t => t.priority === 1).length : 0;

  const updatedLabel = lastUpdated
    ? secondsAgo < 5 ? 'Just updated' : `Updated ${secondsAgo}s ago`
    : null;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Error banner */}
        {error && (
          <div className="flex items-center justify-between gap-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
            <span className="text-sm text-red-500">{error}</span>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => loadRef.current()}
                className="text-xs font-semibold text-red-500 hover:text-red-400 transition-colors"
              >
                Retry
              </button>
              <button
                onClick={() => setError(null)}
                className="text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                Dismiss
              </button>
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
            {updatedLabel && (
              <span className="text-[10px] text-text-muted tabular-nums">{updatedLabel}</span>
            )}
            <button
              onClick={() => loadRef.current()}
              disabled={loading}
              title="Refresh"
              className="p-1.5 rounded-md hover:bg-surface-3 text-text-muted hover:text-text-secondary transition-colors disabled:opacity-40"
            >
              {/* Simple inline SVG refresh icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={loading ? 'animate-spin' : ''}
              >
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
        {loading && allTickets.length === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <KpiCard
              label="Open Tickets"
              value={openCount}
              sub="currently open"
              accent="blue"
            />
            <KpiCard
              label="Active Chats"
              value={activeCount}
              sub="in progress"
              accent="green"
            />
            <KpiCard
              label="Escalated"
              value={escalatedCount}
              sub="need attention"
              accent="brand"
              pulse={escalatedCount > 0}
              onClick={() => navigate('/inbox')}
            />
            <KpiCard
              label="VIP Tickets"
              value={vipCount}
              sub="priority 1"
              accent="amber"
            />
            <KpiCard
              label="Pending"
              value={pendingCount}
              sub="awaiting customer"
              accent="purple"
            />
          </div>
        )}

        {/* Ticket tables */}
        <div
          className="grid grid-cols-1 xl:grid-cols-2 gap-5"
          style={{ height: 'calc(100vh - 320px)', minHeight: 300 }}
        >
          <TicketTable
            title="VIP Tickets"
            badge={
              <span className="text-[10px] font-bold bg-brand/10 text-brand px-2 py-0.5 rounded-full">VIP</span>
            }
            tickets={vipTickets}
            loading={loading && allTickets.length === 0}
            onTicketClick={handleTicketClick}
          />
          <TicketTable
            title="Latest Tickets"
            tickets={latestTickets}
            loading={loading && allTickets.length === 0}
            onTicketClick={handleTicketClick}
          />
        </div>

      </div>
    </div>
  );
}
