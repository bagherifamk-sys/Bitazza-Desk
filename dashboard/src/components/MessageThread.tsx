import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { TicketDetail, TicketStatus, Message } from '../types';
import { api } from '../api';
import { usePerm } from '../PermissionContext';

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_OPTIONS: TicketStatus[] = [
  'Open_Live', 'In_Progress', 'Pending_Customer',
  'Closed_Resolved', 'Closed_Unresponsive', 'Escalated',
];

// FR-07: sender_type render map
type SenderType = 'customer' | 'agent' | 'bot' | 'system' | 'internal_note' | 'whisper'
               | 'user' | 'ai' | 'assistant'; // legacy aliases

// ─── Virtual list (FR-07: virtualize at >100 messages) ──────────────────────
const VIRTUAL_THRESHOLD = 100;
const ITEM_HEIGHT = 72; // approximate px per message row

interface VirtualRange { start: number; end: number }

function useVirtualRange(total: number, containerRef: React.RefObject<HTMLDivElement | null>): VirtualRange {
  const [range, setRange] = useState<VirtualRange>({ start: 0, end: Math.min(total, 40) });

  useEffect(() => {
    if (total <= VIRTUAL_THRESHOLD) {
      setRange({ start: 0, end: total });
      return;
    }
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const overscan = 10;
      const start = Math.max(0, Math.floor(el.scrollTop / ITEM_HEIGHT) - overscan);
      const visible = Math.ceil(el.clientHeight / ITEM_HEIGHT);
      const end = Math.min(total, start + visible + overscan * 2);
      setRange({ start, end });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [total, containerRef]);

  return range;
}

// ─── Message bubble ──────────────────────────────────────────────────────────

function getSenderType(msg: Message): SenderType {
  // Prefer explicit sender_type field; fall back to legacy role field
  const t = (msg as Message & { sender_type?: string }).sender_type ?? msg.role;
  return (t as SenderType) ?? 'system';
}

interface BubbleProps { msg: Message; index: number }

function MessageBubble({ msg }: BubbleProps) {
  const type = getSenderType(msg);
  const ts = new Date(msg.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // FR-07 render rules:
  // customer  → right, gray bg
  // agent     → right, white+border
  // bot       → left, italic, "Bot:" prefix
  // system    → centered, small gray
  // internal_note → full-width cream, "Internal Note" label (never to customer)
  // whisper   → full-width yellow, "Whisper from [Supervisor]" (agent-only)

  if (type === 'system') {
    return (
      <div className="flex justify-center my-1">
        <span className="text-[10px] text-[#999] bg-[#f5f5f5] px-3 py-1 rounded-full">
          {msg.content}
        </span>
      </div>
    );
  }

  if (type === 'internal_note') {
    // Strip markdown: bold (**text**), bullets (* or - prefix), leading intro line
    const clean = msg.content
      .replace(/\*\*([^*]+)\*\*/g, '$1')   // **bold** → bold
      .replace(/^[*\-]\s+/gm, '')           // bullet symbols
      .trim();

    // Detect AI summary: contains Issue:, Actions:, Status: pattern
    const summaryLines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    const isSummary = summaryLines.some(l => /^(Issue|Actions|Status|Current Status|Actions Taken):/i.test(l));

    if (isSummary) {
      // Filter out any intro line (doesn't contain a colon label)
      const rows = summaryLines
        .map(line => { const c = line.indexOf(':'); return c === -1 ? null : { label: line.slice(0, c).trim(), text: line.slice(c + 1).trim() }; })
        .filter(Boolean) as { label: string; text: string }[];
      return (
        <div className="w-full my-1 px-1">
          <div className="bg-[#FFFDE7] border border-[#F9A825]/30 rounded overflow-hidden">
            <div className="text-[10px] font-semibold text-[#B45309] px-3 pt-2 pb-1.5 uppercase tracking-wide border-b border-[#F9A825]/20">
              AI Summary · {msg.agent_name || 'Agent'} · {ts}
            </div>
            <div className="divide-y divide-[#F9A825]/20">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-3 px-3 py-2">
                  <span className="shrink-0 font-semibold text-[#B45309] text-xs w-16">{row.label}</span>
                  <span className="text-xs text-[#333] leading-relaxed">{row.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full my-1 px-1">
        <div className="bg-[#FFFDE7] border border-[#F9A825]/30 rounded px-3 py-2">
          <div className="text-[10px] font-semibold text-[#F9A825] mb-1 uppercase tracking-wide">
            Internal Note · {msg.agent_name || 'Agent'} · {ts}
          </div>
          <p className="text-sm text-[#333] whitespace-pre-wrap break-words">{clean}</p>
        </div>
      </div>
    );
  }

  if (type === 'whisper') {
    const supervisorName = (msg as Message & { supervisor_name?: string }).supervisor_name ?? 'Supervisor';
    return (
      <div className="w-full my-1 px-1">
        <div className="bg-[#FFF9C4] border border-[#F57F17]/30 rounded px-3 py-2">
          <div className="text-[10px] font-semibold text-[#F57F17] mb-1 uppercase tracking-wide">
            Whisper from {supervisorName} · {ts}
          </div>
          <p className="text-sm text-[#333] whitespace-pre-wrap break-words">{msg.content}</p>
        </div>
      </div>
    );
  }

  const isRight = type === 'customer' || type === 'user';
  const isBot   = type === 'bot' || type === 'ai' || type === 'assistant';

  const bubbleClass = isRight
    ? 'bg-[#f0f0f0] text-[#000]'
    : isBot
    ? 'bg-white border border-[#EAEAEA] text-[#333] italic'
    : 'bg-white border border-[#CCC] text-[#000]'; // agent

  const label = isRight ? (msg.agent_name || 'Customer')
              : isBot   ? 'Bot'
              : (msg.agent_name || 'Agent');

  return (
    <div className={`flex flex-col max-w-[72%] ${isRight ? 'self-end items-end' : 'self-start items-start'}`}>
      <span className="text-[10px] text-[#999] mb-0.5">{label}</span>
      <div className={`px-3 py-2 rounded text-sm whitespace-pre-wrap break-words ${bubbleClass}`}>
        {isBot && <span className="font-semibold not-italic text-[#666] mr-1">Bot:</span>}
        {msg.content}
      </div>
      <span className="text-[10px] text-[#999] mt-0.5">{ts}</span>
    </div>
  );
}

// ─── SLA countdown badge ─────────────────────────────────────────────────────

function SLABadge({ breachAt }: { breachAt?: string | null }) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    if (!breachAt) return;
    const update = () => {
      const diff = new Date(breachAt).getTime() - Date.now();
      if (diff <= 0) { setDisplay('BREACHED'); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setDisplay(`${m}:${String(s).padStart(2, '0')}`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [breachAt]);

  if (!breachAt) return null;
  const breached = display === 'BREACHED';
  const soon = !breached && parseInt(display) < 30;
  return (
    <span className={`text-xs px-2 py-0.5 font-mono border rounded ${
      breached ? 'text-[#D32F2F] border-[#D32F2F] bg-[#ffebee]'
      : soon    ? 'text-[#E65100] border-[#E65100] bg-[#fff3e0]'
      : 'text-[#666] border-[#CCC]'
    }`}>
      SLA {display}
    </span>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface Props {
  ticketId: string;
  ws: WebSocket | null;
  onStatusChange: () => void;
  /** Draft text pushed from CopilotPanel Accept button */
  pendingDraft?: string | null;
  onDraftConsumed?: () => void;
}

// FR-08: channels that can be selected for outbound reply
const REPLY_CHANNELS = ['web', 'line', 'facebook', 'email'] as const;
type ReplyChannel = typeof REPLY_CHANNELS[number];

// Facebook Messenger 24h window — replies blocked after 24h from last customer message
function isFbWindowClosed(messages: Message[]): boolean {
  const lastCustomer = [...messages].reverse().find(m => {
    const t = (m as Message & { sender_type?: string }).sender_type ?? m.role;
    return t === 'customer' || t === 'user';
  });
  if (!lastCustomer) return false;
  const age = Date.now() / 1000 - lastCustomer.created_at;
  return age > 86400; // 24h in seconds
}

export default function MessageThread({ ticketId, ws, onStatusChange, pendingDraft, onDraftConsumed }: Props) {
  const canReply        = usePerm('inbox.reply');
  const canInternalNote = usePerm('inbox.internal_note');
  const canClose        = usePerm('inbox.close');
  const canEscalate     = usePerm('inbox.escalate');

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [isAiDraft, setIsAiDraft] = useState(false); // FR-11: track if current text came from AI
  const [isNote, setIsNote] = useState(false);
  const [replyChannel, setReplyChannel] = useState<ReplyChannel>('web');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typingAgents, setTypingAgents] = useState<string[]>([]);
  const [cannedMatches, setCannedMatches] = useState<{ id: string; shortcut: string; body: string }[]>([]);
  const [allCanned, setAllCanned] = useState<{ id: string; shortcut: string; body: string; title: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const messages: Message[] = useMemo(() => ticket?.history ?? [], [ticket]);
  const virtualRange = useVirtualRange(messages.length, scrollRef);

  const load = useCallback(async () => {
    try {
      const data = await api.getTicket(ticketId);
      setTicket(data);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.getCannedResponses().then(setAllCanned).catch(() => {}); }, []);

  // FR-08: default reply channel to ticket's inbound channel
  useEffect(() => {
    if (ticket?.channel && REPLY_CHANNELS.includes(ticket.channel as ReplyChannel)) {
      setReplyChannel(ticket.channel as ReplyChannel);
    }
  }, [ticket?.channel]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length <= VIRTUAL_THRESHOLD) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  // Consume accepted draft from CopilotPanel (FR-11)
  useEffect(() => {
    if (pendingDraft) {
      setReply(pendingDraft);
      setIsNote(false);
      setIsAiDraft(true);
      onDraftConsumed?.();
    }
  }, [pendingDraft]);

  // WS events
  useEffect(() => {
    if (!ws) return;
    const handler = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as Record<string, unknown>;
        // Match on conversation_id (socket.io) or ticketId (some events)
        const evId = (event.conversation_id ?? event.ticketId) as string | undefined;
        const myId = ticket?.id ?? ticket?.conversation_id;
        if (evId && myId && evId !== myId) return;

        if (event.type === 'new_message') {
          setTicket(prev => prev
            ? { ...prev, history: [...prev.history, event.message as Message] }
            : prev);
        } else if (event.type === 'agent_typing') {
          const name = event.agent_name as string;
          setTypingAgents(prev => prev.includes(name) ? prev : [...prev, name]);
          setTimeout(() => setTypingAgents(prev => prev.filter(n => n !== name)), 5000);
        } else if (event.type === 'whisper') {
          const msg: Message = {
            role: 'whisper',
            sender_type: 'whisper',
            content: event.content as string,
            created_at: Math.floor(Date.now() / 1000),
            supervisor_name: event.supervisor_name as string,
          };
          setTicket(prev => prev ? { ...prev, history: [...prev.history, msg] } : prev);
        }
      } catch { /* ignore */ }
    };
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [ws, ticket?.conversation_id]);

  const emitTyping = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !ticket) return;
    ws.send(JSON.stringify({ type: 'typing', conversation_id: ticket.conversation_id }));
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {}, 5000);
  };

  const handleReplyChange = (val: string) => {
    setReply(val);
    if (isAiDraft) setIsAiDraft(false); // user edited — no longer a pure AI draft
    emitTyping();
    const match = val.match(/\/(\w*)$/);
    if (match) {
      const q = match[1].toLowerCase();
      setCannedMatches(allCanned.filter(c => c.shortcut.startsWith(q)).slice(0, 6));
    } else {
      setCannedMatches([]);
    }
  };

  const applyCanned = (body: string) => {
    const filled = body
      .replace('{{customer_name}}', ticket?.customer?.name ?? '')
      .replace('{{ticket_id}}', ticket?.id ?? '')
      .replace('{{agent_name}}', 'Agent');
    setReply(prev => prev.replace(/\/\w*$/, filled));
    setCannedMatches([]);
  };

  const send = async () => {
    if (!reply.trim() || sending || !ticket) return;
    setSending(true);
    try {
      await api.reply(ticket.id, reply.trim(), isNote, replyChannel);
      setReply('');
      setIsAiDraft(false);
      await load();
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: TicketStatus) => {
    if (!ticket) return;
    await api.setStatus(ticket.id, status);
    await load();
    onStatusChange();
  };

  if (loading) return (
    <div className="flex items-center justify-center h-full text-[#999] text-sm">Loading…</div>
  );
  if (!ticket) return null;

  const isVirtual = messages.length > VIRTUAL_THRESHOLD;
  const visibleMessages = isVirtual
    ? messages.slice(virtualRange.start, virtualRange.end)
    : messages;
  const topPad = isVirtual ? virtualRange.start * ITEM_HEIGHT : 0;
  const botPad = isVirtual ? (messages.length - virtualRange.end) * ITEM_HEIGHT : 0;

  const slaBreachAt = (ticket as TicketDetail & { sla_breach_at?: string }).sla_breach_at;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-2 bg-white border-b border-[#EAEAEA] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-[#000] truncate">
            {ticket.customer?.name || ticket.customer?.user_id || ticket.id.slice(0, 8)}
          </span>
          <span className="text-xs text-[#999]">{ticket.category?.replace(/_/g, ' ')}</span>
          <SLABadge breachAt={slaBreachAt} />
          {isVirtual && (
            <span className="text-[10px] text-[#999] border border-[#EAEAEA] px-1.5 py-0.5 rounded">
              {messages.length} messages
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          {STATUS_OPTIONS
            .filter(s => s === 'Escalated' ? canEscalate : canClose)
            .map(s => (
              <button key={s} onClick={() => changeStatus(s)} disabled={ticket.status === s}
                className={`text-xs px-2 py-0.5 border whitespace-nowrap capitalize transition-colors ${
                  ticket.status === s
                    ? 'bg-[#000] text-white border-[#000]'
                    : 'border-[#CCC] text-[#666] hover:border-[#000] hover:text-[#000]'
                } disabled:cursor-default`}>
                {s.replace(/_/g, ' ')}
              </button>
            ))}
        </div>
      </div>

      {/* Message list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
        {isVirtual && <div style={{ height: topPad }} />}

        {visibleMessages.map((msg, i) => (
          <MessageBubble key={isVirtual ? virtualRange.start + i : i} msg={msg} index={i} />
        ))}

        {isVirtual && <div style={{ height: botPad }} />}

        {/* Typing indicator */}
        {typingAgents.length > 0 && (
          <div className="self-start text-xs text-[#999] italic">
            {typingAgents.join(', ')} {typingAgents.length === 1 ? 'is' : 'are'} typing…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Canned response dropdown */}
      {cannedMatches.length > 0 && (
        <div className="mx-4 mb-1 bg-white border border-[#EAEAEA] shadow-sm overflow-hidden">
          {cannedMatches.map(c => (
            <button key={c.id} onClick={() => applyCanned(c.body)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-[#f5f5f5] border-b border-[#f5f5f5] last:border-0">
              <span className="font-medium text-[#000]">/{c.shortcut}</span>
              <span className="text-[#999] ml-2 text-xs truncate">{c.body.slice(0, 60)}…</span>
            </button>
          ))}
        </div>
      )}

      {/* Reply composer — only shown if user can reply or write internal notes */}
      {(canReply || canInternalNote) && (
      <div className="px-4 py-3 bg-white border-t border-[#EAEAEA] shrink-0">
        {/* Mode tabs + FR-08 channel switcher */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {canReply && (
          <button onClick={() => setIsNote(false)}
            className={`text-xs px-3 py-1 border transition-colors ${
              !isNote ? 'bg-[#000] text-white border-[#000]' : 'border-[#CCC] text-[#666] hover:border-[#000]'
            }`}>
            Reply
          </button>
          )}
          {canInternalNote && (
          <button onClick={() => setIsNote(true)}
            className={`text-xs px-3 py-1 border transition-colors ${
              isNote ? 'bg-[#F9A825] text-white border-[#F9A825]' : 'border-[#CCC] text-[#666] hover:border-[#F9A825]'
            }`}>
            Internal Note
          </button>
          )}
          {/* FR-08: channel switcher — only shown when in Reply mode */}
          {!isNote && (
            <div className="flex border border-[#CCC] overflow-hidden ml-auto">
              {REPLY_CHANNELS.map(ch => {
                const fbLocked = ch === 'facebook' && isFbWindowClosed(messages);
                return (
                  <button
                    key={ch}
                    onClick={() => !fbLocked && setReplyChannel(ch)}
                    disabled={fbLocked}
                    title={fbLocked ? 'Facebook 24h window closed' : undefined}
                    className={`text-[10px] px-2 py-0.5 capitalize border-r border-[#CCC] last:border-0 transition-colors ${
                      replyChannel === ch && !isNote
                        ? 'bg-[#000] text-white'
                        : fbLocked
                        ? 'text-[#CCC] cursor-not-allowed'
                        : 'text-[#333] hover:bg-[#f5f5f5]'
                    }`}
                  >
                    {ch}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Facebook 24h warning */}
        {!isNote && replyChannel === 'facebook' && isFbWindowClosed(messages) && (
          <div className="mb-2 text-[11px] text-[#D32F2F] border border-[#D32F2F]/30 bg-[#ffebee] px-2 py-1">
            Facebook 24h messaging window has closed. Template messages only.
          </div>
        )}

        {/* FR-11: AI Draft label */}
        {isAiDraft && !isNote && (
          <div className="mb-1 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-[#555] border border-[#CCC] px-1.5 py-0.5 rounded">
              AI Draft
            </span>
            <span className="text-[10px] text-[#999]">Review before sending</span>
          </div>
        )}

        <div className="flex gap-2">
          <textarea
            value={reply}
            onChange={e => handleReplyChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={isNote ? 'Internal note (@mention agents)…' : `Reply via ${replyChannel}… (/ for canned responses)`}
            className={`flex-1 text-sm px-3 py-2 border resize-none outline-none transition-colors ${
              isNote
                ? 'bg-[#FFFDE7] border-[#F9A825]/40 focus:border-[#F9A825]'
                : 'border-[#CCC] focus:border-[#000]'
            }`}
            rows={2}
          />
          <button onClick={send} disabled={!reply.trim() || sending}
            className="bg-[#000] text-white text-sm px-4 font-medium disabled:opacity-30 shrink-0 hover:bg-[#333] transition-colors">
            {sending ? '…' : 'Send'}
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
