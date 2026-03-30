import { useState, useEffect, useCallback } from 'react';
import type { Agent, QueueItem, SLARiskTicket, SupervisorStats } from '../types';
import { api } from '../api';

// State → dot color (only red for Offline/critical, else black/gray per spec)
const STATE_DOT: Record<string, string> = {
  Available: 'bg-[#2E7D32]',
  Busy:      'bg-[#333]',
  Break:     'bg-[#999]',
  Offline:   'bg-[#D32F2F]',
};

const PRIORITY_LABEL: Record<string | number, string> = { 1: 'VIP', 2: 'EA', 3: 'Std' };

function fmtSeconds(s: number | string | null | undefined): string {
  const n = Number(s);
  if (!n || isNaN(n)) return '—';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
}

function SLACountdown({ deadline }: { deadline?: string }) {
  const [display, setDisplay] = useState('');
  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      const diff = new Date(deadline).getTime() - Date.now();
      if (diff <= 0) { setDisplay('BREACHED'); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setDisplay(`${m}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  if (!deadline) return null;
  const breached = display === 'BREACHED';
  const soon = !breached && parseInt(display) < 30;
  return (
    <span className={`font-mono text-xs font-bold ${breached || soon ? 'text-[#D32F2F]' : 'text-[#E65100]'}`}>
      {display}
    </span>
  );
}

export default function SupervisorDashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [queues, setQueues] = useState<QueueItem[]>([]);
  const [slaRisk, setSlaRisk] = useState<SLARiskTicket[]>([]);
  const [stats, setStats] = useState<SupervisorStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-[#999] text-sm">Loading…</div>
  );

  const totalActive = agents.reduce((s, a) => s + (a.active_chats ?? a.active_conversation_count ?? 0), 0);
  const totalCap    = agents.reduce((s, a) => s + (a.max_chats ?? a.max_capacity ?? 3), 0);
  const teamUtil    = totalCap ? Math.round((totalActive / totalCap) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">

      {/* Header */}
      <div className="flex items-center justify-between mb-6 border-b border-[#EAEAEA] pb-4">
        <h2 className="text-sm font-bold text-[#000] uppercase tracking-wide">Supervisor Dashboard</h2>
        <div className="flex items-center gap-3 text-xs text-[#999]">
          {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString()}</span>}
          <button onClick={load} className="text-[#000] hover:underline">↻ Refresh</button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>
      )}

      {/* KPI row */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          <StatCard label="Opened Today"     value={String(stats.opened_today ?? '—')} />
          <StatCard label="Resolved Today"   value={String(stats.resolved_today ?? '—')} />
          <StatCard label="Avg First Reply"  value={fmtSeconds(stats.avg_first_response_s ?? stats.avg_first_response_seconds)} />
          <StatCard label="Avg Resolution"   value={fmtSeconds(stats.avg_resolution_seconds)} />
          <StatCard label="CSAT Avg"         value={stats.csat_avg != null ? `${Number(stats.csat_avg).toFixed(1)} ★` : '—'} />
          <StatCard label="Bot Active"       value={String(stats.bot_active ?? stats.bot_active_count ?? '—')} />
          <StatCard label="Queue Depth"      value={String(stats.queue_depth ?? '—')} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Agent grid */}
        <div className="lg:col-span-2">
          <h3 className="text-xs font-semibold text-[#999] uppercase tracking-wide mb-3">
            Agents
            <span className="text-[#333] font-normal ml-2">· Team utilization {teamUtil}%</span>
          </h3>
          {agents.length === 0 && (
            <p className="text-xs text-[#999]">No agents found</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {agents.map(a => {
              const active = a.active_chats ?? a.active_conversation_count ?? 0;
              const max    = a.max_chats ?? a.max_capacity ?? 3;
              const state  = a.state ?? a.status ?? 'Offline';
              const full   = active >= max;
              return (
                <div key={a.id} className="border border-[#EAEAEA] px-3 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATE_DOT[state] ?? 'bg-[#999]'}`} />
                    <span className="text-xs font-medium text-[#000] truncate">{a.name}</span>
                  </div>
                  <div className="text-[10px] text-[#999] mb-1">{state}</div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className={full ? 'text-[#D32F2F] font-semibold' : 'text-[#333]'}>
                      {active}/{max} chats
                    </span>
                    <span className="text-[#999]">{a.shift ?? ''}</span>
                  </div>
                  {/* Utilization bar */}
                  <div className="mt-2 h-1 bg-[#f0f0f0] overflow-hidden">
                    <div
                      className={`h-full transition-all ${full ? 'bg-[#D32F2F]' : 'bg-[#000]'}`}
                      style={{ width: `${Math.min(100, max ? (active / max) * 100 : 0)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right column: queue + SLA risk */}
        <div className="space-y-4">

          {/* Queue depth */}
          <div className="border border-[#EAEAEA] px-4 py-3">
            <h3 className="text-xs font-semibold text-[#999] uppercase tracking-wide mb-3">Queue Depth</h3>
            {queues.length === 0
              ? <p className="text-xs text-[#999]">Queue empty</p>
              : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[#999] border-b border-[#EAEAEA]">
                      <th className="text-left pb-1 font-medium">Channel</th>
                      <th className="text-left pb-1 font-medium">Priority</th>
                      <th className="text-right pb-1 font-medium">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queues.map((q, i) => (
                      <tr key={i} className="border-b border-[#f5f5f5] last:border-0">
                        <td className="py-1 text-[#333] capitalize">{q.channel}</td>
                        <td className="py-1 text-[#333]">{PRIORITY_LABEL[q.priority] ?? q.priority}</td>
                        <td className="py-1 text-right font-semibold text-[#000]">{q.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            }
          </div>

          {/* SLA at risk */}
          <div className="border border-[#EAEAEA] px-4 py-3">
            <h3 className="text-xs font-semibold text-[#999] uppercase tracking-wide mb-3">SLA At Risk</h3>
            {slaRisk.length === 0
              ? <p className="text-xs text-[#999]">No tickets at risk</p>
              : slaRisk.map(t => {
                  const breached = t.sla_breached;
                  return (
                    <div
                      key={t.id}
                      className={`mb-2 p-2 border text-xs ${
                        breached ? 'border-[#D32F2F] bg-[#ffebee]' : 'border-[#E65100]/30 bg-[#fff3e0]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-[#666]">{t.id.slice(0, 8)}…</span>
                        <SLACountdown deadline={t.sla_deadline} />
                      </div>
                      <div className="text-[#666] mt-0.5">
                        {t.assigned_to_name ?? t.assigned_agent_name ?? 'Unassigned'}
                        {' · '}
                        {t.tier ?? t.customer_tier ?? '—'}
                        {t.customer_name && ` · ${t.customer_name}`}
                      </div>
                    </div>
                  );
                })
            }
          </div>

        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#EAEAEA] px-3 py-3">
      <div className="text-base font-bold text-[#000]">{value}</div>
      <div className="text-[10px] text-[#999] mt-0.5 uppercase tracking-wide">{label}</div>
    </div>
  );
}
