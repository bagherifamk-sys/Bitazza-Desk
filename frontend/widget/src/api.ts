import type { CSBotConfig } from './types';

function getHeaders(cfg: CSBotConfig): HeadersInit {
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (cfg.token) h['Authorization'] = `Bearer ${cfg.token}`;
  return h;
}

const SESSION_KEY = 'csbot_session';
const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

export interface StoredAgent {
  name: string;
  avatar: string;
  avatarUrl: string | null;
}

export interface StoredSession {
  id: string;
  lang?: 'en' | 'th';
  category?: string;
  agent?: StoredAgent;
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function getStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { id, ts, lang, category, agent } = JSON.parse(raw);
    if (Date.now() - ts > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return { id, lang, category, agent } as StoredSession;
  } catch {
    return null;
  }
}

function storeSession(id: string, lang?: 'en' | 'th', category?: string, agent?: StoredAgent) {
  const existing = getStoredSession();
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    id,
    ts: Date.now(),
    lang: lang ?? existing?.lang,
    category: category ?? existing?.category,
    agent: agent ?? existing?.agent,
  }));
}

export function storeSessionLang(lang: 'en' | 'th') {
  const existing = getStoredSession();
  if (existing) storeSession(existing.id, lang, existing.category, existing.agent);
}

export function storeSessionCategory(category: string) {
  const existing = getStoredSession();
  if (existing) storeSession(existing.id, existing.lang, category, existing.agent);
}

export function storeSessionAgent(agent: StoredAgent) {
  const existing = getStoredSession();
  if (existing) storeSession(existing.id, existing.lang, existing.category, agent);
}

export async function startConversation(cfg: CSBotConfig): Promise<string> {
  const cached = getStoredSession();
  if (cached) return cached.id;

  const res = await fetch(`${cfg.apiUrl}/chat/start`, {
    method: 'POST',
    headers: getHeaders(cfg),
    body: JSON.stringify({ platform: cfg.platform }),
  });
  if (!res.ok) throw new Error(`start failed: ${res.status}`);
  const data = await res.json();
  storeSession(data.conversation_id);
  return data.conversation_id as string;
}

export interface SendResult {
  reply: string;
  language: 'en' | 'th';
  escalated: boolean;
  ticketId: string | null;
  agentName: string | null;
  agentAvatar: string | null;
  agentAvatarUrl: string | null;
  offerResolution: boolean;
  upgradedCategory: string | null;
  transitionMessage: string | null;
}

export interface GreetResult {
  greeting: string;
  botName: string;
  botAvatarUrl: string | null;
}

export interface SetCategoryResult {
  agentName: string;
  agentAvatar: string;
  agentAvatarUrl: string;
}

export async function setCategoryAgent(
  cfg: CSBotConfig,
  conversationId: string,
  category: string,
): Promise<SetCategoryResult> {
  const res = await fetch(`${cfg.apiUrl}/chat/set-category`, {
    method: 'POST',
    headers: getHeaders(cfg),
    body: JSON.stringify({ conversation_id: conversationId, category }),
  });
  if (!res.ok) throw new Error(`set-category failed: ${res.status}`);
  const data = await res.json();
  return {
    agentName: data.agent_name,
    agentAvatar: data.agent_avatar,
    agentAvatarUrl: data.agent_avatar_url,
  };
}

export async function greetConversation(cfg: CSBotConfig, conversationId: string, language: 'en' | 'th'): Promise<GreetResult> {
  const res = await fetch(`${cfg.apiUrl}/chat/greet`, {
    method: 'POST',
    headers: getHeaders(cfg),
    body: JSON.stringify({ conversation_id: conversationId, language }),
  });
  if (!res.ok) throw new Error(`greet failed: ${res.status}`);
  const data = await res.json();
  return { greeting: data.greeting as string, botName: data.bot_name as string, botAvatarUrl: data.agent_avatar_url ?? null };
}

export async function fetchHistory(cfg: CSBotConfig, conversationId: string): Promise<{ role: string; content: string; created_at: number; agent_name?: string; agent_avatar?: string; agent_avatar_url?: string }[]> {
  const res = await fetch(`${cfg.apiUrl}/chat/history/${conversationId}`, {
    headers: getHeaders(cfg),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.history ?? [];
}

export async function sendMessage(
  cfg: CSBotConfig,
  conversationId: string,
  message: string,
  consecutiveLowConfidence = 0,
  category?: string,
): Promise<SendResult> {
  const res = await fetch(`${cfg.apiUrl}/chat/message`, {
    method: 'POST',
    headers: getHeaders(cfg),
    body: JSON.stringify({
      conversation_id: conversationId,
      message,
      consecutive_low_confidence: consecutiveLowConfidence,
      ...(category ? { category } : {}),
    }),
  });
  if (!res.ok) throw new Error(`message failed: ${res.status}`);
  const data = await res.json();
  return {
    reply: data.reply,
    language: data.language,
    escalated: data.escalated,
    ticketId: data.ticket_id ?? null,
    agentName: data.agent_name ?? null,
    agentAvatar: data.agent_avatar ?? null,
    agentAvatarUrl: data.agent_avatar_url ?? null,
    offerResolution: data.offer_resolution ?? false,
    upgradedCategory: data.upgraded_category ?? null,
    transitionMessage: data.transition_message ?? null,
  };
}
