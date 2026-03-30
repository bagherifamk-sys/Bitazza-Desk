import { useState, useEffect, useCallback } from 'react';
import type { RelatedTicket } from '../types';
import { api } from '../api';

interface Props {
  ticketId: string;
  /** Called when agent clicks Accept on a draft — inserts text into composer */
  onAcceptDraft?: (text: string) => void;
}

const SENTIMENT_STYLE: Record<string, string> = {
  positive: 'text-[#2E7D32] border-[#2E7D32]',
  negative: 'text-[#D32F2F] border-[#D32F2F]',
  neutral:  'text-[#666]   border-[#CCC]',
};

export default function CopilotPanel({ ticketId, onAcceptDraft }: Props) {
  const [open, setOpen] = useState(true);

  // Suggest reply
  const [suggestion, setSuggestion] = useState('');
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState('');
  const [copied, setCopied] = useState(false);

  // Summary
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');

  // Sentiment
  const [sentiment, setSentiment] = useState('');
  const [sentimentLoading, setSentimentLoading] = useState(false);

  // Related tickets
  const [related, setRelated] = useState<RelatedTicket[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);

  // Reset on ticket change
  useEffect(() => {
    setSuggestion(''); setSuggestionError('');
    setSummary('');    setSummaryError('');
    setSentiment('');
    setRelated([]);
    // Auto-load sentiment + related on open (independent, non-blocking)
    loadSentiment();
    loadRelated();
  }, [ticketId]);

  const loadSuggestion = async () => {
    setSuggestionLoading(true); setSuggestionError('');
    try {
      const r = await api.suggestReply(ticketId);
      setSuggestion(r.suggestion);
    } catch (e) {
      setSuggestionError(e instanceof Error ? e.message : 'AI Assist unavailable.');
    } finally { setSuggestionLoading(false); }
  };

  const loadSummary = async () => {
    setSummaryLoading(true); setSummaryError('');
    try {
      const r = await api.summarize(ticketId);
      setSummary(r.summary);
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'AI Assist unavailable.');
    } finally { setSummaryLoading(false); }
  };

  const loadSentiment = useCallback(async () => {
    setSentimentLoading(true);
    try {
      const r = await api.sentiment(ticketId);
      setSentiment(r.sentiment);
    } catch { /* silent */ } finally { setSentimentLoading(false); }
  }, [ticketId]);

  const loadRelated = useCallback(async () => {
    setRelatedLoading(true);
    try {
      const r = await api.relatedTickets(ticketId);
      setRelated(r.related);
    } catch { /* silent */ } finally { setRelatedLoading(false); }
  }, [ticketId]);

  const copySuggestion = () => {
    navigator.clipboard.writeText(suggestion).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="border-t border-[#EAEAEA]">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-between w-full px-4 py-3 text-xs font-semibold text-[#333] uppercase tracking-wide hover:bg-[#f5f5f5] transition-colors"
      >
        AI Copilot
        <span className="text-[#999] text-[10px]">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4">

          {/* ── Reply Suggestion ───────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[#333] uppercase tracking-wide">
                Reply Suggestion
              </span>
              <button
                onClick={loadSuggestion}
                disabled={suggestionLoading}
                className="text-[11px] text-[#000] underline underline-offset-2 disabled:opacity-40"
              >
                {suggestionLoading ? 'Generating…' : suggestion ? 'Regenerate' : 'Generate'}
              </button>
            </div>

            {suggestionError && (
              <p className="text-[11px] text-[#D32F2F] mb-1">{suggestionError}</p>
            )}

            {suggestion && (
              <div className="border border-[#EAEAEA] bg-[#fafafa] p-2.5 text-xs text-[#333] whitespace-pre-wrap leading-relaxed">
                {suggestion}
                <div className="flex gap-2 mt-2.5">
                  {onAcceptDraft && (
                    <button
                      onClick={() => { onAcceptDraft(suggestion); setSuggestion(''); }}
                      className="text-[11px] px-3 py-1 bg-[#000] text-white hover:bg-[#333] transition-colors"
                    >
                      Accept
                    </button>
                  )}
                  <button
                    onClick={copySuggestion}
                    className="text-[11px] px-3 py-1 border border-[#CCC] text-[#333] hover:border-[#000] transition-colors"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => setSuggestion('')}
                    className="text-[11px] px-3 py-1 border border-[#CCC] text-[#666] hover:border-[#D32F2F] hover:text-[#D32F2F] transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Summary (FR-10) ────────────────────────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[#333] uppercase tracking-wide">Summary</span>
              <button
                onClick={loadSummary}
                disabled={summaryLoading}
                className="text-[11px] text-[#000] underline underline-offset-2 disabled:opacity-40"
              >
                {summaryLoading ? 'Summarizing…' : summary ? 'Refresh' : 'Summarize'}
              </button>
            </div>

            {summaryError && (
              <p className="text-[11px] text-[#D32F2F]">{summaryError}</p>
            )}

            {summary && (() => {
              const lines = summary.split('\n').map(l => l.trim()).filter(Boolean);
              const parsed = lines.map(line => {
                const colon = line.indexOf(':');
                if (colon === -1) return { label: '', text: line };
                return { label: line.slice(0, colon).trim(), text: line.slice(colon + 1).trim() };
              });
              return (
                <div className="border border-[#F9A825]/40 bg-[#FFFDE7] divide-y divide-[#F9A825]/20 text-xs">
                  {parsed.map((row, i) => (
                    <div key={i} className="flex gap-2 px-2.5 py-2 leading-relaxed">
                      {row.label && (
                        <span className="shrink-0 font-semibold text-[#B45309] w-14">{row.label}</span>
                      )}
                      <span className="text-[#333]">{row.text}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* ── Sentiment ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-[#333] uppercase tracking-wide">Sentiment</span>
            {sentimentLoading && <span className="text-[11px] text-[#999]">…</span>}
            {sentiment && !sentimentLoading && (
              <span className={`text-[11px] px-2 py-0.5 border rounded-full capitalize ${SENTIMENT_STYLE[sentiment] ?? SENTIMENT_STYLE.neutral}`}>
                {sentiment}
              </span>
            )}
            {!sentimentLoading && (
              <button onClick={loadSentiment} className="ml-auto text-[11px] text-[#999] hover:text-[#000]">↻</button>
            )}
          </div>

          {/* ── Related Tickets ────────────────────────────────────────── */}
          <div>
            <span className="text-[11px] font-semibold text-[#333] uppercase tracking-wide block mb-2">
              Related Tickets
            </span>
            {relatedLoading && <p className="text-[11px] text-[#999]">Loading…</p>}
            {!relatedLoading && related.length === 0 && (
              <p className="text-[11px] text-[#999]">None found</p>
            )}
            {!relatedLoading && related.map(t => (
              <div key={t.id} className="mb-2 p-2 border border-[#EAEAEA] text-xs">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-mono text-[10px] text-[#666]">{t.id.slice(0, 8)}…</span>
                  <span className="text-[10px] text-[#999]">{t.status?.replace(/_/g, ' ')}</span>
                </div>
                {t.customer_name && (
                  <p className="text-[#333] truncate">{t.customer_name}</p>
                )}
                {t.last_message && (
                  <p className="text-[#999] truncate mt-0.5">{t.last_message}</p>
                )}
              </div>
            ))}
          </div>

        </div>
      )}
    </section>
  );
}
