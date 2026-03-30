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

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeKind = 'message' | 'condition' | 'api_call' | 'handoff';

interface NodeData {
  kind: NodeKind;
  label: string;
  // message
  text?: string;
  // condition
  variable?: string;
  operator?: string;
  value?: string;
  // api_call
  endpoint?: string;
  method?: string;
  // handoff
  team?: string;
  // validation error
  error?: boolean;
}

// ── Node style helpers ────────────────────────────────────────────────────────

const KIND_LABEL: Record<NodeKind, string> = {
  message:   'Message',
  condition: 'Condition',
  api_call:  'API Call',
  handoff:   'Handoff',
};

const KIND_BORDER: Record<NodeKind, string> = {
  message:   'border-[#000]',
  condition: 'border-[#333]',
  api_call:  'border-[#666]',
  handoff:   'border-[#000]',
};

// ── Custom nodes ──────────────────────────────────────────────────────────────

function BaseNode({ data, children, selected }: NodeProps<NodeData> & { children: React.ReactNode }) {
  return (
    <div className={`bg-white border-2 ${data.error ? 'border-[#D32F2F]' : KIND_BORDER[data.kind]} rounded min-w-[160px] shadow-sm ${selected ? 'ring-2 ring-offset-1 ring-[#000]' : ''}`}>
      <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b ${data.error ? 'border-[#D32F2F] text-[#D32F2F]' : 'border-[#EAEAEA] text-[#333]'}`}>
        {KIND_LABEL[data.kind]}
        {data.error && <span className="ml-1 text-[#D32F2F]">!</span>}
      </div>
      <div className="px-3 py-2 text-xs text-[#000]">{children}</div>
    </div>
  );
}

function MessageNode(props: NodeProps<NodeData>) {
  return (
    <BaseNode {...props}>
      <Handle type="target" position={Position.Top} style={{ background: '#000' }} />
      <p className="truncate max-w-[140px]">{props.data.text || <span className="text-[#999]">Enter message…</span>}</p>
      <Handle type="source" position={Position.Bottom} style={{ background: '#000' }} />
    </BaseNode>
  );
}

function ConditionNode(props: NodeProps<NodeData>) {
  return (
    <BaseNode {...props}>
      <Handle type="target" position={Position.Top} style={{ background: '#000' }} />
      <p className="truncate max-w-[140px] font-mono text-[11px]">
        {props.data.variable || 'var'} {props.data.operator || '=='} {props.data.value || 'val'}
      </p>
      <div className="flex justify-between mt-1 text-[9px] text-[#999]">
        <span>True ↓</span><span>False ↓</span>
      </div>
      <Handle type="source" position={Position.Bottom} id="true"  style={{ background: '#2E7D32', left: '30%' }} />
      <Handle type="source" position={Position.Bottom} id="false" style={{ background: '#D32F2F', left: '70%' }} />
    </BaseNode>
  );
}

function ApiCallNode(props: NodeProps<NodeData>) {
  return (
    <BaseNode {...props}>
      <Handle type="target" position={Position.Top} style={{ background: '#000' }} />
      <p className="truncate max-w-[140px] font-mono text-[11px]">
        <span className="font-bold">{props.data.method || 'GET'}</span>{' '}
        {props.data.endpoint || '/endpoint'}
      </p>
      <Handle type="source" position={Position.Bottom} style={{ background: '#000' }} />
    </BaseNode>
  );
}

function HandoffNode(props: NodeProps<NodeData>) {
  return (
    <BaseNode {...props}>
      <Handle type="target" position={Position.Top} style={{ background: '#000' }} />
      <p className="text-xs font-semibold">→ {props.data.team || 'CS Team'}</p>
      <p className="text-[10px] text-[#999] mt-0.5">Hand off to human agent</p>
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
    <div className="w-[260px] shrink-0 border-l border-[#EAEAEA] p-4 flex items-center justify-center">
      <p className="text-xs text-[#999] text-center">Select a node to configure it</p>
    </div>
  );

  const d = node.data;
  const field = (label: string, key: keyof NodeData, placeholder = '') => (
    <div className="mb-3">
      <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">{label}</label>
      <input
        value={(d[key] as string) ?? ''}
        onChange={e => onChange(node.id, { [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full text-xs border border-[#CCC] px-2 py-1.5 outline-none focus:border-[#000] transition-colors"
      />
    </div>
  );

  return (
    <div className="w-[260px] shrink-0 border-l border-[#EAEAEA] flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-[#EAEAEA] flex items-center justify-between">
        <span className="text-xs font-bold text-[#000] uppercase tracking-wide">{KIND_LABEL[d.kind]}</span>
        <button onClick={() => onDelete(node.id)} className="text-[10px] text-[#999] hover:text-[#D32F2F] transition-colors">Delete</button>
      </div>
      <div className="px-4 py-3">
        {field('Label', 'label', 'Node label')}

        {d.kind === 'message' && (
          <div className="mb-3">
            <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">Message text</label>
            <textarea
              value={d.text ?? ''}
              onChange={e => onChange(node.id, { text: e.target.value })}
              placeholder="Bot sends this message…"
              className="w-full text-xs border border-[#CCC] px-2 py-1.5 outline-none focus:border-[#000] resize-none transition-colors"
              rows={4}
            />
          </div>
        )}

        {d.kind === 'condition' && (
          <>
            {field('Variable', 'variable', 'e.g. intent')}
            <div className="mb-3">
              <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">Operator</label>
              <select
                value={d.operator ?? '=='}
                onChange={e => onChange(node.id, { operator: e.target.value })}
                className="w-full text-xs border border-[#CCC] px-2 py-1.5 outline-none focus:border-[#000]"
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
              <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">Method</label>
              <select
                value={d.method ?? 'GET'}
                onChange={e => onChange(node.id, { method: e.target.value })}
                className="w-full text-xs border border-[#CCC] px-2 py-1.5 outline-none focus:border-[#000]"
              >
                {['GET', 'POST', 'PATCH'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {field('Endpoint', 'endpoint', '/api/...')}
          </>
        )}

        {d.kind === 'handoff' && (
          <div className="mb-3">
            <label className="text-[10px] text-[#999] uppercase tracking-wide block mb-1">Target team</label>
            <select
              value={d.team ?? 'cs'}
              onChange={e => onChange(node.id, { team: e.target.value })}
              className="w-full text-xs border border-[#CCC] px-2 py-1.5 outline-none focus:border-[#000]"
            >
              {['cs', 'kyc', 'finance', 'tech'].map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
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
    // Every non-start node must have an incoming edge
    if (!connectedTargets.has(node.id) && node.id !== 'start') {
      errors.push({ nodeId: node.id, message: `"${node.data.label || k}" has no incoming connection.` });
    }
    // Non-handoff nodes must have outgoing edges
    if (k !== 'handoff' && !connectedSources.has(node.id)) {
      errors.push({ nodeId: node.id, message: `"${node.data.label || k}" is a dead end. Connect it to proceed.` });
    }
    // Condition nodes need both true/false branches
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

// ── Initial nodes (Start node always present) ─────────────────────────────────

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
    (params: Connection) => setEdges(eds => addEdge({ ...params, style: { stroke: '#000' } }, eds)),
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
    if (id === 'start') return; // can't delete start
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  // Clear validation error highlights
  const clearErrors = () => {
    setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, error: false } })));
    setValidationErrors([]);
  };

  // Save draft
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

  // Publish (FR-16) — validate first
  const publish = async () => {
    clearErrors();
    const errors = validate(nodes, edges);
    if (errors.length) {
      // Highlight broken nodes in red
      const errorIds = new Set(errors.map(e => e.nodeId).filter(Boolean));
      setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, error: errorIds.has(n.id) } })));
      setValidationErrors(errors);
      setStatus('error');
      setStatusMsg(errors[0].message);
      return;
    }

    if (!flowIdRef.current) {
      // Auto-save first
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
        // Highlight broken nodes returned by server
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

  return (
    <div className="flex flex-1 overflow-hidden bg-white">

      {/* ── Left toolbar ────────────────────────────────────────────── */}
      <div className="w-[180px] shrink-0 border-r border-[#EAEAEA] flex flex-col">
        <div className="px-3 py-3 border-b border-[#EAEAEA]">
          <p className="text-[10px] text-[#999] uppercase tracking-wide mb-2">Flow name</p>
          <input
            value={flowName}
            onChange={e => setFlowName(e.target.value)}
            className="w-full text-xs border border-[#CCC] px-2 py-1.5 outline-none focus:border-[#000] transition-colors"
          />
        </div>

        <div className="px-3 py-3 border-b border-[#EAEAEA]">
          <p className="text-[10px] text-[#999] uppercase tracking-wide mb-2">Add node</p>
          <div className="space-y-1.5">
            {(['message', 'condition', 'api_call', 'handoff'] as NodeKind[]).map(k => (
              <button
                key={k}
                onClick={() => addNode(k)}
                className="w-full text-left text-xs border border-[#CCC] px-2 py-1.5 hover:border-[#000] hover:bg-[#fafafa] transition-colors"
              >
                + {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 py-3 space-y-2 mt-auto border-t border-[#EAEAEA]">
          <button
            onClick={saveDraft}
            disabled={status === 'saving' || status === 'publishing'}
            className="w-full text-xs border border-[#CCC] px-2 py-1.5 hover:border-[#000] transition-colors disabled:opacity-40"
          >
            {status === 'saving' ? 'Saving…' : 'Save Draft'}
          </button>
          <button
            onClick={publish}
            disabled={status === 'saving' || status === 'publishing'}
            className="w-full text-xs bg-[#000] text-white px-2 py-1.5 hover:bg-[#333] transition-colors disabled:opacity-40"
          >
            {status === 'publishing' ? 'Publishing…' : 'Publish'}
          </button>

          {/* Status message */}
          {status !== 'idle' && statusMsg && (
            <p className={`text-[10px] leading-snug ${status === 'error' ? 'text-[#D32F2F]' : status === 'ok' ? 'text-[#2E7D32]' : 'text-[#999]'}`}>
              {statusMsg}
            </p>
          )}
        </div>
      </div>

      {/* ── Canvas ──────────────────────────────────────────────────── */}
      <div className="flex-1 relative">
        {/* Validation error banner */}
        {validationErrors.length > 0 && (
          <div className="absolute top-0 left-0 right-0 z-10 bg-[#ffebee] border-b border-[#D32F2F] px-4 py-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                {validationErrors.map((e, i) => (
                  <p key={i} className="text-xs text-[#D32F2F]">• {e.message}</p>
                ))}
              </div>
              <button onClick={clearErrors} className="text-[#D32F2F] text-xs shrink-0">✕</button>
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
          style={{ background: '#fff' }}
          defaultEdgeOptions={{ style: { stroke: '#000', strokeWidth: 1.5 }, animated: false }}
        >
          <Background color="#f0f0f0" gap={16} />
          <Controls style={{ border: '1px solid #EAEAEA', borderRadius: 0 }} />
          <MiniMap
            nodeStrokeColor="#000"
            nodeColor="#fff"
            maskColor="rgba(0,0,0,0.05)"
            style={{ border: '1px solid #EAEAEA', borderRadius: 0 }}
          />
        </ReactFlow>
      </div>

      {/* ── Right sidebar — node config ──────────────────────────────── */}
      <NodeSidebar
        node={selectedNode}
        onChange={updateNodeData}
        onDelete={deleteNode}
      />
    </div>
  );
}
