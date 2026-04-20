import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Agent, QueueItem, SLARiskTicket, SupervisorStats, ChannelHealth, PendingStale, Ticket } from '../types';
import { api } from '../api';
import { usePerm } from '../PermissionContext';
import { Avatar } from './ui/Avatar';
import { SLATimer } from './ui/SLATimer';
import { AgentCardSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtMins(mins: number | string | null | undefined): string {
  const n = Number(mins);
  if (!n || isNaN(n) || n < 0) return '—';
  const w = Math.floor(n / 10080);
  const d = Math.floor((n % 10080) / 1440);
  const h = Math.floor((n % 1440) / 60);
  const m = Math.round(n % 60);
  if (w > 0) return `${w}w ${d}d`;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtSeconds(s: number | string | null | undefined): string {
  const n = Number(s);
  if (!n || isNaN(n)) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  return fmtMins(n / 60);
}

function minutesAgo(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
}

function fmtAgo(iso: string | null | undefined): string {
  const m = minutesAgo(iso);
  if (m === Infinity) return '—';
  if (m < 1) return 'just now';
  return `${fmtMins(m)} ago`;
}

const STATE_DOT: Record<string, string> = {
  Available: 'bg-accent-green',
  Busy:      'bg-accent-amber',
  Break:     'bg-text-muted',
  Offline:   'bg-surface-5',
};

const PRIORITY_COLOR: Record<number, string> = {
  1: 'bg-brand/10 text-brand',
  2: 'bg-accent-amber/10 text-accent-amber',
  3: 'bg-surface-4 text-text-muted',
};

const PRIORITY_LABEL: Record<number, string> = { 1: 'VIP', 2: 'High', 3: 'Normal' };

// ── Attention card — top action strip ────────────────────────────────────────

function AttentionCard({
  count, label, sublabel, color, onFix,
}: {
  count: number;
  label: string;
  sublabel?: string;
  color: 'red' | 'amber' | 'blue' | 'muted';
  onFix?: () => void;
}) {
  const palette = {
    red:   { ring: 'ring-brand/30',         bg: 'bg-brand/5',          num: 'text-brand',         btn: 'bg-brand/10 text-brand hover:bg-brand/20' },
    amber: { ring: 'ring-accent-amber/30',   bg: 'bg-accent-amber/5',   num: 'text-accent-amber',  btn: 'bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/20' },
    blue:  { ring: 'ring-surface-5',         bg: 'bg-surface-2',        num: 'text-text-primary',  btn: 'bg-surface-3 text-text-secondary hover:bg-surface-4' },
    muted: { ring: 'ring-surface-5',         bg: 'bg-surface-2',        num: 'text-text-secondary', btn: 'bg-surface-3 text-text-muted hover:bg-surface-4' },
  }[color];

  return (
    <div className={`${palette.bg} ring-1 ${palette.ring} rounded-xl px-5 py-4 flex items-center justify-between gap-4`}>
      <div>
        <div className={`text-2xl font-bold tabular-nums ${palette.num}`}>{count}</div>
        <div className="text-xs font-medium text-text-primary mt-0.5">{label}</div>
        {sublabel && <div className="text-[10px] text-text-muted mt-0.5">{sublabel}</div>}
      </div>
      {onFix && count > 0 && (
        <button
          onClick={onFix}
          className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg transition-colors shrink-0 ${palette.btn}`}
        >
          Fix →
        </button>
      )}
    </div>
  );
}

// ── Agent row ─────────────────────────────────────────────────────────────────

const AGENT_ROLES = new Set(['agent', 'kyc_agent', 'finance_agent']);

const ROLE_LABEL: Record<string, string> = {
  agent: 'CS', kyc_agent: 'KYC', finance_agent: 'Finance',
  supervisor: 'Supervisor', admin: 'Admin', super_admin: 'Super Admin',
};

// SLA soft cap per team — oldest open ticket beyond this is flagged
const TEAM_SLA_WARN_MINS: Record<string, number> = {
  kyc: 240, withdrawals: 60, cs: 30, default: 30,
};

function agentStatusLine(
  active: number,
  longestMins: number,
  idleMins: number,
  breachedCount: number,
  atRiskCount: number,
  state: string,
  team: string,
): { text: string; color: string } {
  // No tickets + available + idle
  if (active === 0 && state === 'Available') {
    const idle = idleMins !== Infinity && idleMins > 10;
    return idle
      ? { text: `Idle ${fmtMins(idleMins)}`, color: 'text-accent-amber' }
      : { text: 'Available · no open tickets', color: 'text-text-muted' };
  }
  if (active === 0) return { text: 'No open tickets', color: 'text-text-muted' };

  const parts: string[] = [`${active} open`];
  if (breachedCount > 0) parts.push(`${breachedCount} breached`);
  else if (atRiskCount > 0) parts.push(`${atRiskCount} at risk`);

  const slaWarn = TEAM_SLA_WARN_MINS[team] ?? TEAM_SLA_WARN_MINS.default;
  if (longestMins > slaWarn) parts.push(`oldest ${fmtMins(longestMins)}`);

  const color = breachedCount > 0
    ? 'text-brand'
    : atRiskCount > 0 || longestMins > slaWarn
    ? 'text-accent-amber'
    : 'text-text-muted';

  return { text: parts.join('  ·  '), color };
}

function AgentRow({
  agent, breachedCount, atRiskCount, onClick,
}: {
  agent: Agent;
  breachedCount: number;
  atRiskCount: number;
  onClick: () => void;
}) {
  const state       = agent.state ?? agent.status ?? 'Offline';
  const active      = Number(agent.open_ticket_count ?? 0);
  const longestMins = Number(agent.longest_open_mins ?? 0);
  const idleMins    = minutesAgo(agent.last_activity_at);
  const team        = agent.team ?? 'cs';

  // Bar color driven by worst ticket state, not capacity
  const barColor = breachedCount > 0
    ? 'bg-brand'
    : atRiskCount > 0
    ? 'bg-accent-amber'
    : active === 0
    ? 'bg-surface-4'
    : 'bg-accent-green';

  // Bar width: scale against a soft cap of 10; empty if no tickets
  const pct = active === 0 ? 0 : Math.min(100, (active / 10) * 100);

  const { text: statusText, color: statusColor } = agentStatusLine(
    active, longestMins, idleMins, breachedCount, atRiskCount, state, team
  );

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left group"
    >
      {/* Avatar + state dot */}
      <div className="relative shrink-0">
        <Avatar name={agent.name} size="sm" />
        <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-surface-2 ${STATE_DOT[state] ?? 'bg-surface-5'}`}>
          {state === 'Available' && (
            <span className={`absolute inset-0 rounded-full ${STATE_DOT[state]} animate-ping opacity-60`} />
          )}
        </span>
      </div>

      {/* Name + contextual status line */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium text-text-primary truncate">{agent.name}</span>
          <span className="text-[10px] text-text-muted shrink-0">
            {state} · {ROLE_LABEL[agent.role ?? ''] ?? agent.role ?? ''}
            {agent.shift ? ` · ${agent.shift}` : ''}
          </span>
        </div>
        {/* Single status line — only shows what matters */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-surface-4 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className={`text-[10px] tabular-nums shrink-0 ${statusColor}`}>{statusText}</span>
        </div>
      </div>
    </button>
  );
}

// ── Intervention panel — SLA / VIP / stale rows ───────────────────────────────

function InterventionPanel({
  title, count, badgeColor, children,
}: {
  title: string;
  count: number;
  badgeColor: 'red' | 'amber' | 'blue';
  children: React.ReactNode;
}) {
  const badge = {
    red:   'bg-brand/10 text-brand',
    amber: 'bg-accent-amber/10 text-accent-amber',
    blue:  'bg-surface-4 text-text-secondary',
  }[badgeColor];

  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl">
      <div className="px-4 py-3 border-b border-surface-5 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">{title}</h3>
        {count > 0 && (
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${badge}`}>{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Assign dropdown (shared) ──────────────────────────────────────────────────

function AssignDropdown({
  ticketId, agents, onAssigned,
}: {
  ticketId: string;
  agents: Agent[];
  onAssigned: () => void;
}) {
  const available = agents.filter(a => (a.state ?? a.status) === 'Available');
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[10px] text-text-muted hover:text-text-primary bg-surface-3 ring-1 ring-surface-5 rounded px-2 py-0.5 transition-colors"
      >
        Assign
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 bg-surface-3 ring-1 ring-surface-5 rounded-lg shadow-xl min-w-[150px] py-1 overflow-hidden">
          {available.length === 0 ? (
            <div className="px-3 py-2 text-xs text-text-muted">No available agents</div>
          ) : available.map(a => (
            <button
              key={a.id}
              onClick={async () => {
                setOpen(false);
                await api.assignTicket(ticketId, a.id).catch(() => null);
                onAssigned();
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-4 transition-colors"
            >
              <Avatar name={a.name} size="xs" />
              <span>{a.name}</span>
              {Number(a.active_chats ?? 0) >= Number(a.max_chats ?? 3) && (
                <span className="ml-auto text-[9px] text-brand">Full</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Agent slide-over ──────────────────────────────────────────────────────────

function AgentSlideOver({ agent, agents, onClose, onReassign }: { agent: Agent; agents: Agent[]; onClose: () => void; onReassign: () => void }) {
  const [tickets, setTickets]       = useState<Ticket[]>([]);
  const [loading, setLoading]       = useState(true);
  const [reassigning, setReassigning] = useState<string | null>(null);
  const navigate    = useNavigate();
  const dropRef     = useRef<HTMLDivElement>(null);
  const canReassign = usePerm('supervisor.reassign');

  useEffect(() => {
    api.getAgentTickets(agent.id)
      .then(d => setTickets(d ?? []))
      .catch(() => setTickets([]))
      .finally(() => setLoading(false));
  }, [agent.id]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setReassigning(null);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const otherAgents = agents.filter(a => a.id !== agent.id && AGENT_ROLES.has(a.role ?? ''));

  async function handleReassign(ticketId: string, agentId: string) {
    setReassigning(null);
    await api.assignTicket(ticketId, agentId).catch(() => null);
    // refresh ticket list + agent grid simultaneously
    const [updated] = await Promise.all([
      api.getAgentTickets(agent.id).catch(() => tickets),
      onReassign(),
    ]);
    setTickets(updated ?? []);
  }

  const state  = agent.state ?? agent.status ?? 'Offline';
  const active = agent.active_chats ?? agent.active_conversation_count ?? 0;
  const max    = agent.max_chats ?? agent.max_capacity ?? 3;

  return (
    <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose}>
      <div className="absolute top-0 right-0 h-full w-full max-w-sm bg-surface-1 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar name={agent.name} size="md" />
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-surface-1 ${STATE_DOT[state] ?? 'bg-surface-5'}`} />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">{agent.name}</div>
              <div className="text-xs text-text-muted">{state} · {active}/{max} chats{agent.shift ? ` · ${agent.shift}` : ''}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {agent.last_activity_at && (
          <div className="px-5 py-2.5 border-b border-surface-5 flex items-center justify-between text-xs">
            <span className="text-text-muted">Last message sent</span>
            <span className="text-text-secondary tabular-nums">{fmtAgo(agent.last_activity_at)}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-5 text-xs text-text-muted">Loading…</div>
          ) : tickets.length === 0 ? (
            <EmptyState title="No active tickets" className="py-10" />
          ) : (
            <div className="divide-y divide-surface-5" ref={dropRef}>
              {tickets.map(t => (
                <div key={t.id} className="px-5 py-3.5 hover:bg-surface-2 transition-colors">
                  {/* Top row: priority + channel + SLA + reassign */}
                  <div className="flex items-center justify-between mb-1.5 gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${PRIORITY_COLOR[t.priority]}`}>
                        {PRIORITY_LABEL[t.priority]}
                      </span>
                      <span className="text-[10px] text-text-muted capitalize">{t.channel}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <SLATimer deadline={t.sla_deadline ?? ''} />
                      {/* Reassign dropdown */}
                      {canReassign && <div className="relative">
                        <button
                          onClick={() => setReassigning(reassigning === t.id ? null : t.id)}
                          className="text-[10px] text-text-muted hover:text-text-primary bg-surface-3 ring-1 ring-surface-5 rounded px-2 py-0.5 transition-colors"
                        >
                          Reassign
                        </button>
                        {reassigning === t.id && (
                          <div className="absolute right-0 top-6 z-30 bg-surface-3 ring-1 ring-surface-5 rounded-lg shadow-xl min-w-[160px] py-1">
                            {otherAgents.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-text-muted">No other agents</div>
                            ) : otherAgents.map(a => (
                              <button
                                key={a.id}
                                onClick={() => handleReassign(t.id, a.id)}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-4 transition-colors"
                              >
                                <Avatar name={a.name} size="xs" />
                                <span className="flex-1 truncate">{a.name}</span>
                                <span className={`text-[9px] tabular-nums ${Number(a.active_chats ?? 0) >= Number(a.max_chats ?? 3) ? 'text-brand' : 'text-text-muted'}`}>
                                  {a.active_chats ?? 0}/{a.max_chats ?? 3}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>}
                    </div>
                  </div>
                  {/* Customer + last message — clickable */}
                  <button
                    className="w-full text-left"
                    onClick={() => { onClose(); navigate(`/inbox?ticket=${t.id}`); }}
                  >
                    <div className="text-xs font-medium text-text-primary truncate hover:underline">
                      {t.customer_name ?? t.customer?.name ?? t.id.slice(0, 12) + '…'}
                    </div>
                    {t.last_message && (
                      <div className="text-[10px] text-text-muted truncate mt-0.5">{t.last_message}</div>
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function SupervisorDashboard() {
  const [agents, setAgents]               = useState<Agent[]>([]);
  const [queues, setQueues]               = useState<QueueItem[]>([]);
  const [slaRisk, setSlaRisk]             = useState<SLARiskTicket[]>([]);
  const [slaBreachedCount, setSlaBreachedCount] = useState(0);
  const [slaAtRiskCount, setSlaAtRiskCount]     = useState(0);
  const [stats, setStats]                 = useState<SupervisorStats | null>(null);
  const [channelHealth, setChannelHealth] = useState<ChannelHealth[]>([]);
  const [pendingStale, setPendingStale]   = useState<PendingStale[]>([]);
  const [lastUpdated, setLastUpdated]     = useState<Date | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState('');
  const [drillAgent, setDrillAgent]       = useState<Agent | null>(null);
  // which section the "Fix →" buttons scroll to
  const slaRef     = useRef<HTMLDivElement>(null);
  const queueRef   = useRef<HTMLDivElement>(null);
  const staleRef   = useRef<HTMLDivElement>(null);
  const agentsRef  = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getSupervisorLive();
      setAgents(data.agents ?? []);
      setQueues(data.queues ?? []);
      setSlaRisk(data.sla_risk ?? []);
      setSlaBreachedCount(data.sla_breached_count ?? 0);
      setSlaAtRiskCount(data.sla_at_risk_count ?? 0);
      setStats(data.stats ?? null);
      setChannelHealth(data.channel_health ?? []);
      setPendingStale(data.pending_stale ?? []);
      setLastUpdated(new Date());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // Derived signals
  const breached      = slaRisk.filter(t => t.sla_breached);
  const vipWaiting    = slaRisk.filter(t => t.tier === 'VIP' || t.tier === 'EA');
  const unassignedQ   = queues.reduce((s, q) => s + Number(q.count), 0);
  const idleAgents    = agents.filter(a => (a.state ?? a.status) === 'Available' && minutesAgo(a.last_activity_at) > 10);
  const stuckAgents   = agents.filter(a => Number(a.longest_open_mins ?? 0) > 45 && (a.active_chats ?? 0) > 0);
  const totalActive   = agents.reduce((s, a) => s + (a.active_chats ?? a.active_conversation_count ?? 0), 0);
  const totalCap      = agents.reduce((s, a) => s + (a.max_chats ?? a.max_capacity ?? 3), 0);
  const teamUtil      = totalCap ? Math.round((totalActive / totalCap) * 100) : 0;
  const botPct        = (() => {
    const c = Number(stats?.bot_contained ?? 0), t = Number(stats?.bot_total ?? 0);
    return t > 0 ? Math.round((c / t) * 100) : null;
  })();
  const oldestQueueMins = queues.reduce((oldest, q) => {
    const m = minutesAgo(q.oldest_at);
    return m < oldest ? m : oldest;
  }, Infinity);

  const needsAttention = slaBreachedCount + slaAtRiskCount + vipWaiting.length + pendingStale.length + idleAgents.length + stuckAgents.length;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="max-w-6xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Supervisor</h2>
            <p className="text-sm text-text-secondary mt-0.5">Live operations</p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && <span className="text-xs text-text-muted">Updated {lastUpdated.toLocaleTimeString()}</span>}
            <button
              onClick={load}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary bg-surface-3 ring-1 ring-surface-5 rounded-md px-3 py-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/>
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-brand/10 ring-1 ring-brand/20 text-brand text-xs px-4 py-3 rounded-lg">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
            </svg>
            {error}
          </div>
        )}

        {/* ── Needs Attention strip ── */}
        {!loading && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Needs your attention</h3>
              {needsAttention === 0 && (
                <span className="text-[10px] text-accent-green flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  All clear
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <AttentionCard
                count={slaBreachedCount}
                label="SLA Breached"
                sublabel={slaBreachedCount > 0 ? `oldest: ${breached[0]?.customer_name ?? 'ticket'}` : 'None right now'}
                color={slaBreachedCount > 0 ? 'red' : 'muted'}
                onFix={() => slaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
              <AttentionCard
                count={slaAtRiskCount}
                label="SLA At Risk"
                sublabel={
                  slaAtRiskCount > 0
                    ? `${slaAtRiskCount} ticket${slaAtRiskCount > 1 ? 's' : ''} approaching deadline`
                    : slaBreachedCount > 0
                    ? `${slaBreachedCount} already breached`
                    : 'All SLAs healthy'
                }
                color={slaAtRiskCount > 0 ? 'amber' : 'muted'}
                onFix={() => slaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
              <AttentionCard
                count={vipWaiting.length}
                label="VIP / EA Waiting"
                sublabel={vipWaiting.length > 0 ? vipWaiting.map(t => t.customer_name).filter(Boolean).join(', ') : 'No VIPs waiting'}
                color={vipWaiting.length > 0 ? 'amber' : 'muted'}
                onFix={() => slaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
              <AttentionCard
                count={stuckAgents.length + idleAgents.length}
                label="Agents Need Check"
                sublabel={
                  stuckAgents.length > 0
                    ? `${stuckAgents.length} agent${stuckAgents.length > 1 ? 's' : ''} have a ticket open 45m+`
                    : idleAgents.length > 0
                    ? `${idleAgents.length} available but no activity 10m+`
                    : 'Team flowing well'
                }
                color={(stuckAgents.length + idleAgents.length) > 0 ? 'amber' : 'muted'}
                onFix={() => agentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              />
            </div>
          </div>
        )}

        {/* ── Today's pulse — 2 lean stat rows ── */}
        {stats && !loading && (
          <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl">
            <div className="px-5 py-3 border-b border-surface-5 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Today's Performance</h3>
              <span className="text-[10px] text-text-muted">Since midnight Bangkok time</span>
            </div>
            <div className="px-5 py-4 grid grid-cols-4 lg:grid-cols-7 gap-x-0 divide-x divide-surface-5">
              {[
                { label: 'Opened today',     val: String(stats.opened_today ?? '—') },
                { label: 'Resolved today',   val: String(stats.resolved_today ?? '—'),   sub: stats.resolved_yesterday != null ? `${stats.resolved_yesterday} yesterday` : undefined },
                { label: 'Avg first reply',  val: fmtSeconds(stats.avg_first_response_s ?? stats.avg_first_response_seconds) },
                { label: 'Avg resolution',   val: fmtSeconds(stats.avg_resolution_s ?? stats.avg_resolution_seconds) },
                { label: 'CSAT (7d)',         val: stats.csat_avg != null ? `${Number(stats.csat_avg).toFixed(1)} ★` : '—' },
                { label: 'Bot contained',    val: botPct != null ? `${botPct}%` : '—',   sub: `${stats.bot_active ?? 0} active now` },
                { label: 'Team utilization', val: `${teamUtil}%`,                         sub: `${totalActive}/${totalCap} chats` },
              ].map(({ label, val, sub }) => (
                <div key={label} className="px-5 first:pl-0 last:pr-0">
                  <div className="text-xl font-bold text-text-primary tabular-nums">{val}</div>
                  <div className="text-[10px] text-text-muted mt-1">{label}</div>
                  {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Main content: left = agents, right = action panels ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* Left — Agent team table (3 cols) */}
          <div className="lg:col-span-3" ref={agentsRef}>
            <div className="bg-surface-2 ring-1 ring-surface-5 rounded-xl">
              <div className="px-4 py-3 border-b border-surface-5 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Team</h3>
                <span className="text-xs text-text-muted">
                  Load{' '}
                  <span className={`font-semibold ${teamUtil > 80 ? 'text-brand' : teamUtil > 50 ? 'text-accent-amber' : 'text-accent-green'}`}>
                    {teamUtil}%
                  </span>
                  <span className="text-text-muted"> · chats / max · longest open</span>
                </span>
              </div>

              {loading ? (
                <div className="divide-y divide-surface-5">
                  {Array.from({ length: 5 }).map((_, i) => <AgentCardSkeleton key={i} />)}
                </div>
              ) : agents.length === 0 ? (
                <EmptyState title="No agents online" className="py-8" />
              ) : (
                <div className="divide-y divide-surface-5">
                  {agents.map(a => {
                    const agentTickets = slaRisk.filter(t =>
                      (t.assigned_to_name === a.name) || (t.assigned_agent_name === a.name)
                    );
                    return (
                      <AgentRow
                        key={a.id}
                        agent={a}
                        breachedCount={agentTickets.filter(t => t.sla_breached).length}
                        atRiskCount={agentTickets.filter(t => !t.sla_breached).length}
                        onClick={() => setDrillAgent(a)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Channel breakdown — inline below agents */}
              {!loading && channelHealth.length > 0 && (
                <>
                  <div className="px-4 py-2 border-t border-surface-5 bg-surface-1">
                    <span className="text-[10px] text-text-muted uppercase tracking-wide">By channel</span>
                  </div>
                  <div className="divide-y divide-surface-5">
                    {channelHealth.map(ch => (
                      <div key={ch.channel} className="flex items-center px-4 py-2.5 gap-3 text-xs">
                        <span className="capitalize text-text-secondary w-16 shrink-0">{ch.channel}</span>
                        <span className="text-text-primary tabular-nums font-semibold w-6">{ch.open_count}</span>
                        <span className="text-text-muted">open</span>
                        <span className="text-text-primary tabular-nums font-semibold ml-3">{ch.queued}</span>
                        <span className="text-text-muted">queued</span>
                        {ch.oldest_queued_at && minutesAgo(ch.oldest_queued_at) > 0 && (
                          <span className={`ml-1 tabular-nums text-[10px] ${minutesAgo(ch.oldest_queued_at) > 15 ? 'text-brand' : 'text-text-muted'}`}>
                            · oldest {fmtAgo(ch.oldest_queued_at)}
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-3">
                          {ch.sla_breached_count > 0 && (
                            <span className="text-brand font-semibold tabular-nums">{ch.sla_breached_count} breached</span>
                          )}
                          {ch.sla_met_pct != null && (
                            <span className={`tabular-nums font-semibold ${ch.sla_met_pct >= 90 ? 'text-accent-green' : 'text-accent-amber'}`}>
                              {ch.sla_met_pct}% SLA
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right — Action panels (2 cols) */}
          <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:px-0.5 lg:py-0.5">

            {/* Queue */}
            <div ref={queueRef}>
              <InterventionPanel
                title="Unassigned Queue"
                count={unassignedQ}
                badgeColor={oldestQueueMins > 15 ? 'red' : oldestQueueMins > 5 ? 'amber' : 'blue'}
              >
                {queues.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-text-muted">Queue is empty</div>
                ) : (
                  <div className="divide-y divide-surface-5">
                    {queues.map((q, i) => {
                      const mins = minutesAgo(q.oldest_at);
                      const urgent = mins !== Infinity && mins > 15;
                      return (
                        <div key={i} className="flex items-center px-4 py-2.5 gap-3">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${q.priority === 1 ? 'bg-brand' : q.priority === 2 ? 'bg-accent-amber' : 'bg-surface-5'}`} />
                          <span className="text-xs text-text-secondary capitalize flex-1">{q.channel}</span>
                          <span className={`text-xs font-bold tabular-nums ${urgent ? 'text-brand' : 'text-text-primary'}`}>
                            {q.count}
                          </span>
                          {q.oldest_at && mins !== Infinity && (
                            <span className={`text-[10px] tabular-nums ${urgent ? 'text-brand' : 'text-text-muted'}`}>
                              oldest {fmtAgo(q.oldest_at)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </InterventionPanel>
            </div>

            {/* SLA at risk + breached */}
            <div ref={slaRef}>
              <InterventionPanel
                title="SLA At Risk"
                count={slaRisk.length}
                badgeColor={breached.length > 0 ? 'red' : 'amber'}
              >
                {slaRisk.length === 0 ? (
                  <div className="flex items-center gap-2 px-4 py-3 text-xs text-accent-green">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                    All SLAs healthy
                  </div>
                ) : (
                  <div className="divide-y divide-surface-5 overflow-y-auto max-h-[260px] rounded-b-xl">
                    {slaRisk.map(t => (
                      <div key={t.id} className={`px-4 py-3 ${t.sla_breached ? 'bg-brand/5' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              {(t.tier === 'VIP' || t.tier === 'EA') && (
                                <span className="text-[9px] font-bold text-brand bg-brand/10 px-1 py-0.5 rounded">{t.tier}</span>
                              )}
                              <span className="text-xs font-medium text-text-primary truncate">
                                {t.customer_name ?? <span className="font-mono text-text-muted">{t.id.slice(0, 10)}…</span>}
                              </span>
                            </div>
                            <div className="text-[10px] text-text-muted">
                              {t.assigned_to_name ?? t.assigned_agent_name ?? 'Unassigned'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {t.sla_deadline
                              ? <SLATimer deadline={t.sla_deadline} />
                              : <span className="text-xs text-text-muted tabular-nums">open {fmtAgo(t.created_at)}</span>
                            }
                            <AssignDropdown ticketId={t.id} agents={agents} onAssigned={load} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </InterventionPanel>
            </div>

            {/* Waiting on customer */}
            {pendingStale.length > 0 && (
              <div ref={staleRef}>
                <InterventionPanel title="Waiting on Customer" count={pendingStale.length} badgeColor="amber">
                  <div className="divide-y divide-surface-5 overflow-y-auto max-h-[200px] rounded-b-xl">
                    {pendingStale.map(t => {
                      const waitMins = minutesAgo(t.last_customer_msg_at ?? t.created_at);
                      const waitLabel = waitMins === Infinity ? '—' : fmtMins(waitMins);
                      return (
                        <div key={t.id} className="flex items-center justify-between px-4 py-2.5 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {(t.tier === 'VIP' || t.tier === 'EA') && (
                                <span className="text-[9px] font-bold text-brand bg-brand/10 px-1 py-0.5 rounded shrink-0">{t.tier}</span>
                              )}
                              <span className="text-xs font-medium text-text-primary truncate">{t.customer_name ?? 'Unknown'}</span>
                            </div>
                            <div className="text-[10px] text-text-muted truncate">{t.assigned_to_name ?? 'Unassigned'}</div>
                          </div>
                          <span className="text-[10px] text-accent-amber tabular-nums shrink-0">
                            no reply: {waitLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </InterventionPanel>
              </div>
            )}

          </div>
        </div>
      </div>

      {drillAgent && <AgentSlideOver agent={drillAgent} agents={agents} onClose={() => setDrillAgent(null)} onReassign={load} />}
    </div>
  );
}
