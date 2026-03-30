import { useEffect, useRef } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Don't close when clicking backdrop */
  persistent?: boolean;
}

const SIZE = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Modal({ open, onClose, title, description, children, size = 'md', persistent = false }: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !persistent) onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, persistent]);

  // Prevent body scroll
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-fade-in"
      onClick={persistent ? undefined : onClose}
    >
      <div
        ref={contentRef}
        className={`w-full ${SIZE[size]} bg-surface-3 ring-1 ring-surface-5 rounded-xl shadow-modal animate-scale-in`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {(title || description) && (
          <div className="px-6 pt-5 pb-4 border-b border-surface-5">
            {title && <h2 className="text-md font-semibold text-text-primary">{title}</h2>}
            {description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// Convenience confirm modal
interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function ConfirmModal({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', danger = false }: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="space-y-4">
        <div>
          <h3 className="text-md font-semibold text-text-primary">{title}</h3>
          <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">{description}</p>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose}
            className="px-4 py-1.5 text-sm ring-1 ring-surface-5 rounded-md hover:bg-surface-4 transition-colors text-text-secondary active:scale-[0.98]">
            Cancel
          </button>
          <button onClick={() => { onConfirm(); onClose(); }}
            className={`px-4 py-1.5 text-sm rounded-md transition-colors active:scale-[0.98] ${
              danger
                ? 'bg-brand hover:bg-brand-dim text-white'
                : 'bg-surface-2 ring-1 ring-surface-5 hover:bg-surface-3 text-text-primary'
            }`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
