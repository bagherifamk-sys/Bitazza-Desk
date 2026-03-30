import { useState } from 'react';
import type { Ticket, InboxView, Priority, Sentiment, TicketStatus } from '../types';

const VIEWS: { id: InboxView; label: string }[] = [
  { id: 'all_open',    label: 'All Open' },
  { id: 'mine',        label: 'Mine' },
  { id: 'unassigned',  label: 'Unassigned' },
  { id: 'sla_risk',    label: 'SLA Risk' },
  { id: 'waiting',     label: 'Waiting' },
  { id: 'by_priority', label: 'Priority' },
];

// Monochrome — only #D32F2F for SLA breach/escalated per spec
const STATUS_STYLE: Partial<Record<TicketStatus, string>> = {
  Open_Live:            'border-[#000] text-[#000]',
  In_Progress:          'border-[#333] text-[#333]',
  Pending_Customer:     'border-[#999] text-[#999]',
  Escalated:            'border-[#D32F2F] text-[#D32F2F]',
  Closed_Resolved:      'border-[#CCC] text-[#CCC]',
  Closed_Unresponsive:  'border-[#CCC] text-[#CCC]',
};

const PRIORITY_DOT: Record<Priority, string> = {
  1: 'bg-[#D32F2F]',   // VIP — red
  2: 'bg-[#333]',      // EA  — dark
  3: 'bg-[#CCC]',      // Std — light
};

const PRIORITY_LABEL: Record<Priority, string> = { 1: 'VIP', 2: 'EA', 3: '' };

const SENTIMENT_CHAR: Record<Sentiment, string> = {
  positive: '+', neutral: '~', negative: '−',
};

const CHANNEL_LABEL: Record<string, string> = {
  web: 'WEB', line: 'LINE', facebook: 'FB', email: 'EMAIL',
};

function timeAgo(ts: string | number | null | undefined): string {
  if (!ts) return '';
  const epoch = typeof ts === 'number' ? ts : Math.floor(new Date(ts).getTime() / 1000);
  const s = Math.floor(Date.now() / 1000) - epoch;
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function isSlaRisk(ticket: Ticket): boolean {
  const dl = ticket.sla_deadline ?? ticket.sla_breach_at;
  if (!dl) return false;
  const diff = new Date(dl).getTime() - Date.now();
  return diff > 0 && diff < 30 * 60 * 1000; // < 30 min
}

interface Props {
  tickets: Ticket[];
  selectedId: string | null;
  view: InboxView;
  search: string;
  onSelect: (id: string) => void;
  onViewChange: (v: InboxView) => void;
  onSearchChange: (s: string) => void;
  onRefresh: () => void;
}

export default function ConversationList({
  tickets, selectedId, view, search,
  onSelect, onViewChange, onSearchChange, onRefresh,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleBulkClose = async () => {
    if (selected.size > 10 && !confirm(`Close ${selected.size} conversations?`)) return;
    setBulkLoading(true);
    try {
      // Bulk close: set each to Closed_Resolved (no bulkAction endpoint yet)
      await Promise.all(
        [...selected].map(id =>
          fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/tickets/${id}/status`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${JSON.parse(localStorage.getItem('auth_user') ?? '{}').token ?? ''}`,
            },
            body: JSON.stringify({ status: 'Closed_Resolved' }),
          })
        )
      );
      setSelected(new Set());
      onRefresh();
    } finally { setBulkLoading(false); }
  };

  const open      = tickets.filter(t => t.status === 'Open_Live').length;
  const active    = tickets.filter(t => t.status === 'In_Progress').length;
  const escalated = tickets.filter(t => t.status === 'Escalated').length;

  return (
    <aside className="w-[320px] shrink-0 bg-white border-r border-[#EAEAEA] flex flex-col">

      {/* Stats row */}
      <div className="px-4 py-2.5 border-b border-[#EAEAEA] flex items-center gap-4">
        <Stat label="Open"      value={open} />
        <Stat label="Active"    value={active} />
        <Stat label="Escalated" value={escalated} alert={escalated > 0} />
        <button onClick={onRefresh} className="ml-auto text-[#999] hover:text-[#000] text-sm">↻</button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-[#EAEAEA]">
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="w-full text-xs border border-[#CCC] px-3 py-1.5 outline-none focus:border-[#000] transition-colors"
        />
      </div>

      {/* View tabs */}
      <div className="flex overflow-x-auto border-b border-[#EAEAEA] shrink-0">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => onViewChange(v.id)}
            className={`shrink-0 text-[11px] px-3 py-2 border-b-2 whitespace-nowrap transition-colors ${
              view === v.id
                ? 'border-[#000] text-[#000] font-semibold'
                : 'border-transparent text-[#999] hover:text-[#333]'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="px-3 py-2 bg-[#f5f5f5] border-b border-[#EAEAEA] flex items-center gap-2">
          <span className="text-xs text-[#333] font-medium">{selected.size} selected</span>
          <button
            onClick={handleBulkClose}
            disabled={bulkLoading}
            className="text-xs px-2 py-1 border border-[#D32F2F] text-[#D32F2F] hover:bg-[#D32F2F] hover:text-white transition-colors disabled:opacity-40"
          >
            Close all
          </button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-[#999] ml-auto hover:text-[#000]">✕</button>
        </div>
      )}

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {tickets.length === 0
          ? <div className="flex items-center justify-center h-20 text-[#999] text-xs">No conversations</div>
          : tickets.map(ticket => {
              const risk = isSlaRisk(ticket);
              const tier = ticket.customer?.tier;
              const lastTs = ticket.last_message_at ?? ticket.updated_at ?? ticket.created_at;

              return (
                <div
                  key={ticket.id}
                  onClick={() => onSelect(ticket.id)}
                  className={`flex items-start gap-2 px-3 py-3 border-b border-[#f5f5f5] cursor-pointer transition-colors hover:bg-[#fafafa] ${
                    selectedId === ticket.id ? 'bg-[#f5f5f5] border-l-2 border-l-[#000]' : ''
                  }`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selected.has(ticket.id)}
                    onClick={e => toggleSelect(ticket.id, e)}
                    onChange={() => {}}
                    className="mt-1 shrink-0"
                  />

                  <div className="flex-1 min-w-0">
                    {/* Row 1: name + time */}
                    <div className="flex items-center justify-between mb-0.5 gap-1">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs font-medium text-[#000] truncate">
                          {ticket.customer?.name ?? 'Unknown'}
                        </span>
                        {tier === 'VIP' && (
                          <span className="text-[9px] font-bold text-[#000] border border-[#000] px-1 shrink-0">VIP</span>
                        )}
                        {tier === 'EA' && (
                          <span className="text-[9px] text-[#666] border border-[#666] px-1 shrink-0">EA</span>
                        )}
                      </div>
                      <span className="text-[10px] text-[#999] shrink-0">{timeAgo(lastTs)}</span>
                    </div>

                    {/* Row 2: last message */}
                    <p className="text-[11px] text-[#666] truncate mb-1.5">
                      {ticket.last_message ?? '—'}
                    </p>

                    {/* Row 3: badges */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {/* Channel */}
                      <span className="text-[9px] border border-[#CCC] text-[#999] px-1">
                        {CHANNEL_LABEL[ticket.channel] ?? ticket.channel.toUpperCase()}
                      </span>

                      {/* Status */}
                      <span className={`text-[9px] border px-1 ${STATUS_STYLE[ticket.status] ?? 'border-[#CCC] text-[#999]'}`}>
                        {ticket.status.replace(/_/g, ' ')}
                      </span>

                      {/* Priority dot + label */}
                      <span className="flex items-center gap-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[ticket.priority as Priority] ?? 'bg-[#CCC]'}`} />
                        {PRIORITY_LABEL[ticket.priority as Priority] && (
                          <span className="text-[9px] text-[#666]">{PRIORITY_LABEL[ticket.priority as Priority]}</span>
                        )}
                      </span>

                      {/* Sentiment */}
                      {ticket.sentiment && (
                        <span className={`text-[9px] font-mono ${
                          ticket.sentiment === 'negative' ? 'text-[#D32F2F]'
                          : ticket.sentiment === 'positive' ? 'text-[#2E7D32]'
                          : 'text-[#999]'
                        }`}>
                          {SENTIMENT_CHAR[ticket.sentiment]}
                        </span>
                      )}

                      {/* SLA risk */}
                      {(risk || ticket.sla_breached) && (
                        <span className="text-[9px] text-[#D32F2F] border border-[#D32F2F] px-1">
                          {ticket.sla_breached ? 'BREACHED' : 'SLA'}
                        </span>
                      )}

                      {/* Collision */}
                      {(ticket.collision_agent_ids?.length ?? 0) > 0 && (
                        <span className="text-[9px] border border-[#999] text-[#666] px-1">viewing</span>
                      )}

                      {/* Tags (first 2) */}
                      {ticket.tags?.slice(0, 2).map(tag => (
                        <span key={tag} className="text-[9px] bg-[#f5f5f5] text-[#666] px-1">{tag}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
        }
      </div>
    </aside>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="text-center">
      <div className={`text-sm font-bold ${alert ? 'text-[#D32F2F]' : 'text-[#000]'}`}>{value}</div>
      <div className="text-[9px] text-[#999] uppercase tracking-wide">{label}</div>
    </div>
  );
}
