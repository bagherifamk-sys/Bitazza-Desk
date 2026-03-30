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

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  kyc: 'KYC',
  deposit_fiat: 'Deposit Fiat',
  deposit_crypto: 'Deposit Crypto',
  withdrawal_fiat: 'Withdrawal',
  withdrawal_crypto: 'Withdraw Crypto',
  change_information: 'Change Info',
  account_security: 'Security',
  trading_platform: 'Trading',
  general: 'General',
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
  const label = CATEGORY_LABELS[category] ?? category;
  const px = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';
  return (
    <span className={`inline-flex items-center rounded font-medium ${px} bg-surface-4 text-text-secondary`}>
      {label}
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
