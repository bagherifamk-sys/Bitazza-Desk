import { useState } from 'react';
import type { Ticket, InboxView, Priority, TicketStatus } from '../types';
import { ChannelBadge, PriorityBadge } from './ui/Badge';
import { Avatar } from './ui/Avatar';
import { ConversationRowSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';

const VIEWS: { id: InboxView; label: string }[] = [
  { id: 'all_open',    label: 'All Open'    },
  { id: 'mine',        label: 'Mine'        },
  { id: 'unassigned',  label: 'Unassigned'  },
  { id: 'sla_risk',    label: 'SLA Risk'    },
  { id: 'waiting',     label: 'Waiting'     },
  { id: 'by_priority', label: 'Priority'    },
];

// Status → left-accent color
const STATUS_ACCENT: Partial<Record<TicketStatus, string>> = {
  Open_Live:        'bg-accent-green',
  In_Progress:      'bg-accent-blue',
  Pending_Customer: 'bg-accent-amber',
  Escalated:        'bg-brand',
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
  return diff > 0 && diff < 30 * 60 * 1000;
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
  const [loading] = useState(false); // would be true while initial fetch

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

  const openCount      = tickets.filter(t => t.status === 'Open_Live').length;
  const activeCount    = tickets.filter(t => t.status === 'In_Progress').length;
  const escalatedCount = tickets.filter(t => t.status === 'Escalated').length;

  return (
    <aside className="w-[300px] shrink-0 bg-surface-1 border-r border-surface-5 flex flex-col">

      {/* Stats row */}
      <div className="px-4 py-2.5 border-b border-surface-5 flex items-center gap-4 shrink-0">
        <StatPill label="Open"      value={openCount} />
        <StatPill label="Active"    value={activeCount} color="text-accent-blue" />
        <StatPill label="Escalated" value={escalatedCount} color={escalatedCount > 0 ? 'text-brand' : undefined} />
        <button
          onClick={onRefresh}
          className="ml-auto w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-surface-4 transition-colors"
          title="Refresh"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
          </svg>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-surface-5 shrink-0">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
          </svg>
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search conversations…"
            className="w-full bg-surface-3 ring-1 ring-surface-5 text-text-primary text-xs pl-9 pr-3 py-2 rounded-full outline-none focus:ring-brand transition-all placeholder:text-text-muted"
          />
          {search && (
            <button onClick={() => onSearchChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* View tabs */}
      <div className="flex overflow-x-auto border-b border-surface-5 shrink-0 scrollbar-hide">
        {VIEWS.map(v => (
          <button
            key={v.id}
            onClick={() => onViewChange(v.id)}
            className={`shrink-0 text-xs px-3 py-2.5 border-b-2 whitespace-nowrap transition-colors duration-100 ${
              view === v.id
                ? 'border-brand text-text-primary font-semibold'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="px-3 py-2 bg-surface-3 border-b border-surface-5 flex items-center gap-2 shrink-0 animate-slide-in-up">
          <span className="text-xs text-text-primary font-medium">{selected.size} selected</span>
          <button
            onClick={handleBulkClose}
            disabled={bulkLoading}
            className="text-xs px-2.5 py-1 bg-brand/10 text-brand ring-1 ring-brand/20 rounded hover:bg-brand/20 transition-colors disabled:opacity-40"
          >
            {bulkLoading ? 'Closing…' : 'Close all'}
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-text-muted hover:text-text-secondary transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      )}

      {/* Ticket list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <ConversationRowSkeleton key={i} />)
        ) : tickets.length === 0 ? (
          <EmptyState
            title="No conversations"
            description={search ? `No results for "${search}"` : 'All clear — no open conversations.'}
            className="h-40"
          />
        ) : tickets.map(ticket => {
          const risk = isSlaRisk(ticket);
          const lastTs = ticket.last_message_at ?? ticket.updated_at ?? ticket.created_at;
          const accentClass = STATUS_ACCENT[ticket.status] ?? 'bg-surface-5';
          const isSelected = selectedId === ticket.id;
          const isChecked = selected.has(ticket.id);

          return (
            <div
              key={ticket.id}
              onClick={() => onSelect(ticket.id)}
              className={`group relative flex items-start gap-3 px-3 py-3 border-b border-surface-5 cursor-pointer transition-colors duration-100 ${
                isSelected ? 'bg-brand-subtle' : 'hover:bg-surface-4'
              }`}
            >
              {/* Status left-accent bar */}
              <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-r ${accentClass} ${isSelected ? 'opacity-100' : 'opacity-60 group-hover:opacity-80'}`} />

              {/* Hover-reveal checkbox */}
              <div
                className={`absolute left-1.5 top-3.5 z-10 transition-opacity duration-100 ${isChecked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                onClick={e => toggleSelect(ticket.id, e)}
              >
                <div className={`w-4 h-4 rounded flex items-center justify-center ring-1 transition-colors ${isChecked ? 'bg-brand ring-brand' : 'bg-surface-3 ring-surface-5'}`}>
                  {isChecked && <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>}
                </div>
              </div>

              {/* Avatar */}
              <Avatar
                name={ticket.customer?.name ?? '?'}
                size="sm"
                className={`mt-0.5 shrink-0 transition-transform duration-100 group-hover:scale-105 ${isChecked ? 'opacity-0' : ''}`}
              />

              <div className="flex-1 min-w-0">
                {/* Row 1: name + time */}
                <div className="flex items-center justify-between mb-0.5 gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-text-primary truncate">
                      {ticket.customer?.name ?? 'Unknown'}
                    </span>
                    {ticket.customer?.tier === 'VIP' && (
                      <span className="text-[9px] font-bold text-brand bg-brand/10 px-1 rounded shrink-0">VIP</span>
                    )}
                    {ticket.customer?.tier === 'EA' && (
                      <span className="text-[9px] text-accent-amber bg-accent-amber/10 px-1 rounded shrink-0">EA</span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0 tabular-nums">{timeAgo(lastTs)}</span>
                </div>

                {/* Row 2: last message */}
                <p className="text-xs text-text-secondary truncate mb-1.5 leading-relaxed">
                  {ticket.last_message ?? '—'}
                </p>

                {/* Row 3: badges */}
                <div className="flex items-center gap-1 flex-wrap">
                  <ChannelBadge channel={ticket.channel as any} size="xs" />
                  {ticket.priority !== 3 && (
                    <PriorityBadge priority={ticket.priority as Priority} size="xs" />
                  )}
                  {(risk || ticket.sla_breached) && (
                    <span className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      ticket.sla_breached ? 'bg-brand/10 text-brand' : 'bg-accent-amber/10 text-accent-amber'
                    }`}>
                      {ticket.sla_breached ? 'Breached' : 'SLA'}
                    </span>
                  )}
                  {ticket.tags?.slice(0, 2).map(tag => (
                    <span key={tag} className="text-[10px] bg-surface-4 text-text-muted px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                  {(ticket.tags?.length ?? 0) > 2 && (
                    <span className="text-[10px] text-text-muted">+{(ticket.tags?.length ?? 0) - 2}</span>
                  )}
                </div>
              </div>

              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-brand" />
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <div className={`text-sm font-bold font-inter-nums ${color ?? 'text-text-primary'}`}>{value}</div>
      <div className="text-[9px] text-text-muted uppercase tracking-wide">{label}</div>
    </div>
  );
}
