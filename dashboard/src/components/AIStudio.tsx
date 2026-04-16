/**
 * AI Studio — Visual workflow builder (n8n / Make.com style)
 *
 * Layout:
 *   [WorkflowList 220px] | [Canvas flex-1] | [ConfigPanel 280px]
 *
 * Node types match the workflow engine:
 *   send_reply · ai_reply · account_lookup · condition
 *   escalate · wait_for_reply · wait_for_trigger · resolve_ticket · set_variable
 */
import {
  useState, useCallback, useRef, useEffect, type ReactNode,
} from 'react';
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

// ── Constants ─────────────────────────────────────────────────────────────────

const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

function getToken() {
  try { return (JSON.parse(localStorage.getItem('auth_user') ?? '{}')).token ?? ''; }
  catch { return ''; }
}

function authHeaders() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeKind =
  | 'send_reply' | 'ai_reply' | 'account_lookup' | 'condition'
  | 'escalate' | 'wait_for_reply' | 'wait_for_trigger' | 'resolve_ticket' | 'set_variable';

interface NodeData {
  kind: NodeKind;
  label: string;
  config: Record<string, unknown>;
  error?: boolean;
}

interface WorkflowSummary {
  id: string;
  name: string;
  published: boolean;
  trigger_channel: string;
  trigger_category: string;
  created_by_name: string | null;
  updated_at: string;
}

interface TestStep {
  node_id: string;
  kind: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  variables_after: Record<string, unknown>;
  error: string | null;
  paused: boolean;
  waiting_for: string | null;
}

interface TestResult {
  steps: TestStep[];
  completed: boolean;
  error: string | null;
}

// ── Node catalog ──────────────────────────────────────────────────────────────

interface NodeSpec {
  label: string;
  color: string;
  group: string;
  description: string;
  terminal?: boolean;      // no outgoing connection needed
  pauses?: boolean;        // pauses execution, waiting for input
}

const NODE_SPECS: Record<NodeKind, NodeSpec> = {
  send_reply:       { label: 'Send Reply',        color: '#3B82F6', group: 'Actions',    description: 'Send a fixed message to the customer' },
  ai_reply:         { label: 'AI Response',       color: '#8B5CF6', group: 'AI',         description: 'Let the AI engine handle a reply (pre+post filters enforced)' },
  account_lookup:   { label: 'Account Lookup',    color: '#6366F1', group: 'Account',    description: 'Fetch account info and store in variables' },
  condition:        { label: 'Condition',         color: '#F59E0B', group: 'Control',    description: 'Branch on a variable value (True / False)' },
  set_variable:     { label: 'Set Variable',      color: '#64748B', group: 'Control',    description: 'Store a value in a workflow variable' },
  escalate:         { label: 'Escalate',          color: '#EF4444', group: 'Escalation', description: 'Hand off to a human agent', terminal: true },
  wait_for_reply:   { label: 'Wait for Reply',    color: '#14B8A6', group: 'Wait',       description: 'Pause and wait for the next customer message', pauses: true, terminal: true },
  wait_for_trigger: { label: 'Wait for Trigger',  color: '#06B6D4', group: 'Wait',       description: 'Pause and wait for an external trigger (e.g. email verification)', pauses: true, terminal: true },
  resolve_ticket:   { label: 'Resolve Ticket',    color: '#22C55E', group: 'Actions',    description: 'Mark the ticket as resolved', terminal: true },
};

const GROUPS = ['AI', 'Actions', 'Account', 'Control', 'Wait', 'Escalation'];

const BUILT_IN_VARS = [
  'language', 'channel', 'category', 'user_id', 'conversation_id', 'user_message',
  'consecutive_low_confidence',
];
const ACCOUNT_VARS = ['account.kyc_status', 'account.balance', 'account.name', 'account.email', 'account.tier'];
const AI_VARS      = ['ai_reply', 'escalated', 'confidence', 'upgraded_category'];

const ALL_VARS = [...BUILT_IN_VARS, ...ACCOUNT_VARS, ...AI_VARS];

// ── Node icons ────────────────────────────────────────────────────────────────

const KIND_ICON: Record<NodeKind, string> = {
  send_reply:       'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  ai_reply:         'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  account_lookup:   'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  condition:        'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  escalate:         'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  wait_for_reply:   'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  wait_for_trigger: 'M13 10V3L4 14h7v7l9-11h-7z',
  resolve_ticket:   'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  set_variable:     'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
};

// ── Custom ReactFlow nodes ────────────────────────────────────────────────────

function NodeShell({
  data, selected, children,
}: { data: NodeData; selected: boolean; children: ReactNode }) {
  const spec  = NODE_SPECS[data.kind];
  const color = data.error ? '#EF4444' : spec.color;

  return (
    <div
      className={`bg-surface-2 rounded-lg min-w-[190px] max-w-[240px] shadow-card transition-all ${
        selected ? 'ring-2 shadow-panel' : 'ring-1 ring-surface-5'
      } ${data.error ? 'ring-red-500/60' : selected ? 'ring-brand' : ''}`}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-t-lg border-b border-surface-4"
        style={{ borderLeft: `3px solid ${color}` }}
      >
        <svg className="w-3.5 h-3.5 shrink-0" style={{ color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={KIND_ICON[data.kind]} />
        </svg>
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color }}>
          {spec.label}
        </span>
        {data.error && (
          <span className="ml-auto text-[10px] font-bold text-red-400">!</span>
        )}
      </div>
      <div className="px-3 py-2 text-xs text-text-secondary">{children}</div>
    </div>
  );
}

const hs = (color: string, extra?: object) => ({
  width: 10, height: 10,
  background: color,
  border: '2px solid var(--surface-2)',
  ...extra,
});

function SendReplyNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.send_reply.color)} />
      <p className="truncate text-text-muted italic">
        {(p.data.config.text as string) || 'Configure message…'}
      </p>
      <Handle type="source" position={Position.Bottom} style={hs(NODE_SPECS.send_reply.color)} />
    </NodeShell>
  );
}

function AiReplyNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.ai_reply.color)} />
      <p className="text-[11px] text-text-muted">AI handles reply with pre + post filters</p>
      <Handle type="source" position={Position.Bottom} style={hs(NODE_SPECS.ai_reply.color)} />
    </NodeShell>
  );
}

function AccountLookupNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.account_lookup.color)} />
      <p className="font-mono text-[11px] text-text-muted">
        {(p.data.config.tool as string) || 'select tool'}{' '}
        {p.data.config.store_as ? <span className="text-text-secondary">→ {p.data.config.store_as as string}</span> : null}
      </p>
      <Handle type="source" position={Position.Bottom} style={hs(NODE_SPECS.account_lookup.color)} />
    </NodeShell>
  );
}

function ConditionNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.condition.color)} />
      <p className="font-mono text-[11px]">
        <span className="text-text-secondary">{(p.data.config.variable as string) || 'var'}</span>
        {' '}<span className="text-amber-400">{(p.data.config.operator as string) || '=='}</span>{' '}
        <span className="text-text-secondary">{(p.data.config.value as string) || 'val'}</span>
      </p>
      <div className="flex justify-between mt-1.5 text-[9px] font-medium">
        <span className="text-green-400">True ↙</span>
        <span className="text-red-400">False ↘</span>
      </div>
      <Handle
        type="source" id="true" position={Position.Bottom}
        style={hs('#22C55E', { left: '28%' })}
      />
      <Handle
        type="source" id="false" position={Position.Bottom}
        style={hs('#EF4444', { left: '72%' })}
      />
    </NodeShell>
  );
}

function EscalateNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.escalate.color)} />
      <p className="text-[11px] text-red-400 font-semibold">→ Human agent</p>
      {p.data.config.reason && (
        <p className="text-[10px] text-text-muted truncate mt-0.5">{p.data.config.reason as string}</p>
      )}
    </NodeShell>
  );
}

function WaitForReplyNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.wait_for_reply.color)} />
      <p className="text-[11px] text-teal-400">Pause — await customer reply</p>
    </NodeShell>
  );
}

function WaitForTriggerNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.wait_for_trigger.color)} />
      <p className="text-[11px] text-cyan-400">
        {(p.data.config.trigger_type as string) || 'external_trigger'}
      </p>
    </NodeShell>
  );
}

function ResolveTicketNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.resolve_ticket.color)} />
      <p className="text-[11px] text-green-400 font-semibold">✓ Resolve ticket</p>
      {p.data.config.send_csat && (
        <p className="text-[10px] text-text-muted mt-0.5">+ Send CSAT survey</p>
      )}
    </NodeShell>
  );
}

function SetVariableNode(p: NodeProps<NodeData>) {
  return (
    <NodeShell {...p}>
      <Handle type="target" position={Position.Top} style={hs(NODE_SPECS.set_variable.color)} />
      <p className="font-mono text-[11px] text-text-secondary truncate">
        {(p.data.config.variable_name as string) || 'var'} = {(p.data.config.value as string) || '…'}
      </p>
      <Handle type="source" position={Position.Bottom} style={hs(NODE_SPECS.set_variable.color)} />
    </NodeShell>
  );
}

const NODE_TYPES = {
  send_reply: SendReplyNode,
  ai_reply: AiReplyNode,
  account_lookup: AccountLookupNode,
  condition: ConditionNode,
  escalate: EscalateNode,
  wait_for_reply: WaitForReplyNode,
  wait_for_trigger: WaitForTriggerNode,
  resolve_ticket: ResolveTicketNode,
  set_variable: SetVariableNode,
};

// ── Variable picker ───────────────────────────────────────────────────────────

function VarPicker({ onPick }: { onPick: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[10px] text-text-muted hover:text-text-secondary border border-surface-5 rounded px-1.5 py-0.5 transition-colors"
        title="Insert variable"
      >
        {'{{}}'}
      </button>
      {open && (
        <div className="absolute z-50 top-6 right-0 bg-surface-3 border border-surface-5 rounded-md shadow-modal w-48 py-1 max-h-52 overflow-y-auto">
          {ALL_VARS.map(v => (
            <button
              key={v}
              type="button"
              className="w-full text-left px-3 py-1 text-[11px] font-mono text-text-secondary hover:bg-surface-4 hover:text-text-primary transition-colors"
              onClick={() => { onPick(`{{${v}}}`); setOpen(false); }}
            >
              {v}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="text-[10px] text-text-muted uppercase tracking-wide block mb-1">
      {children}
    </label>
  );
}

function TextInput({
  value, onChange, placeholder, mono,
}: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full text-xs bg-surface-1 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary placeholder:text-text-muted outline-none focus:ring-brand transition-all ${mono ? 'font-mono' : ''}`}
    />
  );
}

function SelectInput({
  value, onChange, options,
}: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full text-xs bg-surface-1 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary outline-none focus:ring-brand transition-all"
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <FieldLabel>{label}</FieldLabel>
      {children}
    </div>
  );
}

function VarField({
  label, value, onChange, placeholder, mono,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <FieldLabel>{label}</FieldLabel>
        <VarPicker onPick={v => onChange(value + v)} />
      </div>
      <TextInput value={value} onChange={onChange} placeholder={placeholder} mono={mono} />
    </div>
  );
}

// ── NodeConfigPanel ───────────────────────────────────────────────────────────

interface ConfigPanelProps {
  node: Node<NodeData> | null;
  onChange: (id: string, config: Partial<Record<string, unknown>>, label?: string) => void;
  onDelete: (id: string) => void;
}

function NodeConfigPanel({ node, onChange, onDelete }: ConfigPanelProps) {
  if (!node) {
    return (
      <div className="w-[280px] shrink-0 border-l border-surface-5 bg-surface-1 flex items-center justify-center">
        <div className="text-center px-6 py-8">
          <svg className="w-9 h-9 text-text-muted mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
          </svg>
          <p className="text-xs text-text-muted">Select a node to configure it</p>
          <p className="text-[10px] text-text-muted mt-1 opacity-60">Or drag a module from the left panel</p>
        </div>
      </div>
    );
  }

  const spec   = NODE_SPECS[node.data.kind];
  const cfg    = node.data.config as Record<string, string>;
  const set    = (key: string, val: unknown) => onChange(node.id, { [key]: val });

  return (
    <div className="w-[280px] shrink-0 border-l border-surface-5 bg-surface-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-surface-5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: spec.color }} />
          <span className="text-xs font-semibold text-text-primary">{spec.label}</span>
        </div>
        <button
          onClick={() => onDelete(node.id)}
          className="text-[10px] text-text-muted hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-400/10"
        >
          Delete
        </button>
      </div>

      {/* Description */}
      <p className="text-[10px] text-text-muted px-4 py-2 border-b border-surface-5 shrink-0">{spec.description}</p>

      {/* Config fields */}
      <div className="px-4 py-3 overflow-y-auto flex-1">
        {/* Label (common) */}
        <FieldRow label="Label">
          <TextInput value={node.data.label} onChange={v => onChange(node.id, {}, v)} placeholder="Node label" />
        </FieldRow>

        {/* send_reply */}
        {node.data.kind === 'send_reply' && (
          <>
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <FieldLabel>Message text</FieldLabel>
                <VarPicker onPick={v => set('text', (cfg.text || '') + v)} />
              </div>
              <textarea
                value={cfg.text || ''}
                onChange={e => set('text', e.target.value)}
                placeholder="Message sent to the customer…"
                rows={4}
                className="w-full text-xs bg-surface-1 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary placeholder:text-text-muted outline-none focus:ring-brand resize-none transition-all"
              />
            </div>
          </>
        )}

        {/* ai_reply — informational only */}
        {node.data.kind === 'ai_reply' && (
          <div className="bg-surface-3 border border-surface-5 rounded-md px-3 py-2.5 text-[11px] text-text-muted space-y-1.5">
            <p className="font-medium text-text-secondary">Security invariants (not configurable)</p>
            <p>1. <span className="font-mono text-xs text-purple-400">security_filter</span> runs BEFORE generation</p>
            <p>2. <span className="font-mono text-xs text-purple-400">compliance_filter</span> runs AFTER generation</p>
            <p className="text-[10px] opacity-70 mt-1">Sets: <span className="font-mono">ai_reply · escalated · confidence · upgraded_category</span></p>
          </div>
        )}

        {/* account_lookup */}
        {node.data.kind === 'account_lookup' && (
          <>
            <FieldRow label="Tool">
              <SelectInput
                value={cfg.tool || 'profile'}
                onChange={v => set('tool', v)}
                options={[
                  { value: 'profile',      label: 'Profile (name, email, tier)' },
                  { value: 'kyc_status',   label: 'KYC Status' },
                  { value: 'balance',      label: 'Balance' },
                  { value: 'transactions', label: 'Transactions' },
                  { value: 'limits',       label: 'Limits' },
                ]}
              />
            </FieldRow>
            <FieldRow label="Store result as">
              <TextInput
                value={cfg.store_as || 'account'}
                onChange={v => set('store_as', v)}
                placeholder="account"
                mono
              />
            </FieldRow>
          </>
        )}

        {/* condition */}
        {node.data.kind === 'condition' && (
          <>
            <VarField
              label="Variable"
              value={cfg.variable || ''}
              onChange={v => set('variable', v)}
              placeholder="e.g. account.kyc_status"
              mono
            />
            <FieldRow label="Operator">
              <SelectInput
                value={cfg.operator || '=='}
                onChange={v => set('operator', v)}
                options={[
                  { value: '==',          label: '== (equals)' },
                  { value: '!=',          label: '!= (not equals)' },
                  { value: 'contains',    label: 'contains' },
                  { value: 'starts_with', label: 'starts_with' },
                  { value: '>',           label: '> (greater than)' },
                  { value: '<',           label: '< (less than)' },
                ]}
              />
            </FieldRow>
            <VarField
              label="Value"
              value={cfg.value || ''}
              onChange={v => set('value', v)}
              placeholder="e.g. approved"
            />
            <div className="bg-surface-3 border border-surface-5 rounded px-2.5 py-2 text-[10px] text-text-muted">
              Connect the <span className="text-green-400 font-mono">True</span> handle to the left and{' '}
              <span className="text-red-400 font-mono">False</span> handle to the right.
            </div>
          </>
        )}

        {/* escalate */}
        {node.data.kind === 'escalate' && (
          <>
            <VarField
              label="Reason (optional)"
              value={cfg.reason || ''}
              onChange={v => set('reason', v)}
              placeholder="e.g. KYC verification required"
            />
            <FieldRow label="Team">
              <SelectInput
                value={cfg.team || 'cs'}
                onChange={v => set('team', v)}
                options={[
                  { value: 'cs',      label: 'CS (default)' },
                  { value: 'kyc',     label: 'KYC Team' },
                  { value: 'finance', label: 'Finance' },
                  { value: 'tech',    label: 'Tech Support' },
                ]}
              />
            </FieldRow>
          </>
        )}

        {/* wait_for_reply — no config */}
        {node.data.kind === 'wait_for_reply' && (
          <div className="bg-surface-3 border border-surface-5 rounded px-2.5 py-2 text-[10px] text-text-muted">
            Execution pauses here. When the customer sends their next message, the workflow resumes from the node after this one.
          </div>
        )}

        {/* wait_for_trigger */}
        {node.data.kind === 'wait_for_trigger' && (
          <>
            <FieldRow label="Trigger type">
              <SelectInput
                value={cfg.trigger_type || 'email_verification'}
                onChange={v => set('trigger_type', v)}
                options={[
                  { value: 'email_verification', label: 'Email verification' },
                  { value: 'custom',             label: 'Custom external trigger' },
                ]}
              />
            </FieldRow>
            <FieldRow label="Store token as">
              <TextInput
                value={cfg.token_variable || 'verification_token'}
                onChange={v => set('token_variable', v)}
                placeholder="verification_token"
                mono
              />
            </FieldRow>
          </>
        )}

        {/* resolve_ticket */}
        {node.data.kind === 'resolve_ticket' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!cfg.send_csat}
              onChange={e => set('send_csat', e.target.checked)}
              className="accent-brand"
            />
            <span className="text-xs text-text-secondary">Send CSAT survey after resolving</span>
          </label>
        )}

        {/* set_variable */}
        {node.data.kind === 'set_variable' && (
          <>
            <FieldRow label="Variable name">
              <TextInput
                value={cfg.variable_name || ''}
                onChange={v => set('variable_name', v)}
                placeholder="e.g. intent"
                mono
              />
            </FieldRow>
            <VarField
              label="Value"
              value={cfg.value || ''}
              onChange={v => set('value', v)}
              placeholder="e.g. {{user_message}} or literal"
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── WorkflowList ──────────────────────────────────────────────────────────────

interface WorkflowListProps {
  workflows: WorkflowSummary[];
  activeId: string | null;
  loading: boolean;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function WorkflowList({ workflows, activeId, loading, onCreate, onSelect, onDelete }: WorkflowListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-surface-5 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Workflows</span>
        <button
          onClick={onCreate}
          className="text-[10px] bg-brand hover:bg-brand-dim text-white rounded px-2 py-1 transition-colors font-medium"
        >
          + New
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Spinner size="sm" />
          </div>
        )}
        {!loading && workflows.length === 0 && (
          <div className="text-center px-4 py-8">
            <p className="text-[11px] text-text-muted">No workflows yet</p>
            <p className="text-[10px] text-text-muted opacity-60 mt-1">Click + New to create one</p>
          </div>
        )}
        {workflows.map(wf => (
          <div
            key={wf.id}
            className={`group relative px-3 py-2.5 cursor-pointer transition-colors border-l-2 ${
              activeId === wf.id
                ? 'bg-surface-3 border-brand'
                : 'border-transparent hover:bg-surface-2 hover:border-surface-5'
            }`}
            onClick={() => onSelect(wf.id)}
          >
            <div className="flex items-start justify-between gap-1">
              <p className={`text-xs font-medium truncate ${activeId === wf.id ? 'text-text-primary' : 'text-text-secondary'}`}>
                {wf.name}
              </p>
              <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                wf.published
                  ? 'bg-green-500/15 text-green-400'
                  : 'bg-surface-5 text-text-muted'
              }`}>
                {wf.published ? 'Live' : 'Draft'}
              </span>
            </div>
            <p className="text-[10px] text-text-muted mt-0.5">
              {wf.trigger_channel} · {wf.trigger_category}
            </p>
            {/* Delete button (hover) */}
            <button
              onClick={e => { e.stopPropagation(); onDelete(wf.id); }}
              className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-text-muted hover:text-red-400 p-1 rounded hover:bg-red-400/10"
              title="Delete workflow"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── NodePalette ───────────────────────────────────────────────────────────────

function NodePalette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  return (
    <div className="border-t border-surface-5 flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-surface-5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">Modules</span>
      </div>
      <div className="overflow-y-auto max-h-[320px] py-1">
        {GROUPS.map(group => {
          const entries = (Object.entries(NODE_SPECS) as [NodeKind, NodeSpec][])
            .filter(([, s]) => s.group === group);
          if (!entries.length) return null;
          return (
            <div key={group} className="px-2 py-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-text-muted px-1 mb-1">{group}</p>
              {entries.map(([kind, spec]) => (
                <button
                  key={kind}
                  onClick={() => onAdd(kind)}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-3 transition-colors group"
                >
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: spec.color }} />
                  <span className="text-[11px] text-text-secondary group-hover:text-text-primary">{spec.label}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── TestRunPanel ──────────────────────────────────────────────────────────────

interface TestRunPanelProps {
  workflowId: string | null;
  onClose: () => void;
}

function TestRunPanel({ workflowId, onClose }: TestRunPanelProps) {
  const [sampleMessage, setSampleMessage] = useState('Hello, I need help with my KYC verification');
  const [channel,  setChannel]  = useState('widget');
  const [category, setCategory] = useState('kyc_verification');
  const [language, setLanguage] = useState('en');
  const [running,  setRunning]  = useState(false);
  const [result,   setResult]   = useState<TestResult | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const run = async () => {
    if (!workflowId) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch(`${API}/api/studio/flows/${workflowId}/test-run`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ sample_message: sampleMessage, channel, category, language }),
      });
      const data = await r.json();
      setResult(data);
      // Auto-expand error steps
      const errIds = new Set(
        (data.steps as TestStep[]).filter(s => s.error).map(s => s.node_id)
      );
      setExpanded(errIds);
    } catch (e) {
      setResult({ steps: [], completed: false, error: String(e) });
    } finally {
      setRunning(false);
    }
  };

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="absolute inset-x-0 bottom-0 bg-surface-1 border-t border-surface-5 flex flex-col shadow-modal"
      style={{ height: '42%', zIndex: 20 }}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-5 shrink-0">
        <span className="text-xs font-semibold text-text-primary">Test Run</span>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: inputs */}
        <div className="w-[300px] shrink-0 border-r border-surface-5 px-4 py-3 space-y-3 overflow-y-auto">
          <div>
            <FieldLabel>Sample message</FieldLabel>
            <textarea
              value={sampleMessage}
              onChange={e => setSampleMessage(e.target.value)}
              rows={3}
              className="w-full text-xs bg-surface-2 ring-1 ring-surface-5 rounded px-2.5 py-1.5 text-text-primary outline-none focus:ring-brand resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <FieldLabel>Channel</FieldLabel>
              <SelectInput value={channel} onChange={setChannel} options={[
                { value: 'widget', label: 'Widget' },
                { value: 'email',  label: 'Email' },
              ]} />
            </div>
            <div>
              <FieldLabel>Language</FieldLabel>
              <SelectInput value={language} onChange={setLanguage} options={[
                { value: 'en', label: 'EN' },
                { value: 'th', label: 'TH' },
              ]} />
            </div>
          </div>
          <div>
            <FieldLabel>Category</FieldLabel>
            <SelectInput value={category} onChange={setCategory} options={[
              { value: 'any',                label: 'Any' },
              { value: 'kyc_verification',   label: 'KYC Verification' },
              { value: 'account_restriction',label: 'Account Restriction' },
              { value: 'password_2fa_reset', label: '2FA / Password Reset' },
              { value: 'withdrawal_issue',   label: 'Withdrawal Issue' },
              { value: 'fraud_security',     label: 'Fraud / Security' },
              { value: 'other',              label: 'Other' },
            ]} />
          </div>
          <button
            onClick={run}
            disabled={running || !workflowId}
            className="w-full text-xs bg-brand hover:bg-brand-dim text-white rounded px-3 py-2 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {running ? <><Spinner size="xs" /> Running…</> : '▶  Run Test'}
          </button>
        </div>

        {/* Right: results */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {!result && !running && (
            <div className="flex items-center justify-center h-full text-text-muted text-xs">
              Configure inputs and click Run Test
            </div>
          )}
          {result && (
            <>
              {/* Summary badge */}
              <div className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full mb-3 ${
                result.error
                  ? 'bg-red-500/15 text-red-400'
                  : result.completed
                  ? 'bg-green-500/15 text-green-400'
                  : 'bg-amber-500/15 text-amber-400'
              }`}>
                {result.error ? '✕ Error' : result.completed ? '✓ Completed' : '⏸ Paused'}
                {result.error && <span className="opacity-70"> — {result.error}</span>}
              </div>

              {/* Steps */}
              <div className="space-y-2">
                {result.steps.map((step, i) => {
                  const spec  = NODE_SPECS[step.kind as NodeKind];
                  const color = spec?.color || '#64748B';
                  const isExp = expanded.has(step.node_id);
                  return (
                    <div
                      key={step.node_id + i}
                      className={`border rounded-md overflow-hidden ${
                        step.error ? 'border-red-500/40' : step.paused ? 'border-amber-500/40' : 'border-surface-5'
                      }`}
                    >
                      {/* Step header */}
                      <button
                        className="w-full flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-3 transition-colors text-left"
                        onClick={() => toggle(step.node_id)}
                      >
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                          style={{ background: color }}>
                          {i + 1}
                        </div>
                        <span className="text-xs text-text-secondary font-medium" style={{ color }}>
                          {spec?.label || step.kind}
                        </span>
                        {step.error  && <span className="ml-auto text-[10px] text-red-400 font-medium">Error</span>}
                        {step.paused && <span className="ml-auto text-[10px] text-amber-400 font-medium">Paused — {step.waiting_for}</span>}
                        {!step.error && !step.paused && step.output && (
                          <span className="ml-auto text-[10px] text-text-muted">
                            {Object.keys(step.output).join(', ') || '—'}
                          </span>
                        )}
                        <svg className={`w-3 h-3 text-text-muted transition-transform ${isExp ? 'rotate-180' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {/* Expanded detail */}
                      {isExp && (
                        <div className="px-3 pb-3 pt-2 bg-surface-1 space-y-2 font-mono text-[10px] text-text-muted">
                          {step.error && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5 text-red-400">
                              {step.error}
                            </div>
                          )}
                          {step.output && Object.keys(step.output).length > 0 && (
                            <div>
                              <p className="text-[9px] uppercase tracking-wider mb-1 text-text-muted">Output</p>
                              <pre className="whitespace-pre-wrap break-all text-text-secondary bg-surface-2 rounded px-2 py-1.5 overflow-auto max-h-24">
                                {JSON.stringify(step.output, null, 2)}
                              </pre>
                            </div>
                          )}
                          <div>
                            <p className="text-[9px] uppercase tracking-wider mb-1 text-text-muted">Variables after</p>
                            <pre className="whitespace-pre-wrap break-all text-text-secondary bg-surface-2 rounded px-2 py-1.5 overflow-auto max-h-24">
                              {JSON.stringify(step.variables_after, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

interface ToolbarProps {
  name: string;
  onNameChange: (v: string) => void;
  triggerChannel: string;
  onChannelChange: (v: string) => void;
  triggerCategory: string;
  onCategoryChange: (v: string) => void;
  published: boolean;
  saving: boolean;
  publishing: boolean;
  onSave: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onTestRun: () => void;
  statusMsg: string;
  statusKind: 'idle' | 'ok' | 'error';
}

function Toolbar(p: ToolbarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-surface-5 bg-surface-1 shrink-0">
      {/* Workflow name */}
      <input
        value={p.name}
        onChange={e => p.onNameChange(e.target.value)}
        className="text-sm font-semibold bg-transparent outline-none border-b border-transparent focus:border-brand text-text-primary transition-colors w-48 truncate"
        placeholder="Workflow name"
      />

      <div className="h-4 w-px bg-surface-5 mx-1" />

      {/* Trigger channel */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-muted uppercase tracking-wide">Channel</span>
        <select
          value={p.triggerChannel}
          onChange={e => p.onChannelChange(e.target.value)}
          className="text-xs bg-surface-2 border border-surface-5 rounded px-2 py-1 text-text-primary outline-none focus:border-brand transition-colors"
        >
          <option value="any">Any</option>
          <option value="widget">Widget</option>
          <option value="email">Email</option>
        </select>
      </div>

      {/* Trigger category */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-muted uppercase tracking-wide">Category</span>
        <select
          value={p.triggerCategory}
          onChange={e => p.onCategoryChange(e.target.value)}
          className="text-xs bg-surface-2 border border-surface-5 rounded px-2 py-1 text-text-primary outline-none focus:border-brand transition-colors"
        >
          <option value="any">Any</option>
          <option value="kyc_verification">KYC</option>
          <option value="account_restriction">Account Restriction</option>
          <option value="password_2fa_reset">2FA / Password</option>
          <option value="withdrawal_issue">Withdrawal</option>
          <option value="fraud_security">Fraud / Security</option>
          <option value="other">Other</option>
        </select>
      </div>

      {/* Status message */}
      {p.statusMsg && (
        <span className={`text-[10px] ml-1 ${
          p.statusKind === 'ok'    ? 'text-green-400' :
          p.statusKind === 'error' ? 'text-red-400' : 'text-text-muted'
        }`}>
          {p.statusMsg}
        </span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={p.onTestRun}
          className="text-xs bg-surface-3 hover:bg-surface-4 text-text-secondary hover:text-text-primary border border-surface-5 rounded px-3 py-1.5 transition-colors flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Test
        </button>
        <button
          onClick={p.onSave}
          disabled={p.saving}
          className="text-xs bg-surface-3 hover:bg-surface-4 text-text-secondary hover:text-text-primary border border-surface-5 rounded px-3 py-1.5 transition-colors disabled:opacity-40"
        >
          {p.saving ? 'Saving…' : 'Save'}
        </button>
        {p.published ? (
          <button
            onClick={p.onUnpublish}
            disabled={p.publishing}
            className="text-xs bg-amber-500/15 hover:bg-amber-500/25 text-amber-400 border border-amber-500/30 rounded px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            Unpublish
          </button>
        ) : (
          <button
            onClick={p.onPublish}
            disabled={p.publishing}
            className="text-xs bg-brand hover:bg-brand-dim text-white rounded px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            {p.publishing ? 'Publishing…' : 'Publish'}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main AIStudio ─────────────────────────────────────────────────────────────

export default function AIStudio() {
  // ── Workflow list ──
  const [workflows, setWorkflows]     = useState<WorkflowSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [activeId, setActiveId]       = useState<string | null>(null);

  // ── Canvas ──
  const [nodes, setNodes, onNodesChange] = useNodesState<NodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode]  = useState<Node<NodeData> | null>(null);

  // ── Workflow meta ──
  const [wfName,     setWfName]     = useState('Untitled Workflow');
  const [channel,    setChannel]    = useState('any');
  const [category,   setCategory]   = useState('any');
  const [published,  setPublished]  = useState(false);

  // ── UI state ──
  const [saving,     setSaving]     = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [statusMsg,  setStatusMsg]  = useState('');
  const [statusKind, setStatusKind] = useState<'idle' | 'ok' | 'error'>('idle');
  const [showTest,   setShowTest]   = useState(false);
  const [errorIds,   setErrorIds]   = useState<Set<string>>(new Set());

  const idRef = useRef<string | null>(null);

  // ── Fetch workflow list ──
  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const r = await fetch(`${API}/api/studio/flows`, { headers: { Authorization: `Bearer ${getToken()}` } });
      if (r.ok) setWorkflows(await r.json());
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // ── Load workflow onto canvas ──
  const loadWorkflow = useCallback(async (id: string) => {
    const r = await fetch(`${API}/api/studio/flows/${id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) return;
    const wf = await r.json();

    idRef.current = wf.id;
    setActiveId(wf.id);
    setWfName(wf.name);
    setChannel(wf.trigger_channel || 'any');
    setCategory(wf.trigger_category || 'any');
    setPublished(!!wf.published);

    const rawNodes = (typeof wf.nodes_json === 'string' ? JSON.parse(wf.nodes_json) : wf.nodes_json) ?? [];
    const rawEdges = (typeof wf.edges_json === 'string' ? JSON.parse(wf.edges_json) : wf.edges_json) ?? [];

    // Normalize nodes: support both canvas format (type/data) and engine format (kind/config)
    const canvasNodes: Node<NodeData>[] = rawNodes.map((n: Record<string, unknown>) => {
      const kind  = (n.kind || n.type) as NodeKind;
      const data  = n.data as Record<string, unknown> | undefined;
      const cfg   = (n.config as Record<string, unknown>) || (data as Record<string, unknown>) || {};
      return {
        id:       n.id as string,
        type:     kind,
        position: (n.position as { x: number; y: number }) || { x: 100, y: 100 },
        data: {
          kind,
          label: (data?.label as string) || (cfg.label as string) || NODE_SPECS[kind]?.label || kind,
          config: cfg,
        },
      };
    });

    setNodes(canvasNodes);
    setEdges(rawEdges.map((e: Record<string, unknown>) => ({
      id:           e.id as string || `e-${e.source}-${e.target}`,
      source:       e.source as string,
      target:       e.target as string,
      sourceHandle: e.sourceHandle as string | undefined,
      style:        { stroke: 'var(--surface-5)', strokeWidth: 2 },
    })));
    setSelectedNode(null);
    setErrorIds(new Set());
    setStatusMsg('');
  }, [setNodes, setEdges]);

  // ── Create new workflow ──
  const createWorkflow = async () => {
    const r = await fetch(`${API}/api/studio/flows`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name: 'Untitled Workflow', trigger_channel: 'any', trigger_category: 'any' }),
    });
    if (!r.ok) return;
    const { id } = await r.json();
    await loadList();
    await loadWorkflow(id);
  };

  // ── Delete workflow ──
  const deleteWorkflow = async (id: string) => {
    if (!confirm('Delete this workflow? This cannot be undone.')) return;
    await fetch(`${API}/api/studio/flows/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (idRef.current === id) {
      idRef.current = null;
      setActiveId(null);
      setNodes([]);
      setEdges([]);
    }
    await loadList();
  };

  // ── Save draft ──
  const saveDraft = async () => {
    setSaving(true);
    setStatusMsg('');
    const canvasNodes = nodes.map(n => ({
      id:       n.id,
      type:     n.data.kind,
      position: n.position,
      data:     { label: n.data.label, ...n.data.config },
    }));
    const canvasEdges = edges;
    try {
      if (idRef.current) {
        await fetch(`${API}/api/studio/flows/${idRef.current}`, {
          method: 'PATCH',
          headers: authHeaders(),
          body: JSON.stringify({
            name: wfName,
            trigger_channel: channel,
            trigger_category: category,
            nodes_json: canvasNodes,
            edges_json: canvasEdges,
          }),
        });
      } else {
        const r = await fetch(`${API}/api/studio/flows`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            name: wfName,
            trigger_channel: channel,
            trigger_category: category,
            nodes_json: canvasNodes,
            edges_json: canvasEdges,
          }),
        });
        if (r.ok) {
          const { id } = await r.json();
          idRef.current = id;
          setActiveId(id);
          await loadList();
        }
      }
      setStatusMsg('Saved'); setStatusKind('ok');
      setTimeout(() => setStatusMsg(''), 2500);
    } catch {
      setStatusMsg('Save failed'); setStatusKind('error');
    } finally {
      setSaving(false);
    }
  };

  // ── Publish ──
  const publish = async () => {
    if (!idRef.current) { await saveDraft(); if (!idRef.current) return; }
    setPublishing(true);
    setErrorIds(new Set());
    try {
      const r = await fetch(`${API}/api/studio/flows/${idRef.current}/publish`, {
        method: 'POST', headers: { Authorization: `Bearer ${getToken()}` },
      });
      const body = await r.json();
      if (!r.ok) {
        if (body.broken_node_ids?.length) {
          setErrorIds(new Set(body.broken_node_ids));
          setNodes(ns => ns.map(n => ({ ...n, data: { ...n.data, error: body.broken_node_ids.includes(n.id) } })));
        }
        setStatusMsg(body.error || 'Publish failed'); setStatusKind('error');
        return;
      }
      setPublished(true);
      setStatusMsg('Published!'); setStatusKind('ok');
      await loadList();
      setTimeout(() => setStatusMsg(''), 3000);
    } finally {
      setPublishing(false);
    }
  };

  // ── Unpublish ──
  const unpublish = async () => {
    if (!idRef.current) return;
    await fetch(`${API}/api/studio/flows/${idRef.current}/unpublish`, {
      method: 'POST', headers: { Authorization: `Bearer ${getToken()}` },
    });
    setPublished(false);
    setStatusMsg('Unpublished'); setStatusKind('ok');
    await loadList();
    setTimeout(() => setStatusMsg(''), 2500);
  };

  // ── Canvas callbacks ──
  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge({
      ...params,
      style: { stroke: 'var(--surface-5)', strokeWidth: 2 },
    }, eds)),
    [setEdges],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node<NodeData>) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => setSelectedNode(null), []);

  // ── Node mutations ──
  const addNode = (kind: NodeKind) => {
    if (!idRef.current && !activeId) {
      alert('Create or select a workflow first.');
      return;
    }
    const id = `${kind}-${Date.now()}`;
    setNodes(ns => [...ns, {
      id,
      type: kind,
      position: { x: 200 + Math.random() * 250, y: 120 + Math.random() * 200 },
      data: { kind, label: NODE_SPECS[kind].label, config: {} },
    }]);
  };

  const updateNode = useCallback((id: string, config: Partial<Record<string, unknown>>, label?: string) => {
    setNodes(ns => ns.map(n => {
      if (n.id !== id) return n;
      const newData = {
        ...n.data,
        config: { ...n.data.config, ...config },
        ...(label !== undefined ? { label } : {}),
      };
      return { ...n, data: newData };
    }));
    setSelectedNode(prev => {
      if (!prev || prev.id !== id) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          config: { ...prev.data.config, ...config },
          ...(label !== undefined ? { label } : {}),
        },
      };
    });
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes(ns => ns.filter(n => n.id !== id));
    setEdges(es => es.filter(e => e.source !== id && e.target !== id));
    setSelectedNode(null);
  }, [setNodes, setEdges]);

  // ── Render ────────────────────────────────────────────────────────────────

  const noWorkflowLoaded = !idRef.current && !activeId;

  return (
    <div className="flex flex-1 overflow-hidden bg-surface-0">

      {/* ── Left panel: workflow list + node palette ── */}
      <div className="w-[220px] shrink-0 border-r border-surface-5 bg-surface-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <WorkflowList
            workflows={workflows}
            activeId={activeId}
            loading={listLoading}
            onCreate={createWorkflow}
            onSelect={loadWorkflow}
            onDelete={deleteWorkflow}
          />
        </div>
        <NodePalette onAdd={addNode} />
      </div>

      {/* ── Center: canvas ── */}
      <div className="flex-1 flex flex-col relative overflow-hidden">

        {/* Top toolbar (only when a workflow is loaded) */}
        {!noWorkflowLoaded && (
          <Toolbar
            name={wfName}
            onNameChange={setWfName}
            triggerChannel={channel}
            onChannelChange={setChannel}
            triggerCategory={category}
            onCategoryChange={setCategory}
            published={published}
            saving={saving}
            publishing={publishing}
            onSave={saveDraft}
            onPublish={publish}
            onUnpublish={unpublish}
            onTestRun={() => setShowTest(v => !v)}
            statusMsg={statusMsg}
            statusKind={statusKind}
          />
        )}

        {/* Empty state when no workflow selected */}
        {noWorkflowLoaded ? (
          <div className="flex-1 flex items-center justify-center flex-col gap-4 text-center px-8">
            <svg className="w-14 h-14 text-text-muted opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
            <div>
              <p className="text-sm text-text-secondary font-medium">No workflow selected</p>
              <p className="text-xs text-text-muted mt-1">Select an existing workflow from the left, or create a new one</p>
            </div>
            <button
              onClick={createWorkflow}
              className="text-sm bg-brand hover:bg-brand-dim text-white rounded-md px-4 py-2 transition-colors"
            >
              + Create Workflow
            </button>
          </div>
        ) : (
          <div className="flex-1 relative">
            <ReactFlow
              nodes={nodes.map(n => ({
                ...n,
                data: { ...n.data, error: errorIds.has(n.id) },
              }))}
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
                nodeColor={() => 'var(--surface-4)'}
                maskColor="rgba(8,10,12,0.6)"
                style={{
                  background: 'var(--surface-2)',
                  border: '1px solid var(--surface-5)',
                  borderRadius: 8,
                }}
              />
            </ReactFlow>

            {/* Test run drawer */}
            {showTest && (
              <TestRunPanel workflowId={idRef.current} onClose={() => setShowTest(false)} />
            )}
          </div>
        )}
      </div>

      {/* ── Right panel: node config ── */}
      {!noWorkflowLoaded && (
        <NodeConfigPanel
          node={selectedNode}
          onChange={updateNode}
          onDelete={deleteNode}
        />
      )}
    </div>
  );
}
