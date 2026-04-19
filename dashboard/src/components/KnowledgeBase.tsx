import { useState, useEffect, useRef } from 'react';
import type { KnowledgeItem, KnowledgeSourceType } from '../types';
import { api } from '../api';
import type { AuthUser } from '../App';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function SourceBadge({ type }: { type: KnowledgeSourceType }) {
  const styles: Record<KnowledgeSourceType, string> = {
    url:  'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20',
    pdf:  'bg-brand/10 text-brand ring-1 ring-brand/20',
    docx: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',
  };
  const labels: Record<KnowledgeSourceType, string> = {
    url: 'URL', pdf: 'PDF', docx: 'DOCX',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${styles[type] ?? styles.url}`}>
      {labels[type] ?? type.toUpperCase()}
    </span>
  );
}

// ── Status banner ─────────────────────────────────────────────────────────────

interface StatusMsg { type: 'success' | 'error'; text: string }

function StatusBanner({ msg, onDismiss }: { msg: StatusMsg; onDismiss: () => void }) {
  const isError = msg.type === 'error';
  return (
    <div className={`flex items-start gap-2.5 rounded-md p-3 ring-1 ${
      isError
        ? 'bg-red-950/60 ring-red-800/60'
        : 'bg-green-950/60 ring-green-800/60'
    }`}>
      {isError ? (
        <svg className="w-4 h-4 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      ) : (
        <svg className="w-4 h-4 text-green-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )}
      <p className={`text-xs leading-relaxed flex-1 ${isError ? 'text-red-300' : 'text-green-300'}`}>{msg.text}</p>
      <button onClick={onDismiss} className="text-text-muted hover:text-text-secondary transition-colors shrink-0">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Add URL tab ───────────────────────────────────────────────────────────────

function AddUrlPanel({ onAdded }: { onAdded: (item: KnowledgeItem) => void }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setStatus(null);
    try {
      const item = await api.addKnowledgeUrl(trimmed);
      setStatus({ type: 'success', text: `Added "${item.title}" — ${item.chunk_count} chunk${item.chunk_count !== 1 ? 's' : ''} indexed.` });
      setUrl('');
      onAdded(item);
    } catch (err) {
      setStatus({ type: 'error', text: err instanceof Error ? err.message : 'Failed to scrape URL.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-text-secondary mb-4">
          Enter a public URL. The page content will be scraped, chunked, and added to the knowledge base so the AI can reference it when answering customer queries.
        </p>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="https://help.bitazza.com/article/..."
            className="flex-1 bg-surface-2 ring-1 ring-surface-5 text-text-primary px-3 py-2 text-sm rounded-md outline-none focus:ring-brand transition-all placeholder:text-text-muted"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="px-4 py-2 bg-brand hover:bg-brand-dim text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
          >
            {loading && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            {loading ? 'Scraping…' : 'Scrape & Add'}
          </button>
        </form>
      </div>
      {status && <StatusBanner msg={status} onDismiss={() => setStatus(null)} />}
    </div>
  );
}

// ── Upload file tab ───────────────────────────────────────────────────────────

function UploadFilePanel({ onAdded }: { onAdded: (item: KnowledgeItem) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'docx') {
      setStatus({ type: 'error', text: 'Only PDF and DOCX files are supported.' });
      return;
    }
    setFile(f);
    setStatus(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setStatus(null);
    try {
      const item = await api.uploadKnowledgeFile(file);
      setStatus({ type: 'success', text: `Added "${item.title}" — ${item.chunk_count} chunk${item.chunk_count !== 1 ? 's' : ''} indexed.` });
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onAdded(item);
    } catch (err) {
      setStatus({ type: 'error', text: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-secondary">
        Upload a PDF or DOCX file. Its content will be extracted and indexed into the knowledge base.
      </p>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${
          dragging
            ? 'border-brand bg-brand-subtle'
            : 'border-surface-5 bg-surface-2 hover:border-brand/50 hover:bg-surface-3'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />
        <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        {file ? (
          <div className="text-center">
            <p className="text-sm font-medium text-text-primary">{file.name}</p>
            <p className="text-xs text-text-muted mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm text-text-secondary">Drop a PDF or DOCX here, or click to browse</p>
            <p className="text-xs text-text-muted mt-1">Supported: .pdf, .docx</p>
          </div>
        )}
      </div>

      {file && (
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => { setFile(null); setStatus(null); if (inputRef.current) inputRef.current.value = ''; }}
            disabled={loading}
            className="px-3 py-1.5 text-sm ring-1 ring-surface-5 rounded-md hover:bg-surface-4 transition-colors text-text-secondary disabled:opacity-50"
          >
            Clear
          </button>
          <button
            onClick={handleUpload}
            disabled={loading}
            className="px-4 py-1.5 bg-brand hover:bg-brand-dim text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            {loading ? 'Indexing…' : 'Upload & Index'}
          </button>
        </div>
      )}

      {status && <StatusBanner msg={status} onDismiss={() => setStatus(null)} />}
    </div>
  );
}

// ── Chunks preview modal ──────────────────────────────────────────────────────

function ChunksModal({ item, onClose }: { item: KnowledgeItem; onClose: () => void }) {
  const [chunks, setChunks] = useState<{ index: number; text: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getKnowledgeChunks(item.id)
      .then(r => setChunks(r.chunks))
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load chunks'))
      .finally(() => setLoading(false));
  }, [item.id]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-6 animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-surface-3 ring-1 ring-surface-5 rounded-xl shadow-modal flex flex-col max-h-[80vh] animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-surface-5 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary truncate">{item.title}</h3>
            <p className="text-xs text-text-muted mt-0.5">
              {item.chunk_count} chunk{item.chunk_count !== 1 ? 's' : ''} indexed
              {item.source_ref && <> · <span className="font-mono">{item.source_ref.length > 50 ? item.source_ref.slice(0, 50) + '…' : item.source_ref}</span></>}
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-secondary transition-colors shrink-0 mt-0.5">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-text-muted text-sm">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Loading chunks…
            </div>
          ) : error ? (
            <p className="text-red-400 text-sm text-center py-8">{error}</p>
          ) : chunks.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-8">No chunks found in vector store.</p>
          ) : (
            chunks.map(chunk => (
              <div key={chunk.index} className="bg-surface-2 ring-1 ring-surface-5 rounded-md p-3">
                <div className="text-[10px] font-mono text-text-muted mb-1.5">Chunk {chunk.index + 1}</div>
                <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">{chunk.text}</p>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-surface-5 shrink-0 flex justify-end">
          <button onClick={onClose} className="px-4 py-1.5 text-sm ring-1 ring-surface-5 rounded-md hover:bg-surface-4 transition-colors text-text-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Items table ───────────────────────────────────────────────────────────────

function ItemsTable({ items, onDelete, onPreview }: { items: KnowledgeItem[]; onDelete: (id: number) => void; onPreview: (item: KnowledgeItem) => void }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <div className="w-12 h-12 rounded-full bg-surface-3 ring-1 ring-surface-5 flex items-center justify-center">
          <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        <div>
          <p className="text-text-primary text-sm font-medium">No knowledge items yet</p>
          <p className="text-text-muted text-xs mt-1">Add a URL or upload a document to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-5">
            <th className="text-left text-xs font-medium text-text-muted py-2.5 px-3">Title</th>
            <th className="text-left text-xs font-medium text-text-muted py-2.5 px-3">Type</th>
            <th className="text-left text-xs font-medium text-text-muted py-2.5 px-3">Source</th>
            <th className="text-right text-xs font-medium text-text-muted py-2.5 px-3">Chunks</th>
            <th className="text-left text-xs font-medium text-text-muted py-2.5 px-3">Added</th>
            <th className="py-2.5 px-3" />
            <th className="py-2.5 px-3" />
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} className="border-b border-surface-5/50 hover:bg-surface-3 transition-colors group">
              <td className="py-3 px-3">
                <span className="font-medium text-text-primary text-xs">{item.title}</span>
              </td>
              <td className="py-3 px-3">
                <SourceBadge type={item.source_type} />
              </td>
              <td className="py-3 px-3 max-w-[220px]">
                {item.source_ref ? (
                  <span
                    className="text-xs text-text-muted truncate block"
                    title={item.source_ref}
                  >
                    {item.source_ref.length > 40 ? item.source_ref.slice(0, 40) + '…' : item.source_ref}
                  </span>
                ) : (
                  <span className="text-xs text-text-muted">—</span>
                )}
              </td>
              <td className="py-3 px-3 text-right">
                <span className="text-xs text-text-secondary tabular-nums">{item.chunk_count}</span>
              </td>
              <td className="py-3 px-3">
                <span className="text-xs text-text-muted">{formatDate(item.created_at)}</span>
              </td>
              <td className="py-3 px-3 text-right">
                <button
                  onClick={() => onPreview(item)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-text-muted hover:text-accent-blue hover:bg-accent-blue/10"
                  title="Preview indexed chunks"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </td>
              <td className="py-3 px-3 text-right">
                <button
                  onClick={() => {
                    if (window.confirm(`Delete "${item.title}"? This will remove all ${item.chunk_count} indexed chunks from the knowledge base.`)) {
                      onDelete(item.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-text-muted hover:text-brand hover:bg-brand/10"
                  title="Delete"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const TABS = ['Add Knowledge', 'Knowledge Items'] as const;
type Tab = typeof TABS[number];

interface Props { currentUser: AuthUser }

export default function KnowledgeBase({ currentUser: _currentUser }: Props) {
  const [tab, setTab] = useState<Tab>('Add Knowledge');
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<StatusMsg | null>(null);
  const [previewItem, setPreviewItem] = useState<KnowledgeItem | null>(null);

  const canWrite = (_currentUser.permissions ?? []).some(
    p => p === 'knowledge.write' || p === 'knowledge.*' || p === '*'
  );

  const loadItems = async () => {
    setLoadingItems(true);
    try {
      const data = await api.listKnowledge();
      setItems(data);
    } catch { /* silent */ }
    finally { setLoadingItems(false); }
  };

  useEffect(() => { loadItems(); }, []);

  const handleAdded = (item: KnowledgeItem) => {
    setItems(prev => [item, ...prev]);
    // Switch to items tab after a short delay so user sees the success banner first
    setTimeout(() => setTab('Knowledge Items'), 1200);
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteKnowledge(id);
      setItems(prev => prev.filter(i => i.id !== id));
      setDeleteStatus({ type: 'success', text: 'Knowledge item deleted.' });
    } catch (err) {
      setDeleteStatus({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed.' });
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-surface-0">
      {previewItem && <ChunksModal item={previewItem} onClose={() => setPreviewItem(null)} />}
      <div className="max-w-4xl mx-auto space-y-5">

        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Knowledge Base</h2>
          <p className="text-xs text-text-muted mt-1">
            Manage the content the AI uses to answer customer questions. All indexed items are automatically retrieved during conversations.
          </p>
        </div>

        {/* Stats bar */}
        <div className="flex items-center gap-4 bg-surface-2 ring-1 ring-surface-5 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.966 8.966 0 00-6 2.292m0-14.25v14.25" />
            </svg>
            <span className="text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">{items.length}</span> item{items.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="w-px h-4 bg-surface-5" />
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">
                {items.reduce((sum, i) => sum + i.chunk_count, 0)}
              </span> total chunks indexed
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
            <span className="text-xs text-text-muted">RAG active</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-surface-2 ring-1 ring-surface-5 rounded-lg overflow-hidden">
          <div className="flex border-b border-surface-5">
            {TABS.map(t => (
              // Hide "Add Knowledge" tab for read-only users
              (t === 'Add Knowledge' && !canWrite) ? null : (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-3 text-sm font-medium transition-colors ${
                    tab === t
                      ? 'text-text-primary border-b-2 border-brand -mb-px'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {t}
                </button>
              )
            ))}
          </div>

          <div className="p-5">
            {tab === 'Add Knowledge' && canWrite && (
              <div className="space-y-8">
                {/* URL section */}
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1 flex items-center gap-2">
                    <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                    </svg>
                    Add from URL
                  </h3>
                  <AddUrlPanel onAdded={handleAdded} />
                </div>

                <div className="border-t border-surface-5" />

                {/* File section */}
                <div>
                  <h3 className="text-sm font-semibold text-text-primary mb-1 flex items-center gap-2">
                    <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    Upload Document
                  </h3>
                  <UploadFilePanel onAdded={handleAdded} />
                </div>
              </div>
            )}

            {tab === 'Knowledge Items' && (
              <div className="space-y-3">
                {deleteStatus && (
                  <StatusBanner msg={deleteStatus} onDismiss={() => setDeleteStatus(null)} />
                )}
                {loadingItems ? (
                  <div className="flex items-center justify-center py-12 gap-2 text-text-muted text-sm">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                    Loading…
                  </div>
                ) : (
                  <ItemsTable items={items} onDelete={handleDelete} onPreview={setPreviewItem} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
