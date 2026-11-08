import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { useCountUp } from '../lib/motion';

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon">
          <Icon name={icon} size={22} />
        </span>
      )}
      <div>{children}</div>
    </div>
  );
}

/** Shimmering placeholder blocks while data loads (static under reduced motion). */
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-group" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${[100, 86, 64, 92, 74][i % 5]}%` }} aria-hidden />
      ))}
    </div>
  );
}

/** A number that counts up over ~600ms on mount (final value immediately under reduced motion). */
export function CountUp({ value, format = (n) => String(Math.round(n)) }: { value: number; format?: (n: number) => string }) {
  const shown = useCountUp(value);
  return <>{format(shown)}</>;
}

/** Pill-shaped tabs (role=tablist). The panel is rendered by the caller. */
export function Tabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
  sub,
}: {
  label: string;
  tabs: ReadonlyArray<{ id: T; label: string; count?: number }>;
  value: T;
  onChange: (id: T) => void;
  /** Smaller secondary filter row under a main tab bar. */
  sub?: boolean;
}) {
  return (
    <div className={sub ? 'tabs tabs-sub' : 'tabs'} role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={value === t.id ? 'is-active' : ''}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.count !== undefined && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** A checkbox drawn as the reference's pill toggle. Keeps the native checkbox role for assistive tech. */
export function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span className="toggle-text">
        <strong>{label}</strong>
        {description && <small className="muted">{description}</small>}
      </span>
      <input type="checkbox" className="toggle" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/** Centered dialog with a scrim; Escape or the close button dismisses it. */
export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`modal card${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Shown on a page whose member feature is switched off. */
export function FeatureOffBanner({ name, onOpenBranding }: { name: string; onOpenBranding?: () => void }) {
  return (
    <div className="info-banner feature-off">
      <span>
        <strong>{name}</strong> is switched off, so members don't see it in the app.
      </span>
      {onOpenBranding && (
        <button type="button" className="btn btn-small btn-secondary" onClick={onOpenBranding}>
          Turn on in Branding
        </button>
      )}
    </div>
  );
}

/** Small round icon button with a visible label for screen readers. */
export function IconButton({
  icon,
  label,
  onClick,
  tone,
  disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${tone === 'danger' ? ' icon-btn-danger' : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

export function Chip({ children, tone }: { children: ReactNode; tone?: 'brand' | 'success' | 'warning' | 'danger' | 'muted' }) {
  return <span className={`badge${tone ? ` badge-${tone}` : ''}`}>{children}</span>;
}
