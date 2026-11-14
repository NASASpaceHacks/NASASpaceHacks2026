import { useLayoutEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'cyan';

export function Button({ variant = 'secondary', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-[3px] font-display uppercase tracking-[0.1em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap';
  const sizes = { sm: 'h-6 px-2 text-[10px]', md: 'h-8 px-3 text-[11px]', lg: 'h-10 px-4 text-[12.5px]' }[size];
  const variants: Record<Variant, string> = {
    primary: 'bg-amber text-[#16110a] hover:bg-[#ffc65c] font-semibold',
    secondary: 'border border-line-2 text-ink-2 hover:text-ink hover:border-[#454b55] bg-raised/40',
    ghost: 'text-mute hover:text-ink hover:bg-raised',
    danger: 'border border-red/50 text-red hover:bg-red/10',
    cyan: 'border border-cyan/40 text-cyan hover:bg-cyan/10',
  };
  return (
    <button className={cx(base, sizes, variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function Switch({ on, onChange, label, size = 'md', tone = 'amber' }: { on: boolean; onChange: (v: boolean) => void; label?: string; size?: 'sm' | 'md'; tone?: 'amber' | 'cyan' }) {
  const w = size === 'sm' ? 'w-6 h-3.5' : 'w-7 h-4';
  const k = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const shift = size === 'sm' ? 'translate-x-2.5' : 'translate-x-3';
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={cx('relative shrink-0 rounded-full border transition-colors', w, on ? (tone === 'cyan' ? 'bg-cyan/25 border-cyan/60' : 'bg-amber/25 border-amber/60') : 'bg-sunk border-line-2')}
    >
      <span className={cx('absolute left-[2px] top-1/2 -translate-y-1/2 rounded-full transition-transform', k, on ? cx(shift, tone === 'cyan' ? 'bg-cyan' : 'bg-amber') : 'bg-dim')} />
    </button>
  );
}

export function Badge({ tone = 'mute', children, className }: { tone?: 'mute' | 'amber' | 'cyan' | 'red' | 'ochre'; children: ReactNode; className?: string }) {
  const t = {
    mute: 'border-line-2 text-mute',
    amber: 'border-amber/40 text-amber bg-amber/5',
    cyan: 'border-cyan/40 text-cyan bg-cyan/5',
    red: 'border-red/50 text-red bg-red/5',
    ochre: 'border-ochre/50 text-ochre bg-ochre/5',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-[2px] border px-1.5 h-[17px] font-display text-[9.5px] uppercase tracking-[0.12em] whitespace-nowrap', t, className)}>{children}</span>;
}

export function SectionHead({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-2', className)}>
      <div className="rule-head label flex-1">{children}</div>
      {right}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="num inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-[2px] border border-line-2 bg-sunk px-1 text-[9.5px] text-mute">{children}</kbd>;
}

/** Hover/focus tooltip rendered in a portal so scroll containers never clip it. */
export function Tip({ content, children, side = 'top', width = 280 }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; width?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    let x = r.left + r.width / 2 - width / 2;
    let y = side === 'bottom' ? r.bottom + 8 : r.top - 8;
    if (side === 'left') { x = r.left - width - 10; y = r.top + r.height / 2; }
    if (side === 'right') { x = r.right + 10; y = r.top + r.height / 2; }
    x = Math.max(8, Math.min(vw - width - 8, x));
    setPos({ x, y });
  }, [open, side, width]);
  return (
    <span ref={ref} className="inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      {open && pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.x, top: pos.y, width, transform: side === 'top' ? 'translateY(-100%)' : side === 'left' || side === 'right' ? 'translateY(-50%)' : undefined }}
            className="pointer-events-none fixed z-[100] rounded-[3px] border border-line-2 bg-[#1a1d23] px-3 py-2 text-[11.5px] leading-[1.45] text-ink-2 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}

/** Horizontal margin bar: fraction of the limit still available (green→amber→red only when violated). */
export function MarginBar({ frac, violated, tone }: { frac: number; violated?: boolean; tone?: 'cyan' | 'amber' }) {
  const f = Math.max(0, Math.min(1, frac));
  const color = violated ? 'bg-red' : tone === 'amber' || f < 0.15 ? 'bg-amber' : 'bg-cyan';
  return (
    <div className="relative h-[5px] w-full overflow-hidden rounded-[1px] bg-sunk ring-1 ring-line">
      <div className={cx('absolute inset-y-0 left-0', color)} style={{ width: `${Math.max(2, f * 100)}%` }} />
    </div>
  );
}

export function Stat({ label, value, unit, sub, tone }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: 'amber' | 'cyan' | 'red' }) {
  const c = tone === 'amber' ? 'text-amber' : tone === 'cyan' ? 'text-cyan' : tone === 'red' ? 'text-red' : 'text-ink';
  return (
    <div className="min-w-0">
      <div className="label !text-[9.5px]">{label}</div>
      <div className={cx('num mt-0.5 text-[17px] leading-none', c)}>
        {value}
        {unit && <span className="ml-1 text-[10.5px] text-mute">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[10.5px] text-dim">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-[3px] border border-dashed border-line-2 px-4 py-5">
      <div className="font-display text-[12px] uppercase tracking-[0.12em] text-ink-2">{title}</div>
      {children && <div className="text-[12px] leading-relaxed text-mute">{children}</div>}
      {action}
    </div>
  );
}
