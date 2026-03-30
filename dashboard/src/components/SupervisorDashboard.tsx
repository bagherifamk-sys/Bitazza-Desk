import { useState, useEffect, useCallback } from 'react';
import type { Agent, QueueItem, SLARiskTicket, SupervisorStats } from '../types';
import { api } from '../api';
import { Avatar } from './ui/Avatar';
import { SLATimer } from './ui/SLATimer';
import { AgentCardSkeleton, KpiCardSkeleton } from './ui/Skeleton';
import { EmptyState } from './ui/EmptyState';

// ── Status config ─────────────────────────────────────────────────────────────

const STATE_COLOR: Record<string, string> = {
  Available: 'bg-accent-green',
  Busy:      'bg-accent-amber',
  Break:     'bg-text-muted',
  Offline:   'bg-brand',
};

const STATE_CARD_TINT: Record<string, string> = {
  Available: 'ring-accent-green/20',
  Busy:      'ring-accent-amber/20',
  Break:     'ring-surface-5',
  Offline:   'ring-brand/20 opacity-60',
};

const PRIORITY_LABEL: Record<string | number, string> = { 1: 'VIP', 2: 'High', 3: 'Std' };

function fmtSeconds(s: number | string | null | undefined): string {
  const n = Number(s);
  if (!n || isNaN(n)) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

// ── Agent Card ────────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: Agent }) {
  const active = agent.active_chats ?? agent.active_conversation_count ?? 0;
  const max    = agent.max_chats ?? agent.max_capacity ?? 3;
  const state  = agent.state ?? agent.status ?? 'Offline';
  const full   = active >= max;
  const pct    = max ? Math.min(100, (active / max) * 100) : 0;
  const stateColor = STATE_COLOR[state] ?? 'bg-text-muted';
  const ringClass  = STATE_CARD_TINT[state] ?? 'ring-surface-5';

  return (
    <div className={`bg-surface-2 ring-1 ${ringClass} rounded-lg p-4 space-y-3 hover:bg-surface-3 transition-colors`}>
      <div className="flex items-center gap-2.5">
        <div className="relative">
          <Avatar name={agent.name} size="md" />
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-surface-2 ${stateColor} ${state === 'Available' ? 'relative' : ''}`}>
            {state === 'Available' && (
              <span className={`absolute inset-0 rounded-full ${stateColor} animate-ping opacity-75`} />
            )}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-text-primary truncate">{agent.name}</div>
          <div className="text-xs text-text-secondary">{state}</div>
        </div>
        <div className={`text-xs font-mono font-bold tabular-nums shrink-0 ${full ? 'text-brand' : 'text-text-secondary'}`}>
          {active}/{max}
        </div>
      </div>

      {/* Utilization bar */}
      <div className="h-1.5 bg-surface-4 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            full ? 'bg-brand' : pct > 66 ? 'bg-accent-amber' : 'bg-accent-green'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {agent.shift && (
        <div className="text-[10px] text-text-muted">{agent.shift}</div>
      )}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg px-4 py-3.5">
      <div className={`text-lg font-bold font-inter-nums ${accent ? 'text-brand' : 'text-text-primary'}`}>{value}</div>
      <div className="text-[10px] text-text-muted mt-0.5 uppercase tracking-wide">{label}</div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function SupervisorDashboard() {
  const [agents, setAgents]     = useState<Agent[]>([]);
  const [queues, setQueues]     = useState<QueueItem[]>([]);
  const [slaRisk, setSlaRisk]   = useState<SLARiskTicket[]>([]);
  const [stats, setStats]       = useState<SupervisorStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api.getSupervisorLive();
      setAgents(data.agents ?? []);
      setQueues(data.queues ?? []);
      setSlaRisk(data.sla_risk ?? []);
      setStats(data.stats ?? null);
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

  const totalActive = agents.reduce((s, a) => s + (a.active_chats ?? a.active_conversation_count ?? 0), 0);
  const totalCap    = agents.reduce((s, a) => s + (a.max_chats ?? a.max_capacity ?? 3), 0);
  const teamUtil    = totalCap ? Math.round((totalActive / totalCap) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto bg-surface-0">
      <div className="max-w-7xl mx-auto p-6 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Supervisor</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              Live agent status and queue overview
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-text-muted">
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
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

        {/* Stats row */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => <KpiCardSkeleton key={i} />)}
          </div>
        ) : stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <StatCard label="Opened Today"    value={String(stats.opened_today ?? '—')} />
            <StatCard label="Resolved Today"  value={String(stats.resolved_today ?? '—')} />
            <StatCard label="Avg First Reply" value={fmtSeconds(stats.avg_first_response_s ?? stats.avg_first_response_seconds)} />
            <StatCard label="Avg Resolution"  value={fmtSeconds(stats.avg_resolution_seconds)} />
            <StatCard label="CSAT Avg"        value={stats.csat_avg != null ? `${Number(stats.csat_avg).toFixed(1)}★` : '—'} />
            <StatCard label="Bot Active"      value={String(stats.bot_active ?? stats.bot_active_count ?? '—')} />
            <StatCard label="Queue Depth"     value={String(stats.queue_depth ?? '—')} accent={(stats.queue_depth ?? 0) > 10} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Agent grid */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                Agents
              </h3>
              <span className="text-xs text-text-muted">
                Team utilization
                <span className={`ml-1 font-semibold ${teamUtil > 80 ? 'text-brand' : teamUtil > 50 ? 'text-accent-amber' : 'text-accent-green'}`}>
                  {teamUtil}%
                </span>
              </span>
            </div>

            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, i) => <AgentCardSkeleton key={i} />)}
              </div>
            ) : agents.length === 0 ? (
              <EmptyState title="No agents online" />
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {agents.map(a => <AgentCard key={a.id} agent={a} />)}
              </div>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-4">

            {/* Queue depth */}
            <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-5">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Queue Depth</h3>
              </div>
              {queues.length === 0 ? (
                <EmptyState title="Queue empty" className="py-6" />
              ) : (
                <div className="divide-y divide-surface-5">
                  {queues.map((q, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-2.5 text-xs">
                      <span className="text-text-secondary capitalize">{q.channel}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        q.priority === 1 ? 'bg-brand/10 text-brand' :
                        q.priority === 2 ? 'bg-accent-amber/10 text-accent-amber' :
                        'bg-surface-4 text-text-muted'
                      }`}>{PRIORITY_LABEL[q.priority]}</span>
                      <span className="font-bold text-text-primary font-mono tabular-nums">{q.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SLA at risk */}
            <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-5 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">SLA At Risk</h3>
                {slaRisk.length > 0 && (
                  <span className="text-[10px] font-bold bg-brand/10 text-brand px-1.5 py-0.5 rounded-full">
                    {slaRisk.length}
                  </span>
                )}
              </div>
              {slaRisk.length === 0 ? (
                <EmptyState
                  title="All SLAs healthy"
                  icon={
                    <svg className="w-6 h-6 text-accent-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                  }
                  className="py-6"
                />
              ) : (
                <div className="divide-y divide-surface-5">
                  {slaRisk.map(t => (
                    <div key={t.id} className={`px-4 py-3 ${t.sla_breached ? 'bg-brand/5' : ''}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono text-text-muted">{t.id.slice(0, 10)}…</span>
                        <SLATimer deadline={t.sla_deadline ?? ''} />
                      </div>
                      <div className="text-xs text-text-secondary truncate">
                        {t.customer_name && <span className="font-medium text-text-primary">{t.customer_name} · </span>}
                        {t.assigned_to_name ?? t.assigned_agent_name ?? 'Unassigned'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
