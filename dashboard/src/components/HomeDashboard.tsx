import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Ticket, Priority } from '../types';
import { api } from '../api';

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

const PRIORITY_LABEL: Record<Priority, string> = { 1: 'VIP', 2: 'EA', 3: 'Standard' };
const PRIORITY_COLOR: Record<Priority, string> = {
  1: 'bg-[#E63946] text-white',
  2: 'bg-[#111] text-white',
  3: 'bg-[#E5E5E5] text-[#666]',
};

const STATUS_COLOR: Record<string, string> = {
  Open_Live:           'bg-[#22C55E]/10 text-[#16A34A]',
  In_Progress:         'bg-[#3B82F6]/10 text-[#2563EB]',
  Pending_Customer:    'bg-[#F59E0B]/10 text-[#D97706]',
  Escalated:           'bg-[#E63946]/10 text-[#E63946]',
  Closed_Resolved:     'bg-[#E5E5E5] text-[#666]',
  Closed_Unresponsive: 'bg-[#E5E5E5] text-[#666]',
  Orphaned:            'bg-[#E5E5E5] text-[#666]',
};

const CHANNEL_LABEL: Record<string, string> = {
  web: 'WEB', line: 'LINE', facebook: 'FB', email: 'EMAIL',
};

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}

function KpiCard({ label, value, sub, accent }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] px-5 py-4 flex flex-col gap-1 shadow-sm">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-[#999]">{label}</span>
      <span className={`text-3xl font-bold leading-none ${accent ? 'text-[#E63946]' : 'text-[#111]'}`}>
        {value}
      </span>
      {sub && <span className="text-[11px] text-[#999]">{sub}</span>}
    </div>
  );
}

// ── Ticket Row ────────────────────────────────────────────────────────────────

interface TicketRowProps {
  ticket: Ticket;
  onClick: () => void;
}

function TicketRow({ ticket, onClick }: TicketRowProps) {
  const name = ticket.customer?.name ?? 'Unknown';
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <tr
      onClick={onClick}
      className="border-b border-[#F0F0F0] hover:bg-[#FAFAFA] cursor-pointer transition-colors"
    >
      {/* Customer */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-[#111] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[#111] truncate max-w-[120px]">{name}</div>
            <div className="text-[10px] text-[#999] truncate max-w-[120px]">
              {ticket.customer?.email ?? ticket.customer?.bitazza_uid ?? '—'}
            </div>
          </div>
        </div>
      </td>

      {/* Preview */}
      <td className="px-4 py-3 max-w-[200px]">
        <span className="text-xs text-[#444] line-clamp-2 leading-relaxed">
          {ticket.last_message ?? '—'}
        </span>
      </td>

      {/* Channel */}
      <td className="px-4 py-3">
        <span className="text-[10px] font-mono bg-[#F0F0F0] text-[#555] px-2 py-0.5 rounded">
          {CHANNEL_LABEL[ticket.channel] ?? ticket.channel.toUpperCase()}
        </span>
      </td>

      {/* Priority */}
      <td className="px-4 py-3">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[ticket.priority]}`}>
          {PRIORITY_LABEL[ticket.priority]}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[ticket.status] ?? 'bg-[#E5E5E5] text-[#666]'}`}>
          {ticket.status.replace(/_/g, ' ')}
        </span>
      </td>

      {/* Time */}
      <td className="px-4 py-3 text-right">
        <span className="text-[11px] text-[#999]">
          {relativeTime(ticket.last_message_at ?? ticket.created_at)}
        </span>
      </td>
    </tr>
  );
}

// ── Ticket Table ──────────────────────────────────────────────────────────────

interface TicketTableProps {
  title: string;
  badge?: React.ReactNode;
  tickets: Ticket[];
  loading: boolean;
  onTicketClick: (id: string) => void;
}

function TicketTable({ title, badge, tickets, loading, onTicketClick }: TicketTableProps) {
  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] shadow-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#F0F0F0] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#111]">{title}</span>
          {badge}
        </div>
        <span className="text-[11px] text-[#999]">{tickets.length} tickets</span>
      </div>

      {/* Table */}
      <div className="overflow-y-auto flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-[#E5E5E5] border-t-[#111] rounded-full animate-spin" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-[#999] text-sm">No tickets</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA]">
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#999]">Customer</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#999]">Last Message</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#999]">Channel</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#999]">Priority</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-[#999]">Status</th>
                <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-[#999]">Time</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <TicketRow key={t.id} ticket={t} onClick={() => onTicketClick(t.id)} />
              ))}
            </tbody>
          </table>
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

  // Derived lists
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

  // KPI derivations
  const openCount = allTickets.filter(t => t.status === 'Open_Live' || t.status === 'In_Progress').length;
  const activeCount = allTickets.filter(t => t.status === 'In_Progress').length;
  const escalatedCount = allTickets.filter(t => t.status === 'Escalated').length;
  const vipCount = allTickets.filter(t => t.priority === 1).length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* KPI Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <KpiCard label="Open Tickets" value={openCount} sub="currently open" />
          <KpiCard label="Active Chats" value={activeCount} sub="in progress" />
          <KpiCard label="Escalated" value={escalatedCount} sub="need attention" accent={escalatedCount > 0} />
          <KpiCard label="VIP Tickets" value={vipCount} sub="priority 1" accent={vipCount > 0} />
          <KpiCard label="Total Queue" value={allTickets.length} sub="all open tickets" />
        </div>

        {/* Tables Row */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 min-h-0" style={{ height: 'calc(100vh - 260px)' }}>
          <TicketTable
            title="VIP Tickets"
            badge={
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#E63946] text-white">
                VIP
              </span>
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
