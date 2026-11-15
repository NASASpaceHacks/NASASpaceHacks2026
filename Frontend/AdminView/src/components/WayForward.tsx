import { acceptFix, dismissFix, findClosestSafe, findRoverSpot, fixKinds } from '../fixes';
import { shortName } from '../lib/base';
import { useDestReason } from '../lib/reasons';
import { useConsole } from '../store';
import { cx } from './ui';

const clean = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '');
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Chosen destinations the plan can't include, with the plain reason (same wording as the directions rows). */
export function useLeftOut(): { id: string; letter: string; name: string; reason: string }[] {
  const pack = useConsole((s) => s.pack);
  const dests = useConsole((s) => s.destinations);
  const customs = useConsole((s) => s.customStops);
  const plan = useConsole((s) => s.plan);
  const status = useConsole((s) => s.planStatus);
  const reasonOf = useDestReason();
  if (!pack || !plan || status !== 'ready') return [];
  const all = [...pack.manifest.stations, ...customs];
  return dests.flatMap((id, i) => {
    if (plan.order.includes(id)) return [];
    const st = all.find((x) => x.id === id);
    const d = plan.dropped.find((x) => x.id === id);
    return st ? [{ id, letter: String.fromCharCode(66 + i), name: clean(st.name), reason: d ? reasonOf(id) ?? 'not reachable in this walk' : 'not reachable in this walk' }] : [];
  });
}

/**
 * The way forward for a destination that can't be included: "Closest safe point" and (for distance,
 * walk-back, shelter or radio failures) "Move rover closer". Each searches with the engine, shows the
 * suggestion on the map, and one click applies it.
 */
export function WayForward({ destId, where, className }: { destId: string; where: 'row' | 'verdict'; className?: string }) {
  const fix = useConsole((s) => (s.fix?.destId === destId ? s.fix : null));
  const pack = useConsole((s) => s.pack);
  useConsole((s) => s.plan); // re-evaluate the options with each plan
  const tid = (k: string) => (where === 'verdict' ? `verdict-fix-${k}` : `fix-${k}-${destId}`);
  if (!pack) return null;
  const kinds = fixKinds(destId);
  const rover = pack.manifest.shelters.find((s) => s.kind === 'rover');
  const pin = destId.startsWith('P') ? 'your pin' : 'the target';
  const big = where === 'verdict';
  const btn = cx('border border-cyan text-cyan hover:bg-cyan/15', big ? 'h-10 px-3 text-[14px]' : 'h-7 px-2 text-[12.5px]');
  const link = cx('text-cyan hover:underline', big ? 'text-[14px]' : 'text-[12.5px]');

  let msg: string | null = null;
  let honest: string | null = null;
  if (fix?.status === 'searching') msg = fix.kind === 'closest' ? 'Finding the closest safe point…' : `Looking for a rover spot that makes this a GO…`;
  else if (fix?.status === 'found' && fix.kind === 'closest') msg = `Closest safe point: ${km(fix.distM ?? 0)} short of ${pin}.`;
  else if (fix?.status === 'found' && fix.kind === 'rover') {
    msg = `Suggested rover spot: ${km(fix.distM ?? 0)} from where ${rover ? shortName(rover) : 'the rover'} is now. This makes the walk a GO.`;
    honest = "The rover's own drive route isn't planned by Marswalk.";
  } else if (fix?.status === 'none') msg = fix.note ?? 'Nothing found.';

  return (
    <div className={cx('flex flex-col gap-1.5', className)} data-testid={tid('options')}>
      {msg && (
        <div data-testid={tid('msg')} data-status={fix?.status} data-kind={fix?.kind} className={cx('leading-snug', big ? 'text-[13.5px]' : 'text-[12.5px]', fix?.status === 'none' ? 'text-mute' : 'text-ink', fix?.status === 'searching' && 'mw-pulse')}>
          {msg}
          {honest && <span className="block text-mute">{honest}</span>}
        </div>
      )}
      {fix?.status === 'found' ? (
        <div className="flex flex-wrap items-center gap-2">
          <button data-testid={tid('accept')} onClick={acceptFix} className={btn}>
            {fix.kind === 'closest' ? 'Use this point' : `Move ${rover ? shortName(rover) : 'rover'} here`}
          </button>
          <button data-testid={tid('dismiss')} onClick={dismissFix} className={cx(link, '!text-mute hover:!text-ink')}>Dismiss</button>
        </div>
      ) : fix?.status === 'searching' ? (
        <button onClick={dismissFix} className={cx(link, 'self-start !text-mute hover:!text-ink')}>Cancel</button>
      ) : (
        <div className={cx('flex flex-wrap items-center', big ? 'gap-2' : 'gap-x-3 gap-y-1')}>
          {kinds.includes('closest') && !(fix?.status === 'none' && fix.kind === 'closest') && (
            <button data-testid={tid('closest')} onClick={() => void findClosestSafe(destId)} className={big ? btn : link}>Closest safe point</button>
          )}
          {kinds.includes('rover') && !(fix?.status === 'none' && fix.kind === 'rover') && (
            <button data-testid={tid('rover')} onClick={() => void findRoverSpot(destId)} className={big ? btn : link}>Move rover closer</button>
          )}
        </div>
      )}
    </div>
  );
}
