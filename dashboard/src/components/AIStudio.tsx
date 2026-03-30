/**
 * AI Studio — FR-15 / FR-16
 * React Flow canvas with 4 node types: Message | Condition | API Call | Handoff
 * Publish → validate → POST /api/studio/flows/:id/publish
 */
import { useState, useCallback, useRef } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type NodeProps,
  type Connection,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Spinner } from './ui/Spinner';

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeKind = 'message' | 'condition' | 'api_call' | 'handoff';

interface NodeData {
  kind: NodeKind;
  label: string;
  text?: string;
  variable?: string;
  operator?: string;
  value?: string;
  endpoint?: string;
  method?: string;
  team?: string;
  error?: boolean;
}

// ── Node style config ─────────────────────────────────────────────────────────

const KIND_LABEL: Record<NodeKind, string> = {
  message:   'Message',
  condition: 'Condition',
  api_call:  'API Call',
  handoff:   'Handoff',
};

const KIND_ACCENT: Record<NodeKind, string> = {
  message:   '#3B82F6',
  condition: '#F59E0B',
  api_call:  '#8B5CF6',
  handoff:   '#22C55E',
};

const KIND_ICON: Record<NodeKind, string> = {
  message:   'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  condition: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  api_call:  'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
  handoff:   'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
};

// ── Custom nodes ──────────────────────────────────────────────────────────────

function BaseNode({ data, children, selected }: NodeProps<NodeData> & { children: React.ReactNode }) {
  const accent = data.error ? '#E63946' : KIND_ACCENT[data.kind];
  return (
    <div
      className={`bg-surface-3 rounded-lg min-w-[180px] shadow-panel transition-shadow ${
        selected ? 'ring-2 ring-brand shadow-modal' : 'ring-1 ring-surface-5'
      } ${data.error ? 'ring-brand/50' : ''}`}
    >
      {/* Node header with accent left border */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-surface-5 rounded-t-lg"
        style={{ borderLeft: `3px solid ${accent}` }}
      >
        <svg className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={KIND_ICON[data.kind]} />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
          {KIND_LABEL[data.kind]}
        </span>
        {data.error && (
          <span className="ml-auto text-brand text-[10px] font-bold">!</span>
        )}
      </div>
      <div className="px-3 py-2.5 text-xs text-text-primary">{children}</div>
    </div>
  );
}

const handleStyle = (color: string) => ({
  width: 10,
  height: 10,
  background: color,
  border: '2px solid var(--surface-3)',
});

function MessageNode(props: NodeProps<NodeData>) {
  return (
    <BaseNode {...props}>
      <Handle type="target" position={Position.Top} style={handleStyle(KIND_ACCENT.message)} />
      <p className="truncate max-w-[150px] text-text-secondary">
        {props.data.text || <span className="text-text-muted italic">Enter message…</span>}
      </p>
      <Handle type="source" position={Position.Bottom} style={handleStyle(KIND_ACCENT.message)} />
    </BaseNode>
  );
}

function ConditionNode(props: NodeProps<NodeData>) {
  return (
    <BaseNode {...props}>
      <Handle type="target" position={Position.Top} style={handleStyle(KIND_ACCENT.condition)} />
      <p className="truncate max-w-[150px] font-mono text-[11px] text-text-secondary">
        {props.data.variable || 'var'}{' '}
        <span className="text-accent-amber">{props.data.operator || '=='}</span>{' '}
        {props.data.value || 'val'}
      </p>
      <div className="flex justify-between mt-2 text-[9px] text-text-muted">
        <span className="text-accent-green font-medium">True ↓</span>
        <span className="text-brand font-medium">False ↓</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="true"
        style={{ ...handleStyle('#22C55E'), left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="false"
        style={{ ...handleStyle('#E63946'), left: '70%' }} />
    </BaseNode>
  );
}

function ApiCallNode(props: NodeProps<NodeData>) {
  return (
    <BaseNode {...props}>
      <Handle type="target" position={Position.Top} style={handleStyle(KIND_ACCENT.api_call)} />
      <p className="truncate max-w-[150px] font-mono text-[11px]">
        <span className="text-accent-amber font-bold">{props.data.method || 'GET'}</span>{' '}
        <span className="text-text-secondary">{props.data.endpoint || '/endpoint'}</span>
      </p>
      <Handle type="source" position={Position.Bottom} style={handleStyle(KIND_ACCENT.api_call)} />
    </BaseNode>
  );
}

function HandoffNode(props: NodeProps<NodeData>) {
  return (
    <BaseNode {...props}>
      <Handle type="target" position={Position.Top} style={handleStyle(KIND_ACCENT.handoff)} />
      <p className="text-xs font-semibold text-accent-green">→ {props.data.team || 'CS Team'}</p>
      <p className="text-[10px] text-text-muted mt-0.5">Hand off to human agent</p>
    </BaseNode>
  );
}

const NODE_TYPES = {
  message:   MessageNode,
  condition: ConditionNode,
  api_call:  ApiCallNode,
  handoff:   HandoffNode,
};

// ── Right sidebar — node config ───────────────────────────────────────────────

interface SidebarProps {
  node: Node<NodeData> | null;
  onChange: (id: string, data: Partial<NodeData>) => void;
  onDelete: (id: string) => void;
}

function NodeSidebar({ node, onChange, onDelete }: SidebarProps) {
  if (!node) return (
    <div className="w-[260px] shrink-0 border-l border-surface-5 bg-surface-1 flex items-center justify-center">
      <div className="text-center px-6">
        <svg className="w-8 h-8 text-text-muted mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"/>
        </svg>
        <p className="text-xs text-text-muted">Select a node to configure it</p>
      </div>
    </div>
  );

  const d = node.data;
  const accent = KIND_ACCENT[d.kind];

  const field = (label: string, key: keyof NodeData, placeholder = '') => (
    <div className="mb-3">
      <label className="text-[10px] text-text-muted uppercase tracking-wide block mb-1.5">{label}</label>
      <input
        value={(d[key] as string) ?? ''}
        onChange={e => onChange(node.id, { [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full text-xs bg-surface-2 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary placeholder:text-text-muted outline-none focus:ring-brand transition-all"
      />
    </div>
  );

  return (
    <div className="w-[260px] shrink-0 border-l border-surface-5 bg-surface-1 flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-surface-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: accent }} />
          <span className="text-xs font-semibold text-text-primary">{KIND_LABEL[d.kind]}</span>
        </div>
        {node.id !== 'start' && (
          <button
            onClick={() => onDelete(node.id)}
            className="text-[10px] text-text-muted hover:text-brand transition-colors"
          >
            Delete
          </button>
        )}
      </div>

      <div className="px-4 py-3 space-y-1">
        {field('Label', 'label', 'Node label')}

        {d.kind === 'message' && (
          <div className="mb-3">
            <label className="text-[10px] text-text-muted uppercase tracking-wide block mb-1.5">Message text</label>
            <textarea
              value={d.text ?? ''}
              onChange={e => onChange(node.id, { text: e.target.value })}
              placeholder="Bot sends this message…"
              className="w-full text-xs bg-surface-2 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary placeholder:text-text-muted outline-none focus:ring-brand resize-none transition-all"
              rows={4}
            />
          </div>
        )}

        {d.kind === 'condition' && (
          <>
            {field('Variable', 'variable', 'e.g. intent')}
            <div className="mb-3">
              <label className="text-[10px] text-text-muted uppercase tracking-wide block mb-1.5">Operator</label>
              <select
                value={d.operator ?? '=='}
                onChange={e => onChange(node.id, { operator: e.target.value })}
                className="w-full text-xs bg-surface-2 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary outline-none focus:ring-brand transition-all"
              >
                {['==', '!=', 'contains', 'starts_with', '>', '<'].map(op => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </div>
            {field('Value', 'value', 'e.g. kyc')}
          </>
        )}

        {d.kind === 'api_call' && (
          <>
            <div className="mb-3">
              <label className="text-[10px] text-text-muted uppercase tracking-wide block mb-1.5">Method</label>
              <select
                value={d.method ?? 'GET'}
                onChange={e => onChange(node.id, { method: e.target.value })}
                className="w-full text-xs bg-surface-2 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary outline-none focus:ring-brand transition-all"
              >
                {['GET', 'POST', 'PATCH'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {field('Endpoint', 'endpoint', '/api/...')}
          </>
        )}

        {d.kind === 'handoff' && (
          <div className="mb-3">
            <label className="text-[10px] text-text-muted uppercase tracking-wide block mb-1.5">Target team</label>
            <select
              value={d.team ?? 'cs'}
              onChange={e => onChange(node.id, { team: e.target.value })}
              className="w-full text-xs bg-surface-2 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary outline-none focus:ring-brand transition-all"
            >
              {['cs', 'kyc', 'finance', 'tech'].map(t => (
                <option key={t} value={t}>{t.toUpperCase()}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Validation (FR-16) ────────────────────────────────────────────────────────

interface ValidationError { nodeId: string; message: string }

function validate(nodes: Node<NodeData>[], edges: Edge[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const connectedTargets = new Set(edges.map(e => e.target));
  const connectedSources = new Set(edges.map(e => e.source));

  const hasHandoff = nodes.some(n => n.data.kind === 'handoff');
  if (!hasHandoff) {
    errors.push({ nodeId: '', message: 'Flow must contain at least one Handoff node.' });
  }

  for (const node of nodes) {
    const k = node.data.kind;
    if (!connectedTargets.has(node.id) && node.id !== 'start') {
      errors.push({ nodeId: node.id, message: `"${node.data.label || k}" has no incoming connection.` });
    }
    if (k !== 'handoff' && !connectedSources.has(node.id)) {
      errors.push({ nodeId: node.id, message: `"${node.data.label || k}" is a dead end. Connect it to proceed.` });
    }
    if (k === 'condition') {
      const outEdges = edges.filter(e => e.source === node.id);
      const hasTrue  = outEdges.some(e => e.sourceHandle === 'true');
      const hasFalse = outEdges.some(e => e.sourceHandle === 'false');
      if (!hasTrue || !hasFalse) {
        errors.push({ nodeId: node.id, message: `"${node.data.label || 'Condition'}" needs both True and False branches.` });
      }
    }
  }
  return errors;
}

// ── Initial nodes ─────────────────────────────────────────────────────────────

const INITIAL_NODES: Node<NodeData>[] = [
  {
    id: 'start',
    type: 'message',
    position: { x: 240, y: 40 },
    data: { kind: 'message', label: 'Start', text: 'Hello! How can I help you today?' },
  },
];

// ── Main component ────────────────────────────────────────────────────────────

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function getToken() {
  try { return (JSON.parse(localStorage.getItem('auth_user') ?? '{}')).token ?? ''; } catch { return ''; }
}

export default function AIStudio() {
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>(INITIAL_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode]  = useState<Node<NodeData> | null>(null);
  const [flowName, setFlowName]          = useState('Untitled Flow');
  const [status, setStatus]              = useState<'idle' | 'saving' | 'publishing' | 'ok' | 'error'>('idle');
  const [statusMsg, setStatusMsg]        = useState('');
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const flowIdRef = useRef<string | null>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge({
      ...params,
      style: { stroke: 'var(--surface-5)', strokeWidth: 2 },
      animated: false,
    }, eds)),
    [setEdges]
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  const addNode = (kind: NodeKind) => {
    const id = `${kind}-${Date.now()}`;
    const newNode: Node<NodeData> = {
      id,
      type: kind,
      position: { x: 100 + Math.random() * 300, y: 150 + Math.random() * 200 },
      data: { kind, label: KIND_LABEL[kind] },
    };
    setNodes(ns => [...ns, newNode]);
  };

  const updateNodeData = useCallback((id: string, data: Partial<NodeData>) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n));
    setSelectedNode(prev => prev?.id === id ? { ...prev, data: { ...prev.data, ...data } } : prev);
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    if (id === 'start') return;
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  const clearErrors = () => {
    setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, error: false } })));
    setValidationErrors([]);
  };

  const saveDraft = async () => {
    setStatus('saving'); clearErrors();
    const flow_json = { nodes, edges };
    try {
      const method = flowIdRef.current ? 'PATCH' : 'POST';
      const url    = flowIdRef.current
        ? `${API}/api/studio/flows/${flowIdRef.current}`
        : `${API}/api/studio/flows`;
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ name: flowName, flow_json }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const saved = await r.json();
      if (saved.id) flowIdRef.current = saved.id;
      setStatus('ok'); setStatusMsg('Draft saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (e) {
      setStatus('error'); setStatusMsg(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const publish = async () => {
    clearErrors();
    const errors = validate(nodes, edges);
    if (errors.length) {
      const errorIds = new Set(errors.map(e => e.nodeId).filter(Boolean));
      setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, error: errorIds.has(n.id) } })));
      setValidationErrors(errors);
      setStatus('error');
      setStatusMsg(errors[0].message);
      return;
    }

    if (!flowIdRef.current) {
      await saveDraft();
      if (!flowIdRef.current) return;
    }

    setStatus('publishing');
    try {
      const r = await fetch(`${API}/api/studio/flows/${flowIdRef.current}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        if (body.broken_node_ids?.length) {
          const ids = new Set(body.broken_node_ids as string[]);
          setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, error: ids.has(n.id) } })));
        }
        throw new Error(body.error ?? `${r.status}`);
      }
      setStatus('ok'); setStatusMsg('Flow published successfully.');
      setTimeout(() => setStatus('idle'), 3000);
    } catch (e) {
      setStatus('error'); setStatusMsg(e instanceof Error ? e.message : 'Publish failed');
    }
  };

  const isBusy = status === 'saving' || status === 'publishing';

  return (
    <div className="flex flex-1 overflow-hidden bg-surface-0">

      {/* ── Left toolbar ─────────────────────────────────────────────── */}
      <div className="w-[200px] shrink-0 border-r border-surface-5 bg-surface-1 flex flex-col">

        {/* Flow name */}
        <div className="px-3 py-3 border-b border-surface-5">
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-1.5">Flow name</p>
          <input
            value={flowName}
            onChange={e => setFlowName(e.target.value)}
            className="w-full text-xs bg-surface-2 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary outline-none focus:ring-brand transition-all"
          />
        </div>

        {/* Add nodes */}
        <div className="px-3 py-3 border-b border-surface-5">
          <p className="text-[10px] text-text-muted uppercase tracking-wide mb-2">Add node</p>
          <div className="space-y-1.5">
            {(['message', 'condition', 'api_call', 'handoff'] as NodeKind[]).map(k => (
              <button
                key={k}
                onClick={() => addNode(k)}
                className="w-full text-left text-xs bg-surface-2 ring-1 ring-surface-5 rounded px-2.5 py-2 hover:bg-surface-3 hover:ring-surface-4 transition-colors flex items-center gap-2 text-text-secondary hover:text-text-primary"
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: KIND_ACCENT[k] }} />
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-3 py-3 space-y-2 mt-auto border-t border-surface-5">
          <button
            onClick={saveDraft}
            disabled={isBusy}
            className="w-full text-xs bg-surface-3 ring-1 ring-surface-5 rounded px-3 py-2 hover:bg-surface-4 transition-colors disabled:opacity-40 text-text-secondary hover:text-text-primary flex items-center justify-center gap-1.5"
          >
            {status === 'saving' ? <><Spinner size="xs" /> Saving…</> : 'Save Draft'}
          </button>
          <button
            onClick={publish}
            disabled={isBusy}
            className="w-full text-xs bg-brand hover:bg-brand-dim text-white rounded px-3 py-2 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {status === 'publishing' ? <><Spinner size="xs" /> Publishing…</> : 'Publish Flow'}
          </button>

          {/* Status indicator */}
          {status !== 'idle' && statusMsg && (
            <div className={`flex items-center gap-1.5 text-[10px] leading-snug px-1 ${
              status === 'error' ? 'text-brand' :
              status === 'ok'    ? 'text-accent-green' :
              'text-text-muted'
            }`}>
              {status === 'ok' && (
                <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                </svg>
              )}
              {statusMsg}
            </div>
          )}
        </div>
      </div>

      {/* ── Canvas ───────────────────────────────────────────────────── */}
      <div className="flex-1 relative">

        {/* Validation error banner */}
        {validationErrors.length > 0 && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-brand/10 border-b border-brand/30 px-4 py-2.5 animate-slide-in-up">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-0.5">
                {validationErrors.map((e, i) => (
                  <p key={i} className="text-xs text-brand">• {e.message}</p>
                ))}
              </div>
              <button
                onClick={clearErrors}
                className="text-brand hover:text-brand-dim text-xs shrink-0 p-1 hover:bg-brand/10 rounded transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={NODE_TYPES}
          fitView
          style={{ background: 'var(--surface-0)' }}
          defaultEdgeOptions={{
            style: { stroke: 'var(--surface-5)', strokeWidth: 2 },
            animated: false,
          }}
        >
          <Background color="var(--surface-5)" gap={20} size={1} />
          <Controls
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-5)',
              borderRadius: 8,
            }}
          />
          <MiniMap
            nodeStrokeColor="var(--surface-5)"
            nodeColor="var(--surface-3)"
            maskColor="rgba(8,10,12,0.6)"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--surface-5)',
              borderRadius: 8,
            }}
          />
        </ReactFlow>
      </div>

      {/* ── Right sidebar — node config ───────────────────────────────── */}
      <NodeSidebar
        node={selectedNode}
        onChange={updateNodeData}
        onDelete={deleteNode}
      />
    </div>
  );
}
