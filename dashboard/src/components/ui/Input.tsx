interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

export function Input({ label, error, leftIcon, rightSlot, className = '', ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-xs font-medium text-text-secondary">{label}</label>
      )}
      <div className="relative">
        {leftIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
            {leftIcon}
          </span>
        )}
        <input
          {...props}
          className={`
            w-full bg-surface-2 ring-1 ${error ? 'ring-brand' : 'ring-surface-5'} text-text-primary
            px-3 py-2 text-sm rounded-md outline-none
            focus:ring-brand transition-all
            placeholder:text-text-muted
            disabled:opacity-50 disabled:cursor-not-allowed
            ${leftIcon ? 'pl-9' : ''}
            ${rightSlot ? 'pr-9' : ''}
            ${className}
          `.trim()}
        />
        {rightSlot && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">
            {rightSlot}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-brand">{error}</p>}
    </div>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

export function Textarea({ label, error, className = '', ...props }: TextareaProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-xs font-medium text-text-secondary">{label}</label>
      )}
      <textarea
        {...props}
        className={`
          w-full bg-surface-2 ring-1 ${error ? 'ring-brand' : 'ring-surface-5'} text-text-primary
          px-3 py-2.5 text-sm rounded-md outline-none
          focus:ring-brand transition-all resize-none
          placeholder:text-text-muted
          disabled:opacity-50 disabled:cursor-not-allowed
          ${className}
        `.trim()}
      />
      {error && <p className="text-xs text-brand">{error}</p>}
    </div>
  );
}
