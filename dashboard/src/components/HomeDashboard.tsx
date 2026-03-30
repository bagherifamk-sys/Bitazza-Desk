import { useState, useEffect } from 'react';
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

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── Ticket Row ────────────────────────────────────────────────────────────────

function TicketRow({ ticket, onClick }: { ticket: Ticket; onClick: () => void }) {
  const name = ticket.customer?.name ?? 'Unknown';
  return (
    <div
      onClick={onClick}
      className="group flex items-center gap-3 px-4 py-3 border-b border-surface-5 hover:bg-surface-3 cursor-pointer transition-colors duration-100"
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
        <span className="text-[10px] text-text-muted w-8 text-right tabular-nums">
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

// ── Home Dashboard ────────────────────────────────────────────────────────────

interface HomeDashboardProps {
  onSelectTicket: (id: string) => void;
}

export default function HomeDashboard({ onSelectTicket }: HomeDashboardProps) {
  const navigate = useNavigate();
  const [allTickets, setAllTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  // Read user name from localStorage for greeting
  const userName = (() => {
    try { return JSON.parse(localStorage.getItem('auth_user') ?? '{}').name ?? ''; } catch { return ''; }
  })();

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.getTickets('all_open', '');
        setAllTickets(data);
      } catch {
        setAllTickets([]);
      } finally {
        setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const handleTicketClick = (id: string) => {
    onSelectTicket(id);
    navigate('/inbox');
  };

  const vipTickets = [...allTickets]
    .filter(t => t.priority === 1)
    .sort((a, b) => {
      const ta = typeof a.created_at === 'number' ? a.created_at : new Date(a.created_at).getTime() / 1000;
      const tb = typeof b.created_at === 'number' ? b.created_at : new Date(b.created_at).getTime() / 1000;
      return tb - ta;
    })
    .slice(0, 15);

  const latestTickets = [...allTickets]
    .sort((a, b) => {
      const ta = typeof a.created_at === 'number' ? a.created_at : new Date(a.created_at).getTime() / 1000;
      const tb = typeof b.created_at === 'number' ? b.created_at : new Date(b.created_at).getTime() / 1000;
      return tb - ta;
    })
    .slice(0, 15);

  const openCount      = allTickets.filter(t => t.status === 'Open_Live' || t.status === 'In_Progress').length;
  const activeCount    = allTickets.filter(t => t.status === 'In_Progress').length;
  const escalatedCount = allTickets.filter(t => t.status === 'Escalated').length;
  const vipCount       = allTickets.filter(t => t.priority === 1).length;
  const pendingCount   = allTickets.filter(t => t.status === 'Pending_Customer').length;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Greeting header */}
        <div>
          <h2 className="text-lg font-bold text-text-primary">
            {getGreeting()}{userName ? `, ${userName.split(' ')[0]}` : ''}.
          </h2>
          <p className="text-sm text-text-secondary mt-0.5">
            {escalatedCount > 0
              ? `${escalatedCount} ticket${escalatedCount !== 1 ? 's' : ''} need${escalatedCount === 1 ? 's' : ''} immediate attention.`
              : "Here's what's happening today."}
          </p>
        </div>

        {/* KPI row */}
        {loading ? (
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
              accent="amber"
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
            loading={loading}
            onTicketClick={handleTicketClick}
          />
          <TicketTable
            title="Latest Tickets"
            tickets={latestTickets}
            loading={loading}
            onTicketClick={handleTicketClick}
          />
        </div>

      </div>
    </div>
  );
}
