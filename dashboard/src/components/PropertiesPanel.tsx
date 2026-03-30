import { useState, useEffect } from 'react';
import { usePerm } from '../PermissionContext';
import type { Ticket, TicketStatus, Priority, Agent } from '../types';
import { api } from '../api';
import CopilotPanel from './CopilotPanel';

// ── FR-09: Core API panel ─────────────────────────────────────────────────────

type CoreProfile = Awaited<ReturnType<typeof api.getCoreProfile>>;

function CoreApiPanel({ bitazzaUid }: { bitazzaUid: string }) {
  const [data, setData]       = useState<CoreProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError(''); setData(null);
    api.getCoreProfile(bitazzaUid)
      .then(setData)
      .catch(e => setError(e instanceof Error ? e.message : 'Unavailable'))
      .finally(() => setLoading(false));
  }, [bitazzaUid]);

  return (
    <section className="px-4 py-4 border-b border-[#EAEAEA]">
      <h3 className="text-[10px] font-semibold text-[#999] uppercase tracking-wider mb-2">
        Live Account
      </h3>

      {loading && (
        <div className="space-y-1.5">
          {[1,2,3].map(i => (
            <div key={i} className="h-3 bg-[#f5f5f5] rounded animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-[11px] text-[#999] italic">{error}</p>
      )}

      {data && !loading && (
        <div className="space-y-3">
          {/* KYC + Account status */}
          <div className="space-y-1">
            <Row label="KYC Status"  value={`${data.kyc_status} (L${data.kyc_level})`} />
            <Row label="Account"     value={data.account_status} />
          </div>

          {/* Balances */}
          {data.balances?.length > 0 && (
            <div>
              <p className="text-[10px] text-[#999] uppercase tracking-wide mb-1">Balances</p>
              <div className="space-y-0.5">
                {data.balances.slice(0, 5).map(b => (
                  <div key={b.currency} className="flex justify-between text-[11px]">
                    <span className="text-[#666] font-mono">{b.currency}</span>
                    <span className="text-[#333]">{b.available.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent transactions */}
          {data.recent_transactions?.length > 0 && (
            <div>
              <p className="text-[10px] text-[#999] uppercase tracking-wide mb-1">Recent Txns</p>
              <div className="space-y-0.5">
                {data.recent_transactions.slice(0, 4).map(tx => (
                  <div key={tx.id} className="flex items-center justify-between gap-1 text-[11px]">
                    <span className="text-[#999] shrink-0">{tx.type}</span>
                    <span className="text-[#333] truncate">
                      {tx.amount.toLocaleString()} {tx.currency}
                    </span>
                    <span className={`shrink-0 text-[10px] ${
                      tx.status === 'completed' ? 'text-[#2E7D32]' : 'text-[#999]'
                    }`}>{tx.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const TIER_STYLE: Record<string, string> = {
  VIP:      'text-[#000] border-[#000] font-bold',
  EA:       'text-[#333] border-[#333]',
  Standard: 'text-[#999] border-[#CCC]',
};

const STATUS_OPTIONS: TicketStatus[] = [
  'Open_Live', 'In_Progress', 'Pending_Customer',
  'Closed_Resolved', 'Closed_Unresponsive', 'Orphaned', 'Escalated',
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 1, label: '1 — VIP (1 min SLA)' },
  { value: 2, label: '2 — EA (3 min SLA)' },
  { value: 3, label: '3 — Standard (10 min SLA)' },
];

interface Props {
  ticket: Ticket;
  onUpdate: () => void;
  /** Forwarded to CopilotPanel — insert accepted draft into composer */
  onAcceptDraft?: (text: string) => void;
}

export default function PropertiesPanel({ ticket, onUpdate, onAcceptDraft }: Props) {
  const canAssign = usePerm('inbox.assign');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [showReassign, setShowReassign] = useState(false);
  const [handoffNote, setHandoffNote] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [tags, setTags] = useState<string[]>(ticket.tags ?? []);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    api.getAgents().then(setAgents).catch(() => {});
    api.getTags().then(setAllTags).catch(() => {});
  }, []);

  useEffect(() => { setTags(ticket.tags ?? []); }, [ticket.id]);

  const handleStatus = async (status: TicketStatus) => {
    try { await api.setStatus(ticket.id, status); onUpdate(); } catch { /* silent */ }
  };

  const handlePriority = async (priority: Priority) => {
    try { await api.setPriority(ticket.id, priority); onUpdate(); } catch { /* silent */ }
  };

  const handleReassign = async (agentId: string) => {
    setReassigning(true);
    try {
      await api.assign(ticket.id, agentId, undefined, handoffNote || undefined);
      setShowReassign(false);
      setHandoffNote('');
      onUpdate();
    } catch { /* silent */ } finally { setReassigning(false); }
  };

  const toggleTag = async (tag: string) => {
    const next = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
    setTags(next);
    try { await api.setTags(ticket.id, next); } catch { setTags(tags); }
  };

  const addCustomTag = async () => {
    const t = newTag.trim().toLowerCase().replace(/\s+/g, '_');
    if (!t || tags.includes(t)) return;
    setNewTag('');
    if (!allTags.includes(t)) setAllTags(prev => [...prev, t]);
    await toggleTag(t);
  };

  const tier = ticket.customer?.tier ?? 'Standard';
  const assignedName = ticket.assigned_to_name ?? ticket.assigned_agent_name ?? 'Unassigned';

  return (
    <aside className="w-[340px] shrink-0 bg-white border-l border-[#EAEAEA] flex flex-col overflow-y-auto">

      {/* ── Customer ──────────────────────────────────────────────────── */}
      <section className="px-4 py-4 border-b border-[#EAEAEA]">
        <h3 className="text-[10px] font-semibold text-[#999] uppercase tracking-wider mb-3">Customer</h3>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 border border-[#CCC] flex items-center justify-center text-[#333] font-bold text-sm shrink-0">
            {(ticket.customer?.name ?? 'U')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[#000] truncate">{ticket.customer?.name ?? '—'}</div>
            <div className="text-[11px] text-[#999] truncate">{ticket.customer?.email ?? '—'}</div>
          </div>
          <span className={`text-[10px] px-2 py-0.5 border rounded-full shrink-0 ${TIER_STYLE[tier] ?? TIER_STYLE.Standard}`}>
            {tier}
          </span>
        </div>
        <div className="space-y-1.5">
          <Row label="UID"         value={ticket.customer?.bitazza_uid ?? ticket.customer?.user_id ?? '—'} mono />
          <Row label="KYC"         value={ticket.customer?.kyc_status ?? '—'} />
          <Row label="Past tickets" value={String(ticket.customer?.past_conversation_count ?? 0)} />
          <Row label="Channel"     value={ticket.channel} />
          <Row label="Category"    value={ticket.category?.replace(/_/g, ' ') ?? '—'} />
        </div>
      </section>

      {/* ── Ticket controls ───────────────────────────────────────────── */}
      <section className="px-4 py-4 border-b border-[#EAEAEA]">
        <h3 className="text-[10px] font-semibold text-[#999] uppercase tracking-wider mb-3">Ticket</h3>

        <label className="text-[11px] text-[#999] mb-1 block">Status</label>
        <select
          value={ticket.status}
          onChange={e => handleStatus(e.target.value as TicketStatus)}
          className="w-full text-xs border border-[#CCC] px-2 py-1.5 mb-3 outline-none focus:border-[#000] bg-white"
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>

        <label className="text-[11px] text-[#999] mb-1 block">Priority</label>
        <select
          value={ticket.priority}
          onChange={e => handlePriority(Number(e.target.value) as Priority)}
          className="w-full text-xs border border-[#CCC] px-2 py-1.5 mb-3 outline-none focus:border-[#000] bg-white"
        >
          {PRIORITY_OPTIONS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] text-[#999] block">Assigned to</span>
            <span className="text-xs text-[#333]">{assignedName}</span>
          </div>
          {canAssign && (
          <button
            onClick={() => setShowReassign(v => !v)}
            className="text-[11px] border border-[#CCC] px-2 py-1 hover:border-[#000] transition-colors"
          >
            Reassign
          </button>
          )}
        </div>

        {/* Reassign panel */}
        {showReassign && (
          <div className="mt-3 border border-[#EAEAEA] bg-[#fafafa] p-3">
            <p className="text-[11px] font-semibold text-[#333] mb-2">Select agent</p>
            <div className="space-y-0.5 max-h-36 overflow-y-auto mb-2">
              {agents.length === 0 && (
                <p className="text-[11px] text-[#999]">No agents available</p>
              )}
              {agents
                .filter(a => (a.state ?? a.status) !== 'Offline')
                .map(a => {
                  const active = a.active_chats ?? a.active_conversation_count ?? 0;
                  const max = a.max_chats ?? a.max_capacity ?? 3;
                  const full = active >= max;
                  return (
                    <button
                      key={a.id}
                      onClick={() => !full && handleReassign(a.id)}
                      disabled={reassigning || full}
                      className={`w-full text-left text-xs px-2 py-1.5 flex items-center gap-2 transition-colors ${
                        full ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        (a.state ?? a.status) === 'Available' ? 'bg-[#2E7D32]' : 'bg-[#999]'
                      }`} />
                      <span className="flex-1 truncate">{a.name}</span>
                      <span className="text-[#999] shrink-0">{active}/{max}</span>
                    </button>
                  );
                })}
            </div>
            <textarea
              value={handoffNote}
              onChange={e => setHandoffNote(e.target.value)}
              placeholder="Handoff note (optional)…"
              className="w-full text-xs border border-[#CCC] px-2 py-1.5 resize-none outline-none focus:border-[#000]"
              rows={2}
            />
          </div>
        )}
      </section>

      {/* ── Tags ──────────────────────────────────────────────────────── */}
      <section className="px-4 py-4 border-b border-[#EAEAEA]">
        <h3 className="text-[10px] font-semibold text-[#999] uppercase tracking-wider mb-2">Tags</h3>
        <div className="flex flex-wrap gap-1 mb-2">
          {allTags.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`text-[10px] px-2 py-0.5 border transition-colors ${
                tags.includes(tag)
                  ? 'bg-[#000] text-white border-[#000]'
                  : 'border-[#CCC] text-[#666] hover:border-[#000]'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomTag()}
            placeholder="Add tag…"
            className="flex-1 text-xs border border-[#CCC] px-2 py-1 outline-none focus:border-[#000]"
          />
          <button
            onClick={addCustomTag}
            className="text-xs border border-[#CCC] px-2 py-1 hover:border-[#000] transition-colors"
          >
            +
          </button>
        </div>
      </section>

      {/* ── FR-09: Live Account (Core API) ───────────────────────────── */}
      {ticket.customer?.bitazza_uid && (
        <CoreApiPanel bitazzaUid={ticket.customer.bitazza_uid} />
      )}

      {/* ── Copilot ───────────────────────────────────────────────────── */}
      <CopilotPanel ticketId={ticket.id} onAcceptDraft={onAcceptDraft} />

    </aside>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-[#999] shrink-0">{label}</span>
      <span className={`text-[11px] text-[#333] truncate text-right ${mono ? 'font-mono text-[10px]' : ''}`}>
        {value}
      </span>
    </div>
  );
}
