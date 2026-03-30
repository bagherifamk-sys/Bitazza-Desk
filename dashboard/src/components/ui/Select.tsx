import { useState, useRef, useEffect } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

export function Select({ value, options, onChange, label, placeholder = 'Select…', className = '' }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <span className="text-xs font-medium text-text-secondary">{label}</span>}
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between gap-2 bg-surface-2 ring-1 ring-surface-5 text-text-primary px-3 py-2 text-sm rounded-md hover:bg-surface-3 transition-colors"
        >
          <span className="flex items-center gap-2 truncate">
            {selected?.icon}
            <span className={selected ? 'text-text-primary' : 'text-text-muted'}>
              {selected?.label ?? placeholder}
            </span>
          </span>
          <svg className={`w-3.5 h-3.5 text-text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
          </svg>
        </button>

        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-surface-3 ring-1 ring-surface-5 rounded-lg shadow-panel overflow-hidden z-50 animate-slide-in-up max-h-52 overflow-y-auto">
            {options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-surface-4 transition-colors text-left ${opt.value === value ? 'text-text-primary bg-surface-4 font-medium' : 'text-text-secondary'}`}
              >
                {opt.icon}
                {opt.label}
                {opt.value === value && (
                  <svg className="w-3.5 h-3.5 text-brand ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
