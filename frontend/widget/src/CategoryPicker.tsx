import type { IssueCategory, IssueCategoryDef } from './types';
import { ISSUE_CATEGORIES } from './types';

interface Props {
  lang: 'en' | 'th';
  primaryColor: string;
  onSelect: (category: IssueCategory) => void;
  disabled?: boolean;
}

// Per-category accent palette — hue-matched to each topic
const ACCENTS: Record<IssueCategory, { bg: string; border: string; icon: string; glow: string }> = {
  kyc_verification:   { bg: 'linear-gradient(135deg,#eef6ff 0%,#dbeafe 100%)', border: '#93c5fd', icon: '#2563eb', glow: 'rgba(37,99,235,0.18)' },
  account_restriction:{ bg: 'linear-gradient(135deg,#fff7ed 0%,#fed7aa 100%)', border: '#fb923c', icon: '#ea580c', glow: 'rgba(234,88,12,0.18)'  },
  password_2fa_reset: { bg: 'linear-gradient(135deg,#f5f3ff 0%,#ede9fe 100%)', border: '#a78bfa', icon: '#7c3aed', glow: 'rgba(124,58,237,0.18)' },
  fraud_security:     { bg: 'linear-gradient(135deg,#f0fdf4 0%,#bbf7d0 100%)', border: '#4ade80', icon: '#16a34a', glow: 'rgba(22,163,74,0.18)'  },
  withdrawal_issue:   { bg: 'linear-gradient(135deg,#fff1f2 0%,#fecdd3 100%)', border: '#f87171', icon: '#dc2626', glow: 'rgba(220,38,38,0.18)'  },
  other:              { bg: 'linear-gradient(135deg,#f8fafc 0%,#e2e8f0 100%)', border: '#94a3b8', icon: '#475569', glow: 'rgba(71,85,105,0.18)'  },
};

export default function CategoryPicker({ lang, primaryColor, onSelect, disabled }: Props) {
  // Pair categories into rows of 2
  const pairs: (IssueCategoryDef | null)[][] = [];
  const cats = ISSUE_CATEGORIES;
  for (let i = 0; i < cats.length; i += 2) {
    pairs.push([cats[i], cats[i + 1] ?? null]);
  }

  return (
    <div className="csbot-category-mosaic">
      {pairs.map((row, ri) => (
        <div key={ri} className="csbot-mosaic-row">
          {row.map((cat, ci) =>
            cat ? (
              <MosaicCard
                key={cat.key}
                cat={cat}
                lang={lang}
                accent={ACCENTS[cat.key]}
                disabled={disabled}
                onSelect={onSelect}
              />
            ) : (
              <div key={`empty-${ci}`} className="csbot-mosaic-empty" />
            )
          )}
        </div>
      ))}
    </div>
  );
}

function MosaicCard({
  cat,
  lang,
  accent,
  disabled,
  onSelect,
}: {
  cat: IssueCategoryDef;
  lang: 'en' | 'th';
  accent: { bg: string; border: string; icon: string; glow: string };
  disabled?: boolean;
  onSelect: (key: IssueCategory) => void;
}) {
  return (
    <button
      onClick={() => !disabled && onSelect(cat.key)}
      disabled={disabled}
      className="csbot-mosaic-card"
      style={{
        '--card-bg': accent.bg,
        '--card-border': accent.border,
        '--card-icon': accent.icon,
        '--card-glow': accent.glow,
      } as React.CSSProperties}
    >
      <span className="csbot-mosaic-icon">{cat.icon}</span>
      <span className="csbot-mosaic-label">{cat.label[lang]}</span>
    </button>
  );
}
