import { Spinner } from './Spinner';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const VARIANT = {
  primary:   'bg-brand hover:bg-brand-dim text-white ring-1 ring-brand/20',
  secondary: 'bg-surface-3 hover:bg-surface-4 text-text-primary ring-1 ring-surface-5',
  ghost:     'bg-transparent hover:bg-surface-4 text-text-secondary hover:text-text-primary',
  danger:    'bg-brand/10 hover:bg-brand/20 text-brand ring-1 ring-brand/20',
};

const SIZE = {
  sm: 'h-7 px-3 text-xs gap-1.5 rounded',
  md: 'h-9 px-4 text-sm gap-2 rounded-md',
  lg: 'h-10 px-5 text-sm gap-2 rounded-md',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`
        inline-flex items-center justify-center font-medium transition-all duration-100
        active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed
        ${VARIANT[variant]} ${SIZE[size]} ${className}
      `.trim()}
    >
      {loading ? (
        <Spinner size="xs" className="text-current" />
      ) : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}
