import { forwardRef, useId, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
const classes = (...values: Array<string | undefined>) => values.filter(Boolean).join(' ');

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pending?: boolean;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}
/** Native button semantics, explicit pending feedback, and no accidental form submission. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { pending = false, pendingLabel = 'Working…', variant = 'primary', children, className, disabled, type = 'button', onClick, ...props }, ref,
) {
  return <button {...props} ref={ref} type={type} disabled={disabled}
    aria-disabled={pending || props['aria-disabled']} aria-busy={pending || undefined}
    data-glocon-component="Button" data-glocon-variant={variant}
    className={classes('glocon-button', `glocon-button--${variant}`, className)}
    onClick={event => { if (pending || props['aria-disabled'] === true || props['aria-disabled'] === 'true') { event.preventDefault(); return; } onClick?.(event); }}>
    {pending ? <span data-glocon-feedback="true">{pendingLabel}</span> : children}
  </button>;
});
export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  label: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, id, className, wrapperClassName, 'aria-describedby': describedBy, ...props }, ref,
) {
  const generated = useId();
  const inputId = id ?? `glocon-${generated}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const descriptions = [describedBy, hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  return <div className={classes('glocon-field', wrapperClassName)}>
    <label className="glocon-label" htmlFor={inputId}>{label}{props.required ? <span aria-hidden="true"> *</span> : null}</label>
    {hint ? <p id={hintId} className="glocon-hint">{hint}</p> : null}
    <input {...props} id={inputId} ref={ref} className={classes('glocon-input', className)} aria-invalid={error ? true : props['aria-invalid']} aria-describedby={descriptions} />
    {error ? <p id={errorId} className="glocon-error">{error}</p> : null}
  </div>;
});
export interface StatusProps extends HTMLAttributes<HTMLDivElement> { tone?: 'neutral' | 'error' }
/** Keep mounted and change children for reliable live announcements. */
export function Status({ tone = 'neutral', className, children, ...props }: StatusProps) {
  return <div role={tone === 'error' ? 'alert' : 'status'} aria-atomic="true" {...props} className={classes('glocon-status', className)}>{children}</div>;
}
export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: string;
  description: string;
  action?: ReactNode;
}
export function EmptyState({ title, description, action, className, ...props }: EmptyStateProps) {
  const titleId = useId();
  return <section {...props} aria-labelledby={titleId} className={classes('glocon-empty', className)} data-glocon-state="empty">
    <h2 id={titleId}>{title}</h2><p>{description}</p>{action ? <div>{action}</div> : null}
  </section>;
}
export type AsyncValue<T> = { status: 'loading' } | { status: 'empty' } | { status: 'error'; error: Error } | { status: 'success'; data: T };
export interface AsyncStateProps<T> {
  value: AsyncValue<T>;
  views: { loading: ReactNode; empty: ReactNode; error: (error: Error) => ReactNode; success: (data: T) => ReactNode };
}
/** All four views are required by TypeScript; the component owns no fetching logic. */
export function AsyncState<T>({ value, views }: AsyncStateProps<T>) {
  switch (value.status) {
    case 'loading': return <div data-glocon-state="loading">{views.loading}</div>;
    case 'empty': return <div data-glocon-state="empty">{views.empty}</div>;
    case 'error': return <div data-glocon-state="error">{views.error(value.error)}</div>;
    case 'success': return <div data-glocon-state="success">{views.success(value.data)}</div>;
  }
}
export interface StackProps extends HTMLAttributes<HTMLDivElement> { gap?: 0 | 1 | 2 | 3 | 4 | 6 | 8 }
export function Stack({ gap = 4, className, style, ...props }: StackProps) {
  return <div {...props} className={classes('glocon-stack', className)} style={{ gap: `var(--glocon-space-${gap})`, ...style }} />;
}
