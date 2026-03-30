import { useState, useEffect, useRef } from 'react';
import type { Agent, AgentRole } from '../types';
import type { AuthUser } from '../App';
import { api } from '../api';

const TABS = ['Agents', 'Roles', 'Tags', 'Canned Responses', 'Assignment Rules', 'SLA Targets', 'Bot Config'] as const;
type Tab = typeof TABS[number];

interface Props { currentUser: AuthUser; }

export default function AdminSettings({ currentUser }: Props) {
  const [tab, setTab] = useState<Tab>('Agents');

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-white">
      <div className="flex items-center justify-between mb-4 border-b border-[#EAEAEA] pb-4">
        <h2 className="text-sm font-bold text-[#000] uppercase tracking-wide">Admin Settings</h2>
      </div>

      <div className="flex gap-0 mb-5 border-b border-[#EAEAEA]">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-xs px-4 py-2 border-b-2 whitespace-nowrap transition-colors ${
              tab === t
                ? 'border-[#000] text-[#000] font-semibold'
                : 'border-transparent text-[#999] hover:text-[#333]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Agents'           && <AgentsTab currentUser={currentUser} />}
      {tab === 'Roles'            && <RolesTab currentUser={currentUser} />}
      {tab === 'Tags'             && <TagsTab />}
      {tab === 'Canned Responses' && <CannedResponsesTab />}
      {tab === 'Assignment Rules' && <StubTab label="Assignment Rules" description="Configure round-robin, load-balanced, or skill-based routing per channel and category." />}
      {tab === 'SLA Targets'      && <StubTab label="SLA Targets" description="Set SLA response and resolution time targets per tier: VIP 1 min · EA 3 min · Standard 10 min." />}
      {tab === 'Bot Config'       && <StubTab label="Bot Config" description="Configure bot persona, greeting, fallback message, and business hours. Use AI Studio for flow editing." />}
    </div>
  );
}

// ── Avatar component ──────────────────────────────────────────────────────────

function Avatar({ name, avatarUrl, size = 28 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        style={{ width: size, height: size }}
        className="rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="rounded-full bg-[#E63946] text-white font-bold flex items-center justify-center shrink-0"
    >
      {initials}
    </div>
  );
}

// ── Role ceiling helper ───────────────────────────────────────────────────────

function getAllowedRoles(callerRole: string, allRoles: AgentRole[]): AgentRole[] {
  if (callerRole === 'super_admin') return allRoles.filter(r => r.name !== 'super_admin');
  // admin: all except super_admin
  return allRoles.filter(r => r.name !== 'super_admin');
}

// ── Agents tab ────────────────────────────────────────────────────────────────

function AgentsTab({ currentUser }: { currentUser: AuthUser }) {
  const [agents, setAgents]           = useState<Agent[]>([]);
  const [roles, setRoles]             = useState<AgentRole[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showAdd, setShowAdd]         = useState(false);
  const [editAgent, setEditAgent]     = useState<Agent | null>(null);
  const [resetAgent, setResetAgent]   = useState<Agent | null>(null);
  const [avatarAgent, setAvatarAgent] = useState<Agent | null>(null);

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

  const toggleInactive = () => {
    const next = !showInactive;
    setShowInactive(next);
    load(next);
  };

  const handleDeactivate = async (a: Agent) => {
    if (!confirm(`Deactivate ${a.name}?`)) return;
    try {
      await api.deactivateAgent(a.id);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  const handleReactivate = async (a: Agent) => {
    try {
      await api.reactivateAgent(a.id);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
  };

  if (loading) return <p className="text-xs text-[#999]">Loading…</p>;

  return (
    <div className="space-y-3">
      {error && <div className="px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>}

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-[#666] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={toggleInactive}
            className="accent-[#000]"
          />
          Show inactive agents
        </label>
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs px-4 py-1.5 bg-[#000] text-white hover:bg-[#333] transition-colors"
        >
          + Add Agent
        </button>
      </div>

      <div className="border border-[#EAEAEA] overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[#fafafa] border-b border-[#EAEAEA]">
            <tr>
              {['', 'Name', 'Email', 'Role', 'State', 'Chats', 'Skills', 'Shift', 'Actions'].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wide px-3 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f5f5f5]">
            {agents.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-4 text-[#999] text-center">No agents found</td></tr>
            )}
            {agents.map(a => {
              const state  = a.state ?? a.status ?? 'Offline';
              const active = a.active_chats ?? a.active_conversation_count ?? 0;
              const max    = a.max_chats ?? a.max_capacity ?? 3;
              const isInactive = a.active === false;
              return (
                <tr key={a.id} className={`transition-colors ${isInactive ? 'opacity-50 bg-[#fafafa]' : 'hover:bg-[#fafafa]'}`}>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => setAvatarAgent(a)}
                      title="Change avatar"
                      className="relative group"
                    >
                      <Avatar name={a.name} avatarUrl={a.avatar_url} size={28} />
                      <span className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-[#000]">
                    {a.name}
                    {isInactive && <span className="ml-1.5 text-[9px] border border-[#D32F2F] text-[#D32F2F] px-1 py-0.5">Inactive</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[#666]">{a.email ?? '—'}</td>
                  <td className="px-3 py-2.5 text-[#666]">{a.role ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-2 py-0.5 border ${
                      state === 'Available' ? 'border-[#2E7D32] text-[#2E7D32]'
                      : state === 'Offline'  ? 'border-[#D32F2F] text-[#D32F2F]'
                      : 'border-[#CCC] text-[#666]'
                    }`}>{state}</span>
                  </td>
                  <td className="px-3 py-2.5 text-[#333]">{active}/{max}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1 flex-wrap">
                      {(a.skills ?? []).map(s => (
                        <span key={s} className="text-[9px] bg-[#f5f5f5] text-[#666] px-1.5 py-0.5">{s}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-[#999]">{a.shift ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditAgent(a)}
                        className="text-[10px] text-[#333] hover:text-[#000] underline transition-colors"
                      >Edit</button>
                      <button
                        onClick={() => setResetAgent(a)}
                        className="text-[10px] text-[#666] hover:text-[#000] underline transition-colors"
                      >Reset PW</button>
                      {isInactive
                        ? <button onClick={() => handleReactivate(a)} className="text-[10px] text-[#2E7D32] hover:text-[#1b5e20] underline transition-colors">Reactivate</button>
                        : <button onClick={() => handleDeactivate(a)} className="text-[10px] text-[#D32F2F] hover:text-[#b71c1c] underline transition-colors">Deactivate</button>
                      }
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AgentModal
          roles={getAllowedRoles(currentUser.role, roles)}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}

      {editAgent && (
        <AgentModal
          agent={editAgent}
          roles={getAllowedRoles(currentUser.role, roles)}
          onClose={() => setEditAgent(null)}
          onSaved={() => { setEditAgent(null); load(); }}
        />
      )}

      {resetAgent && (
        <ResetPasswordModal
          agent={resetAgent}
          onClose={() => setResetAgent(null)}
          onSaved={() => setResetAgent(null)}
        />
      )}

      {avatarAgent && (
        <AvatarModal
          agent={avatarAgent}
          currentUserId={currentUser.id}
          currentUserRole={currentUser.role}
          onClose={() => setAvatarAgent(null)}
          onSaved={(url) => {
            setAgents(prev => prev.map(a => a.id === avatarAgent.id ? { ...a, avatar_url: url } : a));
            setAvatarAgent(null);
          }}
        />
      )}
    </div>
  );
}

// ── Add / Edit Agent modal ─────────────────────────────────────────────────────

interface AgentModalProps {
  agent?: Agent;
  roles: AgentRole[];
  onClose: () => void;
  onSaved: () => void;
}

function AgentModal({ agent, roles, onClose, onSaved }: AgentModalProps) {
  const isEdit = !!agent;
  const [form, setForm] = useState({
    name:      agent?.name ?? '',
    email:     agent?.email ?? '',
    password:  '',
    role:      agent?.role ?? (roles[0]?.name ?? 'agent'),
    team:      agent?.team ?? 'cs',
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
        await api.updateAgent(agent!.id, {
          name:      form.name.trim(),
          role:      form.role,
          team:      form.team,
          max_chats: parseInt(form.max_chats),
          skills:    skillsArr,
          shift:     form.shift || undefined,
        });
      } else {
        await api.createAgent({
          name:      form.name.trim(),
          email:     form.email.trim().toLowerCase(),
          password:  form.password,
          role:      form.role,
          team:      form.team,
          max_chats: parseInt(form.max_chats),
          skills:    skillsArr,
          shift:     form.shift || undefined,
        });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white border border-[#EAEAEA] w-[480px] max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#EAEAEA]">
          <h3 className="text-sm font-bold text-[#000]">{isEdit ? 'Edit Agent' : 'Add Agent'}</h3>
          <button onClick={onClose} className="text-[#999] hover:text-[#000] transition-colors text-lg leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>}

          <Field label="Name *">
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={INPUT} placeholder="Jane Smith" />
          </Field>

          {!isEdit && (
            <>
              <Field label="Email *">
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className={INPUT} placeholder="jane@bitazza.com" />
              </Field>
              <Field label="Temporary Password *">
                <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className={INPUT} placeholder="Min 8 characters" />
              </Field>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Role *">
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                className={INPUT}>
                {roles.map(r => (
                  <option key={r.name} value={r.name}>
                    {r.name}{r.is_preset ? '' : ' (custom)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team">
              <input value={form.team} onChange={e => setForm(f => ({ ...f, team: e.target.value }))}
                className={INPUT} placeholder="cs" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Max Chats (1–20)">
              <input type="number" min={1} max={20} value={form.max_chats}
                onChange={e => setForm(f => ({ ...f, max_chats: e.target.value }))}
                className={INPUT} />
            </Field>
            <Field label="Shift">
              <input value={form.shift} onChange={e => setForm(f => ({ ...f, shift: e.target.value }))}
                className={INPUT} placeholder="e.g. Morning" />
            </Field>
          </div>

          <Field label="Skills (comma-separated)">
            <input value={form.skills} onChange={e => setForm(f => ({ ...f, skills: e.target.value }))}
              className={INPUT} placeholder="thai, english, kyc" />
          </Field>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#EAEAEA]">
          <button onClick={onClose}
            className="text-xs px-4 py-1.5 border border-[#CCC] text-[#333] hover:bg-[#f5f5f5] transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="text-xs px-5 py-1.5 bg-[#000] text-white hover:bg-[#333] transition-colors disabled:opacity-40">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Agent'}
          </button>
        </div>
      </div>
    </div>
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
    try {
      await api.resetAgentPassword(agent.id, password);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white border border-[#EAEAEA] w-80 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#EAEAEA]">
          <h3 className="text-sm font-bold text-[#000]">Reset Password — {agent.name}</h3>
          <button onClick={onClose} className="text-[#999] hover:text-[#000] transition-colors text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>}
          <Field label="New Password *">
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              className={INPUT} placeholder="Min 8 characters" autoFocus />
          </Field>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#EAEAEA]">
          <button onClick={onClose}
            className="text-xs px-4 py-1.5 border border-[#CCC] text-[#333] hover:bg-[#f5f5f5] transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="text-xs px-5 py-1.5 bg-[#000] text-white hover:bg-[#333] transition-colors disabled:opacity-40">
            {saving ? 'Saving…' : 'Reset Password'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Avatar modal ──────────────────────────────────────────────────────────────

function AvatarModal({
  agent, currentUserId, currentUserRole, onClose, onSaved,
}: {
  agent: Agent;
  currentUserId: string;
  currentUserRole: string;
  onClose: () => void;
  onSaved: (url: string) => void;
}) {
  const isSelf  = agent.id === currentUserId;
  const isAdmin = ['admin', 'super_admin'].includes(currentUserRole);
  if (!isSelf && !isAdmin) { onClose(); return null; }

  const [preview, setPreview] = useState<string | null>(agent.avatar_url ?? null);
  const [file, setFile]       = useState<File | null>(null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const inputRef              = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!file) return;
    setSaving(true); setError('');
    try {
      const { avatar_url } = await api.uploadAvatar(agent.id, file);
      onSaved(avatar_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white border border-[#EAEAEA] w-72 shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#EAEAEA]">
          <h3 className="text-sm font-bold text-[#000]">Avatar — {agent.name}</h3>
          <button onClick={onClose} className="text-[#999] hover:text-[#000] transition-colors text-lg leading-none">×</button>
        </div>
        <div className="p-5 flex flex-col items-center gap-4">
          {error && <div className="w-full px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>}
          <div
            className="w-20 h-20 rounded-full overflow-hidden border-2 border-[#EAEAEA] cursor-pointer"
            onClick={() => inputRef.current?.click()}
          >
            {preview
              ? <img src={preview} alt="preview" className="w-full h-full object-cover" />
              : <Avatar name={agent.name} avatarUrl={null} size={80} />
            }
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            className="text-xs border border-[#CCC] px-4 py-1.5 text-[#333] hover:bg-[#f5f5f5] transition-colors"
          >
            Choose Image
          </button>
          <p className="text-[10px] text-[#999]">JPG, PNG, WebP, GIF · max 2 MB</p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[#EAEAEA]">
          <button onClick={onClose}
            className="text-xs px-4 py-1.5 border border-[#CCC] text-[#333] hover:bg-[#f5f5f5] transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving || !file}
            className="text-xs px-5 py-1.5 bg-[#000] text-white hover:bg-[#333] transition-colors disabled:opacity-40">
            {saving ? 'Uploading…' : 'Save Avatar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Roles tab ─────────────────────────────────────────────────────────────────

const PERM_LABELS: Record<string, string> = {
  'section.home':          'Dashboard',
  'section.inbox':         'Inbox',
  'section.supervisor':    'Live Monitor',
  'section.analytics':     'Analytics',
  'section.metrics':       'Metrics',
  'section.studio':        'Bot Studio',
  'section.admin':         'Admin Panel',
  'inbox.reply':           'Reply to Customer',
  'inbox.assign':          'Assign Conversations',
  'inbox.close':           'Close Conversations',
  'inbox.claim':           'Claim Conversations',
  'inbox.escalate':        'Escalate to Human',
  'inbox.internal_note':   'Add Internal Note',
  'supervisor.whisper':    'Whisper to Agent',
  'studio.publish':        'Publish Bot Flows',
  'admin.agents':          'Manage Agents',
  'admin.roles':           'Manage Roles',
  'admin.settings':        'Manage Settings',
};

const PERM_GROUPS: { label: string; description: string; perms: string[] }[] = [
  {
    label: 'Pages',
    description: 'Which sections of the dashboard this role can access',
    perms: ['section.home','section.inbox','section.supervisor','section.analytics','section.metrics','section.admin','section.studio'],
  },
  {
    label: 'Conversations',
    description: 'Actions available inside an open conversation',
    perms: ['inbox.reply','inbox.assign','inbox.close','inbox.claim','inbox.escalate','inbox.internal_note'],
  },
  {
    label: 'Supervision',
    description: 'Real-time team monitoring tools',
    perms: ['supervisor.whisper'],
  },
  {
    label: 'Bot Studio',
    description: 'Build and deploy automated flows',
    perms: ['studio.publish'],
  },
  {
    label: 'Administration',
    description: 'Workspace configuration and user management',
    perms: ['admin.agents','admin.roles','admin.settings'],
  },
];

function PermChecklist({
  available, selected, onChange,
}: { available: string[]; selected: string[]; onChange: (p: string[]) => void }) {
  const toggle = (p: string) =>
    onChange(selected.includes(p) ? selected.filter(x => x !== p) : [...selected, p]);

  return (
    <div className="space-y-4">
      {PERM_GROUPS.map(g => {
        const visible = g.perms.filter(p => available.includes(p));
        if (!visible.length) return null;
        return (
          <div key={g.label}>
            <div className="mb-2">
              <p className="text-[10px] font-semibold text-[#111] uppercase tracking-widest">{g.label}</p>
              <p className="text-[10px] text-[#aaa] mt-0.5">{g.description}</p>
            </div>
            <div className="space-y-0.5">
              {visible.map(p => {
                const checked = selected.includes(p);
                return (
                  <label
                    key={p}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors rounded-sm ${
                      checked ? 'bg-[#f5f5f5]' : 'hover:bg-[#fafafa]'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 flex-shrink-0 border flex items-center justify-center transition-colors ${
                      checked ? 'bg-[#000] border-[#000]' : 'bg-white border-[#CCC]'
                    }`}>
                      {checked && (
                        <svg className="w-2 h-2 text-white" viewBox="0 0 10 8" fill="none">
                          <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p)}
                      className="sr-only"
                    />
                    <span className="text-xs text-[#222] leading-none">{PERM_LABELS[p] ?? p}</span>
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

interface RoleModalProps {
  role?: AgentRole;          // undefined = create
  allPermissions: string[];
  onSave: (data: { name: string; display_name: string; permissions: string[] }) => Promise<void>;
  onClose: () => void;
}

function RoleModal({ role, allPermissions, onSave, onClose }: RoleModalProps) {
  const [name, setName]           = useState(role?.name ?? '');
  const [displayName, setDisplay] = useState(role?.display_name ?? '');
  const [perms, setPerms]         = useState<string[]>(role?.permissions ?? []);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const save = async () => {
    const n = name.trim().toLowerCase().replace(/\s+/g, '_');
    if (!n) { setError('Role name is required'); return; }
    setSaving(true); setError('');
    try {
      await onSave({ name: n, display_name: displayName.trim(), permissions: perms });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-[440px] max-h-[90vh] flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-[#EAEAEA]">
          <h2 className="text-sm font-semibold text-[#000]">
            {role ? `Edit role: ${role.name}` : 'Create role'}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <div className="px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>}

          <div>
            <label className="text-[11px] text-[#999] block mb-1">Role name (snake_case)</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. opt_agent"
              className={INPUT}
            />
          </div>
          <div>
            <label className="text-[11px] text-[#999] block mb-1">Display name (optional)</label>
            <input
              value={displayName}
              onChange={e => setDisplay(e.target.value)}
              placeholder="e.g. Operations Agent"
              className={INPUT}
            />
          </div>
          <div>
            <label className="text-[11px] text-[#999] block mb-2">Permissions</label>
            <PermChecklist available={allPermissions} selected={perms} onChange={setPerms} />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#EAEAEA] flex justify-end gap-2">
          <button onClick={onClose}
            className="text-xs px-4 py-1.5 border border-[#CCC] text-[#333] hover:bg-[#f5f5f5] transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="text-xs px-5 py-1.5 bg-[#000] text-white hover:bg-[#333] transition-colors disabled:opacity-40">
            {saving ? 'Saving…' : role ? 'Save Changes' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RolesTab({ currentUser }: { currentUser: AuthUser }) {
  const [roles, setRoles]         = useState<AgentRole[]>([]);
  const [allPerms, setAllPerms]   = useState<string[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]     = useState<AgentRole | null>(null);
  const [expanded, setExpanded]   = useState<string | null>(null);

  const load = async () => {
    try {
      const { roles: r, all_permissions } = await api.getRoles();
      setRoles(r);
      setAllPerms(all_permissions);
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
    await api.updateRole(editing.name, {
      name: data.name !== editing.name ? data.name : undefined,
      display_name: data.display_name || undefined,
      permissions: data.permissions,
    });
    load();
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete role "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteRole(name);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  if (loading) return <p className="text-xs text-[#999]">Loading…</p>;

  return (
    <div className="space-y-4">
      {error && <div className="px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>}

      <div className="flex justify-end">
        <button
          onClick={() => setShowCreate(true)}
          className="text-xs px-4 py-1.5 bg-[#000] text-white hover:bg-[#333] transition-colors"
        >
          + Create Role
        </button>
      </div>

      <div className="border border-[#EAEAEA] overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[#fafafa] border-b border-[#EAEAEA]">
            <tr>
              {['Role', 'Display Name', 'Type', 'Permissions', ''].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wide px-4 py-2.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f5f5f5]">
            {roles.map(r => (
              <>
                <tr key={r.name} className="hover:bg-[#fafafa] transition-colors">
                  <td className="px-4 py-2.5 font-mono font-medium text-[#000]">{r.name}</td>
                  <td className="px-4 py-2.5 text-[#666]">{r.display_name ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[9px] px-2 py-0.5 border ${
                      r.is_preset ? 'border-[#000] text-[#000]' : 'border-[#CCC] text-[#666]'
                    }`}>
                      {r.is_preset ? 'Preset' : 'Custom'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => setExpanded(expanded === r.name ? null : r.name)}
                      className="text-[10px] text-[#666] hover:text-[#000] transition-colors underline-offset-2 hover:underline"
                    >
                      {r.permissions?.length ?? 0} {(r.permissions?.length ?? 0) === 1 ? 'permission' : 'permissions'}
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {!r.is_preset && (
                        <button
                          onClick={() => setEditing(r)}
                          className="text-[10px] text-[#666] hover:text-[#000] transition-colors"
                        >
                          Edit
                        </button>
                      )}
                      {!r.is_preset && (
                        <button
                          onClick={() => remove(r.name)}
                          className="text-[10px] text-[#999] hover:text-[#D32F2F] transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {expanded === r.name && (
                  <tr key={`${r.name}-exp`} className="bg-[#fafafa]">
                    <td colSpan={5} className="px-6 py-4">
                      {(r.permissions?.length ?? 0) === 0 ? (
                        <span className="text-[11px] text-[#bbb] italic">No permissions assigned</span>
                      ) : (
                        <div className="space-y-3">
                          {PERM_GROUPS.map(g => {
                            const active = g.perms.filter(p => r.permissions!.includes(p));
                            if (!active.length) return null;
                            return (
                              <div key={g.label}>
                                <p className="text-[9px] font-semibold text-[#aaa] uppercase tracking-widest mb-1.5">{g.label}</p>
                                <div className="flex flex-wrap gap-1">
                                  {active.map(p => (
                                    <span key={p} className="text-[11px] px-2.5 py-1 bg-white text-[#222] border border-[#E0E0E0] leading-none">
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

      {showCreate && (
        <RoleModal
          allPermissions={allPerms}
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editing && (
        <RoleModal
          role={editing}
          allPermissions={allPerms}
          onSave={handleEdit}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ── Tags tab ──────────────────────────────────────────────────────────────────

function TagsTab() {
  const [tags, setTags]     = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('global_tags');
    if (stored) setTags(JSON.parse(stored));
  }, []);

  const persist = (next: string[]) => {
    setTags(next);
    localStorage.setItem('global_tags', JSON.stringify(next));
  };

  const add = () => {
    const t = newTag.trim().toLowerCase().replace(/\s+/g, '_');
    if (!t || tags.includes(t)) return;
    setSaving(true);
    persist([...tags, t]);
    setNewTag('');
    setSaving(false);
  };

  const remove = (tag: string) => persist(tags.filter(t => t !== tag));

  return (
    <div className="border border-[#EAEAEA] p-4">
      <div className="flex gap-2 mb-4">
        <input
          value={newTag}
          onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="New tag (e.g. billing, urgent)…"
          className={`flex-1 ${INPUT}`}
        />
        <button
          onClick={add}
          disabled={saving}
          className="text-xs px-4 py-1.5 bg-[#000] text-white hover:bg-[#333] transition-colors disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {tags.length === 0 && <p className="text-xs text-[#999]">No tags yet</p>}

      <div className="flex flex-wrap gap-2">
        {tags.map(t => (
          <span key={t} className="flex items-center gap-1.5 text-xs border border-[#CCC] text-[#333] px-2.5 py-1">
            {t}
            <button
              onClick={() => remove(t)}
              className="text-[#999] hover:text-[#D32F2F] transition-colors leading-none"
            >
              ✕
            </button>
          </span>
        ))}
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
    if (!form.title.trim() || !form.shortcut.trim() || !form.body.trim()) {
      setError('Title, shortcut and body are all required');
      return;
    }
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
    try {
      await api.deleteCannedResponse(id);
      setItems(prev => prev.filter(i => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="px-3 py-2 border border-[#D32F2F] text-xs text-[#D32F2F]">{error}</div>}

      <div className="flex justify-end">
        <button
          onClick={() => { setAdding(v => !v); setError(''); }}
          className="text-xs px-4 py-1.5 border border-[#000] text-[#000] hover:bg-[#000] hover:text-white transition-colors"
        >
          {adding ? 'Cancel' : '+ New Canned Response'}
        </button>
      </div>

      {adding && (
        <div className="border border-[#EAEAEA] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">Title *</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Greeting" className={INPUT} />
            </div>
            <div>
              <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">Shortcut * (no spaces)</label>
              <input value={form.shortcut}
                onChange={e => setForm(f => ({ ...f, shortcut: e.target.value.replace(/\s/g, '-') }))}
                placeholder="e.g. greeting" className={`${INPUT} font-mono`} />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">
              Body * — variables: {'{{customer_name}}'} {'{{ticket_id}}'} {'{{agent_name}}'}
            </label>
            <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              placeholder="Hello {{customer_name}}, thank you for contacting Bitazza support…"
              className={`w-full text-xs border border-[#CCC] px-3 py-2 resize-none outline-none focus:border-[#000] transition-colors`}
              rows={4} />
          </div>
          <div className="flex items-center gap-3">
            <div>
              <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">Scope</label>
              <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))}
                className="text-xs border border-[#CCC] px-2 py-1.5 outline-none focus:border-[#000]">
                <option value="shared">Shared (team-wide)</option>
                <option value="personal">Personal</option>
              </select>
            </div>
            <button onClick={save} disabled={saving}
              className="mt-4 text-xs px-5 py-1.5 bg-[#000] text-white hover:bg-[#333] transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {loading
        ? <p className="text-xs text-[#999]">Loading…</p>
        : (
          <div className="border border-[#EAEAEA] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[#fafafa] border-b border-[#EAEAEA]">
                <tr>
                  {['Title', 'Shortcut', 'Preview', 'Scope', ''].map((h, i) => (
                    <th key={i} className="text-left text-[10px] font-semibold text-[#999] uppercase tracking-wide px-4 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f5f5f5]">
                {items.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-4 text-[#999] text-center">No canned responses yet</td></tr>
                )}
                {items.map(item => (
                  <>
                    <tr key={item.id} className="hover:bg-[#fafafa] transition-colors cursor-pointer"
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                      <td className="px-4 py-2.5 font-medium text-[#000]">{item.title}</td>
                      <td className="px-4 py-2.5 font-mono text-[#333]">/{item.shortcut}</td>
                      <td className="px-4 py-2.5 text-[#666] max-w-[200px] truncate">{item.body}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[9px] px-2 py-0.5 border ${
                          item.scope === 'shared' ? 'border-[#000] text-[#000]' : 'border-[#CCC] text-[#999]'
                        }`}>{item.scope}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button onClick={e => { e.stopPropagation(); remove(item.id); }}
                          className="text-[#999] hover:text-[#D32F2F] transition-colors text-[10px]">
                          Delete
                        </button>
                      </td>
                    </tr>
                    {expandedId === item.id && (
                      <tr key={`${item.id}-exp`} className="bg-[#fafafa]">
                        <td colSpan={5} className="px-4 py-3">
                          <p className="text-[10px] text-[#999] uppercase tracking-wide mb-1">Full body</p>
                          <p className="text-xs text-[#333] whitespace-pre-wrap">{item.body}</p>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  );
}

// ── Stub tab ──────────────────────────────────────────────────────────────────

function StubTab({ label, description }: { label: string; description: string }) {
  return (
    <div className="border border-[#EAEAEA] p-8 text-center">
      <h3 className="text-sm font-semibold text-[#000] mb-2">{label}</h3>
      <p className="text-xs text-[#666] max-w-sm mx-auto">{description}</p>
      <p className="text-[10px] text-[#999] mt-4">Coming in Phase 4</p>
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const INPUT = 'w-full text-xs border border-[#CCC] px-3 py-1.5 outline-none focus:border-[#000] transition-colors bg-white';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">{label}</label>
      {children}
    </div>
  );
}
