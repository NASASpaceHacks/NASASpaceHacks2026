import { useLayoutEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type Ref } from 'react';
import { createPortal } from 'react-dom';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'cyan';

export function Button({ variant = 'secondary', size = 'md', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' | 'xl'; ref?: Ref<HTMLButtonElement> }) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-[6px] font-display uppercase tracking-[0.1em] transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none whitespace-nowrap';
  const sizes = { sm: 'h-7 px-2.5 text-[10.5px]', md: 'h-9 px-3.5 text-[11.5px]', lg: 'h-11 px-4 text-[13px]', xl: 'h-[52px] px-5 text-[15px] tracking-[0.12em]' }[size];
  const variants: Record<Variant, string> = {
    primary: 'bg-cyan text-black hover:bg-white font-bold border border-cyan',
    secondary: 'bg-black text-cyan border border-cyan hover:bg-cyan/10',
    ghost: 'text-ink-2 hover:text-cyan',
    danger: 'bg-black text-red border border-red hover:bg-red/10',
    cyan: 'bg-black text-cyan border border-cyan hover:bg-cyan/10',
  };
  return (
    <button className={cx(base, sizes, variants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function Switch({ on, onChange, label, size = 'md', tone = 'cyan' }: { on: boolean; onChange: (v: boolean) => void; label?: string; size?: 'sm' | 'md'; tone?: 'amber' | 'cyan' }) {
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
      className={cx('relative shrink-0 rounded-full border transition-colors', w, on ? 'bg-cyan/25 border-cyan' : 'bg-sunk border-line-2')}
    >
      <span className={cx('absolute left-[2px] top-1/2 -translate-y-1/2 rounded-full transition-transform', k, on ? cx(shift, 'bg-cyan') : 'bg-dim')} />
    </button>
  );
}

export function Badge({ tone = 'mute', children, className }: { tone?: 'mute' | 'amber' | 'cyan' | 'red' | 'ochre'; children: ReactNode; className?: string }) {
  const t = {
    mute: 'border-line-2 text-ink-2',
    amber: 'border-dashed border-ink text-ink',
    cyan: 'border-ok text-ok',
    red: 'border-red text-red',
    ochre: 'border-line-2 text-ink-2',
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

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('phone:hidden num inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[3px] border border-white/20 px-1 text-[10px] opacity-75', className)}>{children}</kbd>;
}

export type ToneKey = 'ok' | 'watch' | 'act';
export const TONE_TEXT: Record<ToneKey, string> = { ok: 'text-ok', watch: 'text-caution', act: 'text-red' };

/** Checklist mark: ✓ (ok) · ! (watch) · ✕ (act). */
export function ToneMark({ tone, className }: { tone: ToneKey; className?: string }) {
  const bg = { ok: 'border-ok text-ok', watch: 'border-cyan text-cyan', act: 'border-red text-red' }[tone];
  return (
    <span aria-label={tone === 'ok' ? 'OK' : tone === 'watch' ? 'Watch' : 'Act'} className={cx('inline-flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border bg-black', bg, className)}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {tone === 'ok' ? <path d="M2 5.3 L4.2 7.4 L8 2.8" /> : tone === 'watch' ? <path d="M5 2 V5.6 M5 7.9 V8" /> : <path d="M2.5 2.5 L7.5 7.5 M7.5 2.5 L2.5 7.5" />}
      </svg>
    </span>
  );
}

/** Floating panel anchored by the caller (popovers: Layers, Simulation, start time). */
export function Popover({ open, onClose, className, children, label }: { open: boolean; onClose: () => void; className?: string; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-popover-anchor]')) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label={label} className={cx('absolute z-40 rounded-[10px] bg-black ring-1 ring-white/[0.06]', className)}>
      {children}
    </div>
  );
}

/** Hover/focus tooltip rendered in a portal so scroll containers never clip it. */
export function Tip({ content, children, side = 'top', width = 280, className }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; width?: number; className?: string }) {
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
    <span ref={ref} className={cx('inline-flex', className)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
      {children}
      {open && pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: pos.x, top: pos.y, width, transform: side === 'top' ? 'translateY(-100%)' : side === 'left' || side === 'right' ? 'translateY(-50%)' : undefined }}
            className="pointer-events-none fixed z-[100] rounded-[3px] border border-line-2 bg-black px-3 py-2 text-[11.5px] leading-[1.45] text-ink-2"
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
  const color = violated ? 'bg-red' : tone === 'amber' || f < 0.15 ? 'bg-caution' : 'bg-ok';
  return (
    <div className="relative h-[5px] w-full overflow-hidden rounded-[1px] bg-sunk ring-1 ring-line">
      <div className={cx('absolute inset-y-0 left-0', color)} style={{ width: `${Math.max(2, f * 100)}%` }} />
    </div>
  );
}

export function Stat({ label, value, unit, sub, tone }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; tone?: 'amber' | 'cyan' | 'red' }) {
  const c = tone === 'amber' ? 'text-caution' : tone === 'cyan' ? 'text-ok' : tone === 'red' ? 'text-red' : 'text-ink';
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
