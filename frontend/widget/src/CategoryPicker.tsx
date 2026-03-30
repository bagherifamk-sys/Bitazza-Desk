import { ISSUE_CATEGORIES } from './types';
import type { IssueCategory } from './types';

interface Props {
  lang: 'en' | 'th';
  primaryColor: string;
  onSelect: (category: IssueCategory) => void;
  disabled?: boolean;
}

export default function CategoryPicker({ lang, primaryColor, onSelect, disabled }: Props) {
  return (
    <div className="csbot-category-picker flex flex-col gap-2 pt-1 pb-2">
      {ISSUE_CATEGORIES.map((cat) => (
        <button
          key={cat.key}
          onClick={() => !disabled && onSelect(cat.key)}
          disabled={disabled}
          className="csbot-category-btn flex items-center gap-2.5 w-full text-left px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-40"
          style={{ '--cat-color': primaryColor } as React.CSSProperties}
        >
          <span className="text-base leading-none">{cat.icon}</span>
          <span>{cat.label[lang]}</span>
        </button>
      ))}
    </div>
  );
}
