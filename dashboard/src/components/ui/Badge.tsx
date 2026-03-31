import type { TicketStatus, Priority, Channel, TicketCategory } from '../../types';
type TicketPriority = Priority;
type TicketChannel = Channel;

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TicketStatus, { label: string; dot: string; bg: string; text: string }> = {
  Open_Live:           { label: 'Open',       dot: 'bg-accent-green', bg: 'bg-accent-green/10', text: 'text-accent-green' },
  In_Progress:         { label: 'Active',     dot: 'bg-accent-blue',  bg: 'bg-accent-blue/10',  text: 'text-accent-blue'  },
  Pending_Customer:    { label: 'Pending',    dot: 'bg-accent-amber', bg: 'bg-accent-amber/10', text: 'text-accent-amber' },
  Escalated:           { label: 'Escalated',  dot: 'bg-brand',        bg: 'bg-brand/10',        text: 'text-brand'        },
  Closed_Resolved:     { label: 'Resolved',   dot: 'bg-text-muted',   bg: 'bg-surface-4',       text: 'text-text-muted'  },
  Closed_Unresponsive: { label: 'Closed',     dot: 'bg-text-muted',   bg: 'bg-surface-4',       text: 'text-text-muted'  },
  Orphaned:            { label: 'Orphaned',   dot: 'bg-text-muted',   bg: 'bg-surface-4',       text: 'text-text-muted'  },
};

const PRIORITY_CONFIG: Record<TicketPriority, { label: string; bg: string; text: string }> = {
  1: { label: 'VIP',      bg: 'bg-brand/10',        text: 'text-brand'        },
  2: { label: 'High',     bg: 'bg-accent-amber/10', text: 'text-accent-amber' },
  3: { label: 'Standard', bg: 'bg-surface-4',       text: 'text-text-muted'   },
};

const CHANNEL_CONFIG: Record<TicketChannel, { label: string; bg: string; text: string }> = {
  web:      { label: 'Web',      bg: 'bg-accent-blue/10',  text: 'text-accent-blue'  },
  line:     { label: 'LINE',     bg: 'bg-accent-green/10', text: 'text-accent-green' },
  facebook: { label: 'Facebook', bg: 'bg-accent-blue/10',  text: 'text-accent-blue'  },
  email:    { label: 'Email',    bg: 'bg-surface-4',       text: 'text-text-secondary'},
};

// icon: heroicons micro path (viewBox 0 0 16 16)
const CATEGORY_CONFIG: Record<TicketCategory, { label: string; bg: string; text: string; icon: string }> = {
  kyc_verification: {
    label: 'KYC Verification',
    bg: 'bg-brand/10', text: 'text-brand',
    icon: 'M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm3 1.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM5 9a3 3 0 0 1 6 0H5Zm6-4.5h-1.5v1H11v-1Z',
  },
  account_restriction: {
    label: 'Account Restriction',
    bg: 'bg-accent-amber/10', text: 'text-accent-amber',
    icon: 'M8 1a4 4 0 1 0 0 8A4 4 0 0 0 8 1ZM2 11a6 6 0 0 1 10.472-4H3.528A6 6 0 0 1 2 11Zm-.5 2a.5.5 0 0 0 0 1h13a.5.5 0 0 0 0-1H1.5Z',
  },
  password_2fa_reset: {
    label: 'Password / 2FA',
    bg: 'bg-accent-blue/10', text: 'text-accent-blue',
    icon: 'M11 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM4 8.5A3.5 3.5 0 0 0 .5 12v.5A1.5 1.5 0 0 0 2 14h12a1.5 1.5 0 0 0 1.5-1.5V12A3.5 3.5 0 0 0 12 8.5H4Z',
  },
  fraud_security: {
    label: 'Fraud & Security',
    bg: 'bg-accent-red/10', text: 'text-accent-red',
    icon: 'M8 1 2 3.5V8c0 3.3 2.5 5.6 6 7 3.5-1.4 6-3.7 6-7V3.5L8 1Zm3.28 5.78-3.75 3.75a.75.75 0 0 1-1.06 0l-1.5-1.5a.75.75 0 1 1 1.06-1.06l.97.97 3.22-3.22a.75.75 0 1 1 1.06 1.06Z',
  },
  withdrawal_issue: {
    label: 'Withdrawal Issue',
    bg: 'bg-accent-amber/10', text: 'text-accent-amber',
    icon: 'M8 14V5.414l2.293 2.293a1 1 0 0 0 1.414-1.414l-3-3a1 1 0 0 0-1.414 0l-3 3a1 1 0 0 0 1.414 1.414L7 5.414V14a1 1 0 0 0 2 0ZM3 2a1 1 0 0 0 0 2h10a1 1 0 1 0 0-2H3Z',
  },
  ai_handling: {
    label: 'Unclassified',
    bg: 'bg-surface-4', text: 'text-text-secondary',
    icon: 'M9.5 1.5 8 5l-3.5 1.5L8 8l1.5 3.5L11 8l3.5-1.5L11 5 9.5 1.5ZM3 9.5 2 12l2.5 1L2 14.5 3 17l1-2.5 2.5-1L4 12l-1-2.5Z',
  },
};

// ── Badge component ───────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: TicketStatus;
  dot?: boolean;
  size?: 'xs' | 'sm';
}

export function StatusBadge({ status, dot = false, size = 'sm' }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, dot: 'bg-text-muted', bg: 'bg-surface-4', text: 'text-text-muted' };
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1 rounded font-medium ${px} ${cfg.bg} ${cfg.text}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />}
      {cfg.label}
    </span>
  );
}

interface PriorityBadgeProps {
  priority: TicketPriority;
  size?: 'xs' | 'sm';
}

export function PriorityBadge({ priority, size = 'sm' }: PriorityBadgeProps) {
  const cfg = PRIORITY_CONFIG[priority] ?? { label: String(priority), bg: 'bg-surface-4', text: 'text-text-muted' };
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center rounded font-medium ${px} ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

interface ChannelBadgeProps {
  channel: TicketChannel;
  size?: 'xs' | 'sm';
}

export function ChannelBadge({ channel, size = 'sm' }: ChannelBadgeProps) {
  const cfg = CHANNEL_CONFIG[channel] ?? { label: channel, bg: 'bg-surface-4', text: 'text-text-muted' };
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center rounded font-medium ${px} ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

interface CategoryBadgeProps {
  category: TicketCategory;
  size?: 'xs' | 'sm';
}

export function CategoryBadge({ category, size = 'sm' }: CategoryBadgeProps) {
  const cfg = CATEGORY_CONFIG[category] ?? { label: category, bg: 'bg-surface-4', text: 'text-text-secondary', icon: '' };
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1 rounded font-medium ${px} ${cfg.bg} ${cfg.text}`}>
      {cfg.icon && (
        <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d={cfg.icon} />
        </svg>
      )}
      {cfg.label}
    </span>
  );
}

interface TagBadgeProps {
  label: string;
  onRemove?: () => void;
  size?: 'xs' | 'sm';
}

export function TagBadge({ label, onRemove, size = 'sm' }: TagBadgeProps) {
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center gap-1 rounded font-medium ${px} bg-surface-4 text-text-secondary`}>
      {label}
      {onRemove && (
        <button onClick={onRemove} className="hover:text-text-primary transition-colors ml-0.5">
          <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      )}
    </span>
  );
}
