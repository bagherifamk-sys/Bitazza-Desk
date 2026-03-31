import { useState, useEffect, useRef } from 'react';
import type { Agent, AgentRole } from '../types';
import type { AuthUser } from '../App';
import { api } from '../api';
import { Avatar } from './ui/Avatar';
import { Spinner } from './ui/Spinner';

const TABS = ['Agents', 'Roles', 'Tags', 'Canned Responses', 'Assignment Rules', 'SLA Targets', 'Bot Config'] as const;
type Tab = typeof TABS[number];

const TAB_ICONS: Record<Tab, string> = {
  'Agents':           'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  'Roles':            'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
  'Tags':             'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z',
  'Canned Responses': 'M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z',
  'Assignment Rules': 'M4 6h16M4 10h16M4 14h16M4 18h16',
  'SLA Targets':      'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  'Bot Config':       'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H4a2 2 0 01-2-2V5a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2h-1',
};

interface Props { currentUser: AuthUser; }

export default function AdminSettings({ currentUser }: Props) {
  const [tab, setTab] = useState<Tab>('Agents');

  return (
    <div className="flex flex-1 overflow-hidden bg-surface-0">

      {/* Vertical tab sidebar */}
      <div className="w-[200px] shrink-0 border-r border-surface-5 bg-surface-1 py-3">
        <p className="text-[10px] text-text-muted uppercase tracking-wider px-4 mb-3 font-semibold">Settings</p>
        <nav className="space-y-0.5 px-2">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`w-full flex items-center gap-2.5 text-xs px-3 py-2 rounded-md text-left transition-colors ${
                tab === t
                  ? 'bg-brand-subtle text-brand font-medium'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
              }`}
            >
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={TAB_ICONS[t]} />
              </svg>
              {t}
            </button>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-6">
          <div className="mb-6">
            <h2 className="text-lg font-bold text-text-primary">{tab}</h2>
            <p className="text-sm text-text-secondary mt-0.5">
              {tab === 'Agents'           ? 'Manage agent accounts, roles, and capacity.' :
               tab === 'Roles'            ? 'Configure role permissions for dashboard access.' :
               tab === 'Tags'             ? 'Manage global ticket tags available to all agents.' :
               tab === 'Canned Responses' ? 'Pre-written replies for common customer scenarios.' :
               tab === 'Assignment Rules' ? 'Configure routing logic per channel and category.' :
               tab === 'SLA Targets'      ? 'Set SLA response and resolution time targets per tier.' :
               'Configure bot persona, greeting, and fallback behavior.'}
            </p>
          </div>

          {tab === 'Agents'           && <AgentsTab currentUser={currentUser} />}
          {tab === 'Roles'            && <RolesTab currentUser={currentUser} />}
          {tab === 'Tags'             && <TagsTab />}
          {tab === 'Canned Responses' && <CannedResponsesTab />}
          {tab === 'Assignment Rules' && <StubTab label="Assignment Rules" description="Configure round-robin, load-balanced, or skill-based routing per channel and category." />}
          {tab === 'SLA Targets'      && <StubTab label="SLA Targets" description="Set SLA response and resolution time targets per tier: VIP 1 min · EA 3 min · Standard 10 min." />}
          {tab === 'Bot Config'       && <StubTab label="Bot Config" description="Configure bot persona, greeting, fallback message, and business hours. Use AI Studio for flow editing." />}
        </div>
      </div>
    </div>
  );
}

// ── Role ceiling helper ───────────────────────────────────────────────────────

function getAllowedRoles(_callerRole: string, allRoles: AgentRole[]): AgentRole[] {
  return allRoles.filter(r => r.name !== 'super_admin');
}

// ── Agents tab ────────────────────────────────────────────────────────────────

function AgentsTab({ currentUser }: { currentUser: AuthUser }) {
  const [agents, setAgents]             = useState<Agent[]>([]);
  const [roles, setRoles]               = useState<AgentRole[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showAdd, setShowAdd]           = useState(false);
  const [editAgent, setEditAgent]       = useState<Agent | null>(null);
  const [resetAgent, setResetAgent]     = useState<Agent | null>(null);
  const [avatarAgent, setAvatarAgent]   = useState<Agent | null>(null);

  const load = async (inactive = showInactive) => {
    try {
      const [agentData, roleData] = await Promise.all([
        api.getAgents(inactive),
        api.getRoles(),
      ]);
      setAgents(agentData);
      setRoles(roleData.roles ?? roleData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleInactive = () => { const next = !showInactive; setShowInactive(next); load(next); };

  const handleDeactivate = async (a: Agent) => {
    if (!confirm(`Deactivate ${a.name}?`)) return;
    try { await api.deactivateAgent(a.id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleReactivate = async (a: Agent) => {
    try { await api.reactivateAgent(a.id); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-text-muted">
      <Spinner size="sm" /> Loading agents…
    </div>
  );

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
          <div
            onClick={toggleInactive}
            className={`w-8 h-4.5 rounded-full transition-colors cursor-pointer relative ${showInactive ? 'bg-brand' : 'bg-surface-4'}`}
            style={{ height: 18 }}
          >
            <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${showInactive ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </div>
          Show inactive agents
        </label>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-brand hover:bg-brand-dim text-white rounded-md transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
          Add Agent
        </button>
      </div>

      <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-surface-5">
              {['', 'Name', 'Email', 'Role', 'State', 'Chats', 'Skills', 'Actions'].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold text-text-muted uppercase tracking-wide px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-5">
            {agents.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-text-muted">No agents found</td>
              </tr>
            )}
            {agents.map(a => {
              const state    = a.state ?? a.status ?? 'Offline';
              const active   = a.active_chats ?? a.active_conversation_count ?? 0;
              const max      = a.max_chats ?? a.max_capacity ?? 3;
              const isInactive = a.active === false;
              const stateColor = state === 'Available' ? 'bg-accent-green' : state === 'Offline' ? 'bg-text-muted' : 'bg-accent-amber';
              return (
                <tr key={a.id} className={`transition-colors ${isInactive ? 'opacity-50' : 'hover:bg-surface-3'}`}>
                  <td className="px-3 py-2.5">
                    <button onClick={() => setAvatarAgent(a)} className="relative group" title="Change avatar">
                      <Avatar name={a.name} size="sm" src={a.avatar_url ?? undefined} />
                      <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-text-primary">{a.name}</span>
                      {isInactive && <span className="text-[9px] bg-brand/10 text-brand px-1.5 py-0.5 rounded-full">Inactive</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-text-secondary">{a.email ?? '—'}</td>
                  <td className="px-3 py-2.5 text-text-secondary capitalize">{a.role ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${stateColor}`} />
                      <span className="text-text-secondary">{state}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-text-secondary tabular-nums">{active}/{max}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {(a.skills ?? []).map(s => (
                        <span key={s} className="text-[9px] bg-surface-4 text-text-muted px-1.5 py-0.5 rounded">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditAgent(a)} className="text-[10px] text-brand hover:text-brand-dim transition-colors">Edit</button>
                      <button onClick={() => setResetAgent(a)} className="text-[10px] text-text-muted hover:text-text-secondary transition-colors">Reset PW</button>
                      {isInactive
                        ? <button onClick={() => handleReactivate(a)} className="text-[10px] text-accent-green hover:opacity-70 transition-opacity">Reactivate</button>
                        : <button onClick={() => handleDeactivate(a)} className="text-[10px] text-brand hover:opacity-70 transition-opacity">Deactivate</button>
                      }
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd    && <AgentModal roles={getAllowedRoles(currentUser.role, roles)} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />}
      {editAgent  && <AgentModal agent={editAgent} roles={getAllowedRoles(currentUser.role, roles)} onClose={() => setEditAgent(null)} onSaved={() => { setEditAgent(null); load(); }} />}
      {resetAgent && <ResetPasswordModal agent={resetAgent} onClose={() => setResetAgent(null)} onSaved={() => setResetAgent(null)} />}
      {avatarAgent && (
        <AvatarModal
          agent={avatarAgent}
          currentUserId={currentUser.id}
          currentUserRole={currentUser.role}
          onClose={() => setAvatarAgent(null)}
          onSaved={(url) => { setAgents(prev => prev.map(a => a.id === avatarAgent.id ? { ...a, avatar_url: url } : a)); setAvatarAgent(null); }}
        />
      )}
    </div>
  );
}

// ── Add / Edit Agent modal ────────────────────────────────────────────────────

function AgentModal({ agent, roles, onClose, onSaved }: { agent?: Agent; roles: AgentRole[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!agent;
  const [form, setForm] = useState({
    name:      agent?.name ?? '',
    email:     agent?.email ?? '',
    password:  '',
    role:      agent?.role ?? (roles[0]?.name ?? 'agent'),
    team:      (agent as Agent & { team?: string })?.team ?? 'cs',
    max_chats: String(agent?.max_chats ?? agent?.max_capacity ?? 3),
    skills:    (agent?.skills ?? []).join(', '),
    shift:     agent?.shift ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!isEdit && !form.email.trim()) { setError('Email is required'); return; }
    if (!isEdit && form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setSaving(true); setError('');
    try {
      const skillsArr = form.skills.split(',').map(s => s.trim()).filter(Boolean);
      if (isEdit) {
        await api.updateAgent(agent!.id, { name: form.name.trim(), role: form.role, team: form.team, max_chats: parseInt(form.max_chats), skills: skillsArr, shift: form.shift || undefined });
      } else {
        await api.createAgent({ name: form.name.trim(), email: form.email.trim().toLowerCase(), password: form.password, role: form.role, team: form.team, max_chats: parseInt(form.max_chats), skills: skillsArr, shift: form.shift || undefined });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <ModalShell title={isEdit ? 'Edit Agent' : 'Add Agent'} onClose={onClose} width="w-[480px]">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Field label="Name *">
        <AdminInput value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Jane Smith" />
      </Field>
      {!isEdit && (
        <>
          <Field label="Email *">
            <AdminInput type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="jane@bitazza.com" />
          </Field>
          <Field label="Temporary Password *">
            <AdminInput type="password" value={form.password} onChange={v => setForm(f => ({ ...f, password: v }))} placeholder="Min 8 characters" />
          </Field>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role *">
          <AdminSelect value={form.role} onChange={v => setForm(f => ({ ...f, role: v }))} options={roles.map(r => ({ value: r.name, label: r.name + (r.is_preset ? '' : ' (custom)') }))} />
        </Field>
        <Field label="Team">
          <AdminInput value={form.team} onChange={v => setForm(f => ({ ...f, team: v }))} placeholder="cs" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Max Chats (1–20)">
          <AdminInput type="number" value={form.max_chats} onChange={v => setForm(f => ({ ...f, max_chats: v }))} />
        </Field>
        <Field label="Shift">
          <AdminInput value={form.shift} onChange={v => setForm(f => ({ ...f, shift: v }))} placeholder="Morning" />
        </Field>
      </div>
      <Field label="Skills (comma-separated)">
        <AdminInput value={form.skills} onChange={v => setForm(f => ({ ...f, skills: v }))} placeholder="thai, english, kyc" />
      </Field>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} saveLabel={isEdit ? 'Save Changes' : 'Create Agent'} />
    </ModalShell>
  );
}

// ── Reset Password modal ──────────────────────────────────────────────────────

function ResetPasswordModal({ agent, onClose, onSaved }: { agent: Agent; onClose: () => void; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  const save = async () => {
    if (password.length < 8) { setError('Min 8 characters'); return; }
    setSaving(true); setError('');
    try { await api.resetAgentPassword(agent.id, password); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={`Reset Password — ${agent.name}`} onClose={onClose} width="w-80">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Field label="New Password *">
        <AdminInput type="password" value={password} onChange={setPassword} placeholder="Min 8 characters" autoFocus />
      </Field>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} saveLabel="Reset Password" />
    </ModalShell>
  );
}

// ── Avatar modal ──────────────────────────────────────────────────────────────

function AvatarModal({
  agent, currentUserId, currentUserRole, onClose, onSaved,
}: { agent: Agent; currentUserId: string; currentUserRole: string; onClose: () => void; onSaved: (url: string) => void }) {
  const isSelf  = agent.id === currentUserId;
  const isAdmin = ['admin', 'super_admin'].includes(currentUserRole);
  if (!isSelf && !isAdmin) { onClose(); return null; }

  const [preview, setPreview] = useState<string | null>(agent.avatar_url ?? null);
  const [file, setFile]       = useState<File | null>(null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const inputRef              = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => { setFile(f); setPreview(URL.createObjectURL(f)); };

  const save = async () => {
    if (!file) return;
    setSaving(true); setError('');
    try { const { avatar_url } = await api.uploadAvatar(agent.id, file); onSaved(avatar_url); }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={`Avatar — ${agent.name}`} onClose={onClose} width="w-72">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <div className="flex flex-col items-center gap-3 py-2">
        <div
          className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-surface-5 cursor-pointer hover:ring-brand transition-all"
          onClick={() => inputRef.current?.click()}
        >
          {preview
            ? <img src={preview} alt="preview" className="w-full h-full object-cover" />
            : <Avatar name={agent.name} size="lg" />
          }
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <button onClick={() => inputRef.current?.click()}
          className="text-xs bg-surface-3 ring-1 ring-surface-5 px-4 py-1.5 rounded hover:bg-surface-4 transition-colors text-text-secondary">
          Choose Image
        </button>
        <p className="text-[10px] text-text-muted">JPG, PNG, WebP, GIF · max 2 MB</p>
      </div>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} saveLabel="Save Avatar" disabled={!file} />
    </ModalShell>
  );
}

// ── Roles tab ─────────────────────────────────────────────────────────────────

const PERM_LABELS: Record<string, string> = {
  'section.home':        'Dashboard',
  'section.inbox':       'Inbox',
  'section.supervisor':  'Live Monitor',
  'section.analytics':   'Analytics',
  'section.metrics':     'Metrics',
  'section.studio':      'Bot Studio',
  'section.admin':       'Admin Panel',
  'inbox.reply':         'Reply to Customer',
  'inbox.assign':        'Assign Conversations',
  'inbox.close':         'Close Conversations',
  'inbox.claim':         'Claim Conversations',
  'inbox.escalate':      'Escalate to Human',
  'inbox.internal_note': 'Add Internal Note',
  'supervisor.whisper':  'Whisper to Agent',
  'studio.publish':      'Publish Bot Flows',
  'admin.agents':        'Manage Agents',
  'admin.roles':         'Manage Roles',
  'admin.settings':      'Manage Settings',
};

const PERM_GROUPS: { label: string; description: string; perms: string[] }[] = [
  { label: 'Pages',          description: 'Which sections this role can access',        perms: ['section.home','section.inbox','section.supervisor','section.analytics','section.metrics','section.admin','section.studio'] },
  { label: 'Conversations',  description: 'Actions available inside conversations',     perms: ['inbox.reply','inbox.assign','inbox.close','inbox.claim','inbox.escalate','inbox.internal_note'] },
  { label: 'Supervision',    description: 'Real-time team monitoring tools',            perms: ['supervisor.whisper'] },
  { label: 'Bot Studio',     description: 'Build and deploy automated flows',           perms: ['studio.publish'] },
  { label: 'Administration', description: 'Workspace configuration and user management', perms: ['admin.agents','admin.roles','admin.settings'] },
];

function PermChecklist({ available, selected, onChange }: { available: string[]; selected: string[]; onChange: (p: string[]) => void }) {
  const toggle = (p: string) => onChange(selected.includes(p) ? selected.filter(x => x !== p) : [...selected, p]);

  return (
    <div className="space-y-5">
      {PERM_GROUPS.map(g => {
        const visible = g.perms.filter(p => available.includes(p));
        if (!visible.length) return null;
        return (
          <div key={g.label}>
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider">{g.label}</p>
              <p className="text-[10px] text-text-muted mt-0.5">{g.description}</p>
            </div>
            <div className="space-y-0.5">
              {visible.map(p => {
                const checked = selected.includes(p);
                return (
                  <label key={p} className={`flex items-center gap-3 px-3 py-2 cursor-pointer rounded-md transition-colors ${checked ? 'bg-brand-subtle' : 'hover:bg-surface-3'}`}>
                    <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ring-1 ${
                      checked ? 'bg-brand ring-brand' : 'bg-surface-2 ring-surface-5'
                    }`}>
                      {checked && (
                        <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <input type="checkbox" checked={checked} onChange={() => toggle(p)} className="sr-only" />
                    <span className={`text-xs leading-none ${checked ? 'text-text-primary' : 'text-text-secondary'}`}>{PERM_LABELS[p] ?? p}</span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoleModal({ role, allPermissions, onSave, onClose }: { role?: AgentRole; allPermissions: string[]; onSave: (data: { name: string; display_name: string; permissions: string[] }) => Promise<void>; onClose: () => void }) {
  const [name, setName]           = useState(role?.name ?? '');
  const [displayName, setDisplay] = useState(role?.display_name ?? '');
  const [perms, setPerms]         = useState<string[]>(role?.permissions ?? []);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const save = async () => {
    const n = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!n) { setError('Role name is required'); return; }
    setSaving(true); setError('');
    try { await onSave({ name: n, display_name: displayName.trim(), permissions: perms }); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title={role ? `Edit role: ${role.name}` : 'Create role'} onClose={onClose} width="w-[440px]">
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <Field label="Role name (snake_case)">
        <AdminInput value={name} onChange={setName} placeholder="e.g. opt_agent" />
      </Field>
      <Field label="Display name (optional)">
        <AdminInput value={displayName} onChange={setDisplay} placeholder="e.g. Operations Agent" />
      </Field>
      <Field label="Permissions">
        <PermChecklist available={allPermissions} selected={perms} onChange={setPerms} />
      </Field>
      <ModalFooter onClose={onClose} onSave={save} saving={saving} saveLabel={role ? 'Save Changes' : 'Create Role'} />
    </ModalShell>
  );
}

function RolesTab({ currentUser: _ }: { currentUser: AuthUser }) {
  const [roles, setRoles]           = useState<AgentRole[]>([]);
  const [allPerms, setAllPerms]     = useState<string[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]       = useState<AgentRole | null>(null);
  const [expanded, setExpanded]     = useState<string | null>(null);

  const load = async () => {
    try {
      const { roles: r, all_permissions } = await api.getRoles();
      setRoles(r); setAllPerms(all_permissions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (data: { name: string; display_name: string; permissions: string[] }) => {
    await api.createRole({ name: data.name, display_name: data.display_name || undefined, permissions: data.permissions });
    load();
  };

  const handleEdit = async (data: { name: string; display_name: string; permissions: string[] }) => {
    if (!editing) return;
    await api.updateRole(editing.name, { name: data.name !== editing.name ? data.name : undefined, display_name: data.display_name || undefined, permissions: data.permissions });
    load();
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete role "${name}"? This cannot be undone.`)) return;
    try { await api.deleteRole(name); load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to delete'); }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-text-muted"><Spinner size="sm" /> Loading roles…</div>;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="flex justify-end">
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-brand hover:bg-brand-dim text-white rounded-md transition-colors">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
          Create Role
        </button>
      </div>

      <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-surface-5">
              {['Role', 'Display Name', 'Type', 'Permissions', ''].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-5">
            {roles.map(r => (
              <>
                <tr key={r.name} className="hover:bg-surface-3 transition-colors">
                  <td className="px-4 py-2.5 font-mono font-medium text-text-primary">{r.name}</td>
                  <td className="px-4 py-2.5 text-text-secondary">{r.display_name ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
                      r.is_preset ? 'bg-brand/10 text-brand' : 'bg-surface-4 text-text-muted'
                    }`}>
                      {r.is_preset ? 'Preset' : 'Custom'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => setExpanded(expanded === r.name ? null : r.name)}
                      className="text-[10px] text-brand hover:text-brand-dim transition-colors"
                    >
                      {r.permissions?.length ?? 0} {(r.permissions?.length ?? 0) === 1 ? 'permission' : 'permissions'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {!r.is_preset && <button onClick={() => setEditing(r)} className="text-[10px] text-brand hover:text-brand-dim transition-colors">Edit</button>}
                      {!r.is_preset && <button onClick={() => remove(r.name)} className="text-[10px] text-text-muted hover:text-brand transition-colors">Delete</button>}
                    </div>
                  </td>
                </tr>
                {expanded === r.name && (
                  <tr key={`${r.name}-exp`}>
                    <td colSpan={5} className="px-6 py-4 bg-surface-3">
                      {(r.permissions?.length ?? 0) === 0 ? (
                        <span className="text-xs text-text-muted italic">No permissions assigned</span>
                      ) : (
                        <div className="space-y-3">
                          {PERM_GROUPS.map(g => {
                            const active = g.perms.filter(p => r.permissions!.includes(p));
                            if (!active.length) return null;
                            return (
                              <div key={g.label}>
                                <p className="text-[9px] font-semibold text-text-muted uppercase tracking-wider mb-1.5">{g.label}</p>
                                <div className="flex flex-wrap gap-1">
                                  {active.map(p => (
                                    <span key={p} className="text-[10px] px-2 py-0.5 bg-surface-2 ring-1 ring-surface-5 rounded text-text-secondary">
                                      {PERM_LABELS[p] ?? p}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && <RoleModal allPermissions={allPerms} onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      {editing    && <RoleModal role={editing} allPermissions={allPerms} onSave={handleEdit} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── Tags tab ──────────────────────────────────────────────────────────────────

function TagsTab() {
  const [tags, setTags]     = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  useEffect(() => { api.getTags().then(setTags).catch(() => {}); }, []);

  const add = async () => {
    const t = newTag.trim().toLowerCase().replace(/\s+/g, '_');
    if (!t || tags.includes(t)) return;
    setNewTag('');
    const updated = await api.createTag(t).catch(() => null);
    if (updated) setTags(updated);
  };
  const remove = async (tag: string) => {
    const updated = await api.deleteTag(tag).catch(() => null);
    if (updated) setTags(updated);
  };

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-4 space-y-4">
        <div className="flex gap-2">
          <input
            value={newTag}
            onChange={e => setNewTag(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="New tag (e.g. billing, urgent)…"
            className={ADMIN_INPUT}
          />
          <button onClick={add} className="text-xs px-4 py-1.5 bg-brand hover:bg-brand-dim text-white rounded-md transition-colors whitespace-nowrap">
            Add Tag
          </button>
        </div>

        {tags.length === 0
          ? <p className="text-sm text-text-muted">No tags yet. Add your first tag above.</p>
          : (
            <div className="flex flex-wrap gap-2">
              {tags.map(t => (
                <span key={t} className="flex items-center gap-1.5 text-xs bg-surface-3 ring-1 ring-surface-5 text-text-secondary px-2.5 py-1 rounded-full">
                  {t}
                  <button onClick={() => remove(t)} className="text-text-muted hover:text-brand transition-colors leading-none">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )
        }
      </div>
    </div>
  );
}

// ── Canned Responses tab ──────────────────────────────────────────────────────

type CannedItem = { id: string; title: string; shortcut: string; body: string; scope: string };

function CannedResponsesTab() {
  const [items, setItems]     = useState<CannedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [form, setForm]       = useState({ title: '', shortcut: '', body: '', scope: 'shared' });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    api.getCannedResponses()
      .then(setItems)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!form.title.trim() || !form.shortcut.trim() || !form.body.trim()) { setError('Title, shortcut and body are all required'); return; }
    setSaving(true); setError('');
    try {
      const created = await api.createCannedResponse(form) as CannedItem;
      setItems(prev => [...prev, created]);
      setForm({ title: '', shortcut: '', body: '', scope: 'shared' });
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const remove = async (id: string) => {
    try { await api.deleteCannedResponse(id); setItems(prev => prev.filter(i => i.id !== id)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="flex justify-end">
        <button
          onClick={() => { setAdding(v => !v); setError(''); }}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
            adding ? 'bg-surface-3 ring-1 ring-surface-5 text-text-secondary' : 'bg-brand hover:bg-brand-dim text-white'
          }`}
        >
          {adding ? 'Cancel' : <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>New Canned Response</>}
        </button>
      </div>

      {adding && (
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-4 space-y-3 animate-slide-in-up">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title *">
              <AdminInput value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="e.g. Greeting" />
            </Field>
            <Field label="Shortcut * (no spaces)">
              <AdminInput value={form.shortcut} onChange={v => setForm(f => ({ ...f, shortcut: v.replace(/\s/g, '-') }))} placeholder="e.g. greeting" className="font-mono" />
            </Field>
          </div>
          <Field label="Body * — variables: {{customer_name}} {{ticket_id}} {{agent_name}}">
            <textarea
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Hello {{customer_name}}, thank you for contacting Bitazza support…"
              className={`w-full text-xs bg-surface-3 ring-1 ring-surface-5 rounded px-3 py-2 resize-none outline-none focus:ring-brand transition-all text-text-primary placeholder:text-text-muted`}
              rows={4}
            />
          </Field>
          <div className="flex items-center gap-3">
            <Field label="Scope">
              <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
                className="text-xs bg-surface-3 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary outline-none focus:ring-brand">
                <option value="shared">Shared (team-wide)</option>
                <option value="personal">Personal</option>
              </select>
            </Field>
            <button onClick={save} disabled={saving}
              className="mt-4 text-xs px-4 py-1.5 bg-brand hover:bg-brand-dim text-white rounded-md transition-colors disabled:opacity-40 flex items-center gap-1.5">
              {saving ? <><Spinner size="xs" /> Saving…</> : 'Save'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted"><Spinner size="sm" /> Loading…</div>
      ) : (
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-5">
                {['Title', 'Shortcut', 'Preview', 'Scope', ''].map((h, i) => (
                  <th key={i} className="text-left text-[10px] font-semibold text-text-muted uppercase tracking-wide px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-5">
              {items.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-6 text-sm text-text-muted text-center">No canned responses yet</td></tr>
              )}
              {items.map(item => (
                <>
                  <tr key={item.id} className="hover:bg-surface-3 transition-colors cursor-pointer" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                    <td className="px-4 py-2.5 font-medium text-text-primary">{item.title}</td>
                    <td className="px-4 py-2.5 font-mono text-brand">/{item.shortcut}</td>
                    <td className="px-4 py-2.5 text-text-secondary max-w-[200px] truncate">{item.body}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
                        item.scope === 'shared' ? 'bg-brand/10 text-brand' : 'bg-surface-4 text-text-muted'
                      }`}>{item.scope}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={e => { e.stopPropagation(); remove(item.id); }}
                        className="text-[10px] text-text-muted hover:text-brand transition-colors">Delete</button>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr key={`${item.id}-exp`}>
                      <td colSpan={5} className="px-4 py-3 bg-surface-3">
                        <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">Full body</p>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap">{item.body}</p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Stub tab ──────────────────────────────────────────────────────────────────

function StubTab({ label, description }: { label: string; description: string }) {
  return (
    <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg p-8 text-center">
      <div className="w-10 h-10 rounded-full bg-surface-3 ring-1 ring-surface-5 flex items-center justify-center mx-auto mb-3">
        <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-text-primary mb-1.5">{label}</h3>
      <p className="text-xs text-text-secondary max-w-sm mx-auto">{description}</p>
      <p className="text-[10px] text-text-muted mt-3">Coming in Phase 4</p>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const ADMIN_INPUT = 'w-full text-xs bg-surface-3 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary placeholder:text-text-muted outline-none focus:ring-brand transition-all';

function AdminInput({ value, onChange, placeholder, type = 'text', autoFocus, className = '' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; autoFocus?: boolean; className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={`${ADMIN_INPUT} ${className}`}
    />
  );
}

function AdminSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={ADMIN_INPUT}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium">{label}</label>
      {children}
    </div>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 bg-brand/10 ring-1 ring-brand/20 text-brand text-xs px-3 py-2.5 rounded-lg">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
      </svg>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, children, width = 'w-[480px]' }: { title: string; onClose: () => void; children: React.ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className={`bg-surface-2 ring-1 ring-surface-5 rounded-xl ${width} max-h-[90vh] flex flex-col shadow-modal animate-scale-in`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-5 shrink-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors p-1 hover:bg-surface-3 rounded">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function ModalFooter({ onClose, onSave, saving, saveLabel, disabled = false }: { onClose: () => void; onSave: () => void; saving: boolean; saveLabel: string; disabled?: boolean }) {
  return (
    <div className="flex justify-end gap-2 pt-2 border-t border-surface-5 mt-2">
      <button onClick={onClose} className="text-xs px-4 py-1.5 bg-surface-3 ring-1 ring-surface-5 rounded-md text-text-secondary hover:text-text-primary hover:bg-surface-4 transition-colors">
        Cancel
      </button>
      <button
        onClick={onSave}
        disabled={saving || disabled}
        className="text-xs px-4 py-1.5 bg-brand hover:bg-brand-dim text-white rounded-md transition-colors disabled:opacity-40 flex items-center gap-1.5"
      >
        {saving ? <><Spinner size="xs" /> Saving…</> : saveLabel}
      </button>
    </div>
  );
}
