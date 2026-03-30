import { useState, useEffect, useCallback, createContext, useContext } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

// ── Context ───────────────────────────────────────────────────────────────────

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant, opts?: { duration?: number; action?: ToastItem['action'] }) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  dismiss: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
    </svg>
  ),
  error: (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
    </svg>
  ),
  warning: (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
    </svg>
  ),
  info: (
    <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>
    </svg>
  ),
};

const VARIANT_STYLE: Record<ToastVariant, string> = {
  success: 'text-accent-green',
  error:   'text-brand',
  warning: 'text-accent-amber',
  info:    'text-accent-blue',
};

// ── Single Toast ──────────────────────────────────────────────────────────────

function ToastItem({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const duration = item.duration ?? 3500;
    if (duration === Infinity) return;
    const timer = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timer);
  }, [item.duration]);

  // After exit animation, actually remove
  const handleAnimEnd = () => {
    if (!visible) onDismiss(item.id);
  };

  return (
    <div
      onAnimationEnd={handleAnimEnd}
      className={`
        flex items-start gap-3 bg-surface-3 ring-1 ring-surface-5 rounded-lg px-4 py-3
        shadow-panel w-80 max-w-full
        ${visible ? 'animate-slide-in-right' : 'opacity-0 transition-opacity duration-150'}
      `}
    >
      <span className={VARIANT_STYLE[item.variant]}>{ICONS[item.variant]}</span>
      <p className="flex-1 text-sm text-text-primary leading-snug">{item.message}</p>
      <div className="flex items-center gap-2 shrink-0">
        {item.action && (
          <button
            onClick={() => { item.action?.onClick(); onDismiss(item.id); }}
            className="text-xs text-brand hover:text-brand-dim font-medium transition-colors"
          >
            {item.action.label}
          </button>
        )}
        <button onClick={() => onDismiss(item.id)} className="text-text-muted hover:text-text-secondary transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((
    message: string,
    variant: ToastVariant = 'info',
    opts?: { duration?: number; action?: ToastItem['action'] }
  ) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts(prev => [...prev, { id, message, variant, ...opts }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem item={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
