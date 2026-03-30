import { useState, useEffect, useRef } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { PermissionProvider } from './PermissionContext';
import type { Ticket, InboxView, AgentStatus, WSEvent, Role } from './types';
import { api, createWS } from './api';
import ConversationList from './components/ConversationList';
import MessageThread from './components/MessageThread';
import PropertiesPanel from './components/PropertiesPanel';
import SupervisorDashboard from './components/SupervisorDashboard';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import AdminSettings from './components/AdminSettings';
import AIStudio from './components/AIStudio';
import MetricsDashboard from './components/MetricsDashboard';
import HomeDashboard from './components/HomeDashboard';

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  role: Role;
  team?: string;
  token: string;
  permissions: string[];
}

function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('auth_user');
    if (!raw) return null;
    const u = JSON.parse(raw) as AuthUser;
    // Stale session — no permissions embedded (pre-RBAC login). Force re-login.
    if (!u.permissions || u.permissions.length === 0) {
      localStorage.removeItem('auth_user');
      return null;
    }
    return u;
  } catch { return null; }
}

function setAuthUser(u: AuthUser | null) {
  if (u) localStorage.setItem('auth_user', JSON.stringify(u));
  else localStorage.removeItem('auth_user');
}

// ── Permission guard ──────────────────────────────────────────────────────────

function PermissionGuard({ permission, user, children }: { permission: string; user: AuthUser | null; children: React.ReactNode }) {
  if (!user) return <Navigate to="/login" replace />;
  if (!(user.permissions ?? []).includes(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// Helper — check if current user has a permission (used for conditional UI)
export function hasPerm(user: AuthUser | null, permission: string): boolean {
  return (user?.permissions ?? []).includes(permission);
}

// ── Login ─────────────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: (u: AuthUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email || !password) { setError('Enter email and password'); return; }
    try {
      const data = await api.login(email.trim().toLowerCase(), password);
      onLogin({ ...data.user, role: data.user.role as Role, token: data.token });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F0F0F]">
      <form onSubmit={handleSubmit} className="w-80 bg-[#1A1A1A] border border-[#2A2A2A] p-8 rounded-xl">
        <div className="flex items-center gap-2 mb-7">
          <div className="w-7 h-7 rounded bg-[#E63946] flex items-center justify-center">
            <span className="text-white text-xs font-bold">B</span>
          </div>
          <span className="text-white font-bold text-sm">Bitazza Help Desk</span>
        </div>
        {error && <p className="text-[#E63946] text-xs mb-4">{error}</p>}
        <label className="block text-[11px] text-[#888] mb-1 uppercase tracking-wide">Email</label>
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          className="w-full bg-[#111] border border-[#2A2A2A] text-white px-3 py-2 text-sm mb-4 rounded-lg outline-none focus:border-[#E63946] transition-colors placeholder:text-[#444]"
          placeholder="agent@bitazza.com"
        />
        <label className="block text-[11px] text-[#888] mb-1 uppercase tracking-wide">Password</label>
        <input
          type="password" value={password} onChange={e => setPassword(e.target.value)}
          className="w-full bg-[#111] border border-[#2A2A2A] text-white px-3 py-2 text-sm mb-6 rounded-lg outline-none focus:border-[#E63946] transition-colors"
        />
        <button type="submit"
          className="w-full bg-[#E63946] text-white text-sm py-2.5 rounded-lg hover:bg-[#c8303c] transition-colors font-semibold">
          Sign in
        </button>
        <p className="text-[10px] text-[#555] mt-4 text-center">
          Use "supervisor@…" or "admin@…" for elevated roles
        </p>
      </form>
    </div>
  );
}

// ── Agent state toggle ────────────────────────────────────────────────────────

const AGENT_STATES: AgentStatus[] = ['Available', 'Busy', 'Break', 'Offline'];

const STATE_DOT: Record<string, string> = {
  Available: 'bg-[#22C55E]',
  Busy: 'bg-[#F59E0B]',
  Break: 'bg-[#888]',
  Offline: 'bg-[#E63946]',
};

const STATE_LABEL: Record<AgentStatus, string> = {
  Available: 'Available', Busy: 'Busy', Break: 'Break', Offline: 'Offline',
  away: 'Away', after_call_work: 'ACW',
};

interface AgentToggleProps {
  status: AgentStatus;
  activeChats: number;
  onChange: (s: AgentStatus) => void;
}

function AgentStateToggle({ status, activeChats, onChange }: AgentToggleProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<AgentStatus | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = (s: AgentStatus) => {
    setOpen(false);
    if (s === status) return;
    if (s === 'Offline' && activeChats > 0) { setPending(s); return; }
    onChange(s);
  };

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#E5E5E5] bg-white hover:bg-[#F8F8F8] transition-colors text-xs"
        >
          <span className={`w-2 h-2 rounded-full ${STATE_DOT[status] ?? 'bg-[#888]'}`} />
          <span className="text-[#333] font-medium">{STATE_LABEL[status]}</span>
          <svg className="w-3 h-3 text-[#999]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-[#E5E5E5] rounded-lg shadow-lg overflow-hidden z-50">
            {AGENT_STATES.map(s => (
              <button key={s} onClick={() => handleSelect(s)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[#F8F8F8] transition-colors ${s === status ? 'font-semibold text-[#111]' : 'text-[#444]'}`}>
                <span className={`w-2 h-2 rounded-full ${STATE_DOT[s]}`} />
                {STATE_LABEL[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {pending && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white border border-[#E5E5E5] p-6 w-80 rounded-xl shadow-xl">
            <h3 className="font-bold text-sm mb-2 text-[#111]">Go Offline?</h3>
            <p className="text-sm text-[#555] mb-5">
              You have <strong>{activeChats}</strong> active chat{activeChats !== 1 ? 's' : ''}.
              Going offline will re-queue them.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setPending(null)}
                className="px-4 py-1.5 text-sm border border-[#E5E5E5] rounded-lg hover:bg-[#F8F8F8] transition-colors">
                Cancel
              </button>
              <button onClick={() => { onChange(pending); setPending(null); }}
                className="px-4 py-1.5 text-sm bg-[#E63946] text-white rounded-lg hover:bg-[#c8303c] transition-colors">
                Go Offline
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Icons (inline SVG) ────────────────────────────────────────────────────────

const Icons = {
  home: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-[18px] h-[18px]">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M3 9.75L12 3l9 6.75V21a.75.75 0 01-.75.75H15v-6H9v6H3.75A.75.75 0 013 21V9.75z" />
    </svg>
  ),
  inbox: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-[18px] h-[18px]">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859M3 7.5h18M3 12h18" />
    </svg>
  ),
  analytics: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-[18px] h-[18px]">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  ),
  supervisor: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-[18px] h-[18px]">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  metrics: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-[18px] h-[18px]">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
    </svg>
  ),
  studio: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-[18px] h-[18px]">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
    </svg>
  ),
  admin: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-[18px] h-[18px]">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  chevronLeft: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  ),
  chevronRight: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-4 h-4">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  ),
  bell: (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-[18px] h-[18px]">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
    </svg>
  ),
};

// ── Sidebar ───────────────────────────────────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  permission: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/',           label: 'Home',       icon: Icons.home,       permission: 'section.home' },
  { to: '/inbox',      label: 'Inbox',      icon: Icons.inbox,      permission: 'section.inbox' },
  { to: '/supervisor', label: 'Supervisor', icon: Icons.supervisor, permission: 'section.supervisor' },
  { to: '/analytics',  label: 'Analytics',  icon: Icons.analytics,  permission: 'section.analytics' },
  { to: '/metrics',    label: 'Metrics',    icon: Icons.metrics,    permission: 'section.metrics' },
  { to: '/studio',     label: 'AI Studio',  icon: Icons.studio,     permission: 'section.studio' },
  { to: '/admin',      label: 'Admin',      icon: Icons.admin,      permission: 'section.admin' },
];

const PAGE_TITLES: Record<string, string> = {
  '/':           'Home',
  '/inbox':      'Inbox',
  '/supervisor': 'Supervisor',
  '/analytics':  'Analytics',
  '/metrics':    'Metrics',
  '/studio':     'AI Studio',
  '/admin':      'Admin',
};

interface SidebarProps {
  user: AuthUser;
  collapsed: boolean;
  onToggle: () => void;
  onLogout: () => void;
}

function Sidebar({ user, collapsed, onToggle, onLogout }: SidebarProps) {
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const visibleItems = NAV_ITEMS.filter(n => (user.permissions ?? []).includes(n.permission));
  const initials = user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowUserMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <aside
      className="flex flex-col bg-[#0F0F0F] shrink-0 transition-all duration-200 ease-in-out"
      style={{ width: collapsed ? 56 : 220 }}
    >
      {/* Logo */}
      <div className={`flex items-center gap-3 px-3.5 h-12 border-b border-[#1E1E1E] shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-7 h-7 rounded bg-[#E63946] flex items-center justify-center shrink-0">
          <span className="text-white text-xs font-bold">B</span>
        </div>
        {!collapsed && (
          <span className="text-white font-bold text-sm whitespace-nowrap">Bitazza CS</span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-3 overflow-y-auto overflow-x-hidden">
        {visibleItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 mx-2 px-2.5 py-2.5 rounded-lg mb-0.5 transition-colors
               ${isActive
                 ? 'bg-[#1A1A1A] text-white border-l-2 border-[#E63946] pl-[9px]'
                 : 'text-[#888] hover:text-white hover:bg-[#1A1A1A]'
               }`
            }
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && (
              <span className="text-[13px] font-medium whitespace-nowrap">{item.label}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Bottom: user + collapse toggle */}
      <div className="border-t border-[#1E1E1E] py-3 shrink-0">
        {/* User menu */}
        <div ref={menuRef} className="relative mx-2 mb-2">
          <button
            onClick={() => setShowUserMenu(o => !o)}
            className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-[#1A1A1A] transition-colors ${collapsed ? 'justify-center' : ''}`}
          >
            <div className="w-7 h-7 rounded-full bg-[#E63946] text-white text-[11px] font-bold flex items-center justify-center shrink-0">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 text-left">
                <div className="text-white text-[12px] font-medium truncate">{user.name}</div>
                <div className="text-[#555] text-[10px] capitalize truncate">{user.role.replace('_', ' ')}</div>
              </div>
            )}
          </button>

          {showUserMenu && (
            <div className={`absolute ${collapsed ? 'left-full ml-2 bottom-0' : 'bottom-full mb-1 left-0 right-0'} bg-[#1A1A1A] border border-[#2A2A2A] rounded-lg shadow-xl overflow-hidden z-50 w-40`}>
              <button onClick={onLogout}
                className="w-full px-4 py-2.5 text-left text-[12px] text-[#E63946] hover:bg-[#222] transition-colors">
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          style={{ width: 'calc(100% - 16px)' }}
          className={`flex items-center gap-3 px-2.5 py-2 mx-2 rounded-lg text-[#555] hover:text-white hover:bg-[#1A1A1A] transition-colors ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="shrink-0">{collapsed ? Icons.chevronRight : Icons.chevronLeft}</span>
          {!collapsed && <span className="text-[12px]">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────────

interface TopBarProps {
  myStatus: AgentStatus;
  activeChats: number;
  onStatusChange: (s: AgentStatus) => void;
}

function TopBar({ myStatus, activeChats, onStatusChange }: TopBarProps) {
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? 'Dashboard';

  return (
    <div className="h-12 bg-white border-b border-[#E5E5E5] flex items-center justify-between px-5 shrink-0">
      <h1 className="text-[15px] font-semibold text-[#111]">{title}</h1>
      <div className="flex items-center gap-3">
        <button className="text-[#999] hover:text-[#111] transition-colors" title="Notifications">
          {Icons.bell}
        </button>
        <AgentStateToggle status={myStatus} activeChats={activeChats} onChange={onStatusChange} />
      </div>
    </div>
  );
}

// ── Workspace (3-panel) ───────────────────────────────────────────────────────

interface WorkspaceProps {
  ws: WebSocket | null;
  tickets: Ticket[];
  selectedId: string | null;
  view: InboxView;
  search: string;
  onSelect: (id: string) => void;
  onViewChange: (v: InboxView) => void;
  onSearchChange: (s: string) => void;
  onRefresh: () => void;
}

function Workspace({ ws, tickets, selectedId, view, search, onSelect, onViewChange, onSearchChange, onRefresh }: WorkspaceProps) {
  const selectedTicket = tickets.find(t => t.id === selectedId) ?? null;
  const [pendingDraft, setPendingDraft] = useState<string | null>(null);

  return (
    <div className="flex flex-1 overflow-hidden">
      <ConversationList
        tickets={tickets} selectedId={selectedId} view={view} search={search}
        onSelect={onSelect} onViewChange={onViewChange}
        onSearchChange={onSearchChange} onRefresh={onRefresh}
      />
      <div className="flex-1 overflow-hidden">
        {selectedId
          ? <MessageThread
              key={selectedId}
              ticketId={selectedId}
              ws={ws}
              onStatusChange={onRefresh}
              pendingDraft={pendingDraft}
              onDraftConsumed={() => setPendingDraft(null)}
            />
          : <div className="flex items-center justify-center h-full text-[#999] text-sm bg-[#F8F8F8]">
              Select a conversation
            </div>
        }
      </div>
      {selectedTicket && (
        <PropertiesPanel
          ticket={selectedTicket}
          onUpdate={onRefresh}
          onAcceptDraft={(text) => setPendingDraft(text)}
        />
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(getAuthUser);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => sessionStorage.getItem('selectedId'));
  const [view, setView] = useState<InboxView>(() => (sessionStorage.getItem('inboxView') as InboxView) ?? 'all_open');
  const [search, setSearch] = useState(() => sessionStorage.getItem('inboxSearch') ?? '');
  const [myStatus, setMyStatus] = useState<AgentStatus>('Available');
  const [activeChats, setActiveChats] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const loadTickets = async () => {
    try {
      const data = await api.getTickets(view, search);
      setTickets(data);
      if (!selectedId && data.length > 0) handleSelect(data[0].id);
    } catch { /* backend stub — silent */ }
  };

  useEffect(() => { if (user) loadTickets(); }, [view, search, user]);

  useEffect(() => {
    if (!user) return;
    const connect = () => {
      const ws = createWS((event) => {
        const e = event as WSEvent;
        if (e.type === 'status_change' || e.type === 'ticket_assigned') loadTickets();
      });
      ws.onclose = () => setTimeout(connect, 3000);
      wsRef.current = ws;
    };
    connect();
    return () => wsRef.current?.close();
  }, [user]);

  useEffect(() => {
    setActiveChats(tickets.filter(t => t.status === 'Open_Live' || t.status === 'In_Progress').length);
  }, [tickets]);

  const handleStatusChange = async (s: AgentStatus) => {
    setMyStatus(s);
    try { await api.setMyStatus(s); } catch { /* silent */ }
  };

  const handleToggleSidebar = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  const handleSelect = (id: string) => { sessionStorage.setItem('selectedId', id); setSelectedId(id); };
  const handleViewChange = (v: InboxView) => { sessionStorage.setItem('inboxView', v); setView(v); };
  const handleSearchChange = (s: string) => { sessionStorage.setItem('inboxSearch', s); setSearch(s); };
  const handleLogin = (u: AuthUser) => { setAuthUser(u); setUser(u); };
  const handleLogout = () => { setAuthUser(null); setUser(null); sessionStorage.clear(); };

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage onLogin={handleLogin} />} />
      </Routes>
    );
  }

  return (
    <PermissionProvider value={user.permissions ?? []}>
    <div className="flex h-screen bg-[#F8F8F8] font-sans overflow-hidden">
      {/* ── Sidebar ── */}
      <Sidebar user={user} collapsed={collapsed} onToggle={handleToggleSidebar} onLogout={handleLogout} />

      {/* ── Main ── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <TopBar myStatus={myStatus} activeChats={activeChats} onStatusChange={handleStatusChange} />

        <div className="flex flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={
              <HomeDashboard onSelectTicket={handleSelect} />
            } />
            <Route path="/inbox" element={
              <Workspace
                ws={wsRef.current}
                tickets={tickets} selectedId={selectedId} view={view} search={search}
                onSelect={handleSelect} onViewChange={handleViewChange}
                onSearchChange={handleSearchChange} onRefresh={loadTickets}
              />
            } />
            <Route path="/supervisor" element={
              <PermissionGuard permission="section.supervisor" user={user}>
                <SupervisorDashboard />
              </PermissionGuard>
            } />
            <Route path="/analytics" element={
              <PermissionGuard permission="section.analytics" user={user}>
                <AnalyticsDashboard />
              </PermissionGuard>
            } />
            <Route path="/admin" element={
              <PermissionGuard permission="section.admin" user={user}>
                <AdminSettings currentUser={user} />
              </PermissionGuard>
            } />
            <Route path="/studio" element={
              <PermissionGuard permission="section.studio" user={user}>
                <AIStudio />
              </PermissionGuard>
            } />
            <Route path="/metrics" element={
              <PermissionGuard permission="section.metrics" user={user}>
                <MetricsDashboard />
              </PermissionGuard>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
    </PermissionProvider>
  );
}
