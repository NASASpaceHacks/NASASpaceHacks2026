import type { ReactNode } from 'react';
import { HEAT_BUDGET_W, SHELTER_MAX_MIN } from '../core/constants';
import type { Snapshot } from '../state/store';
import { ArcGauge, Bar, BearingDial, ClockCue } from './instruments/Instruments';
import { fmtCountdown, fmtDist, fmtElapsed, fmtLtst, fmtMin } from './format';

export function Frame({ x, y, w, h, label, children, tone }: { x: number; y: number; w: number; h: number; label?: string; children: ReactNode; tone?: 'amber' | 'red' }) {
  const border = tone === 'red' ? 'var(--r)' : tone === 'amber' ? 'var(--a2)' : undefined;
  return (
    <div className="frame" style={{ left: x, top: y, width: w, height: h, borderColor: border }}>
      {label && (
        <div className="tab lbl" style={{ color: tone === 'red' ? 'var(--r)' : tone === 'amber' ? 'var(--a)' : undefined }}>
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

const STATE_LABEL: Record<Snapshot['display'], { text: string; color: string; fill?: boolean; blink?: boolean }> = {
  BOOT: { text: 'BOOT', color: 'var(--g3)' },
  WAITING_FOR_ROUTE: { text: 'STANDBY', color: 'var(--g2)' },
  NEW_ROUTE: { text: 'NEW ROUTE', color: 'var(--a)', blink: true },
  NAV: { text: 'NAV', color: 'var(--g)' },
  STATION: { text: 'STATION', color: 'var(--g)' },
  RETURN_NOW: { text: 'RETURN NOW', color: 'var(--r)', fill: true, blink: true },
  COMPLETE: { text: 'EVA COMPLETE', color: 'var(--c)' },
};

function Readout({ label, value, unit, color = 'var(--w)', size = 40 }: { label: string; value: string; unit?: string; color?: string; size?: number }) {
  return (
    <div className="flex flex-col justify-center" style={{ height: 92 }}>
      <div className="lbl" style={{ fontSize: 18, lineHeight: '20px' }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: size, lineHeight: `${size + 4}px`, color }}>
        {value}
        {unit && (
          <span className="lbl" style={{ fontSize: 20, marginLeft: 6, color: 'var(--g2)' }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

const Sep = () => <div style={{ width: 2, height: 56, background: 'var(--line)', margin: '0 26px' }} />;

export function TopBar({ s }: { s: Snapshot }) {
  const st = STATE_LABEL[s.display];
  const linkTxt = s.link === 'up' ? 'UP' : s.link === 'degraded' ? 'DEGRADED' : 'LOST';
  const linkCol = s.link === 'up' ? 'var(--g)' : s.link === 'degraded' ? 'var(--a)' : 'var(--r)';
  const o2Col = s.o2Pct < 15 ? 'var(--r)' : s.o2Pct < 30 ? 'var(--a)' : 'var(--w)';
  return (
    <div className="absolute flex items-center" style={{ left: 16, top: 0, width: 1888, height: 92, borderBottom: '2px solid var(--line)' }}>
      <div className="flex flex-col justify-center" style={{ width: 210 }}>
        <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 30, letterSpacing: '0.2em', color: 'var(--g)' }}>MARSWALK</div>
        <div className="lbl" style={{ fontSize: 15, color: 'var(--g3)', whiteSpace: 'nowrap' }}>
          EVA VISOR · {s.mode === 'mock' ? 'DEMO' : 'LIVE'}
        </div>
      </div>
      <Sep />
      <Readout label="Sol" value={s.sol === null ? '—' : String(s.sol)} />
      <Sep />
      <Readout label="LTST" value={s.sol !== null ? fmtLtst(s.ltstMin) : '--:--'} size={46} />
      <Sep />
      <Readout label="EVA elapsed" value={s.seq !== null ? `T+${fmtElapsed(s.t)}` : 'T+--:--'} />
      <Sep />
      {s.autonomous ? (
        <div className="flex items-center hatch-amber" style={{ flex: 1, height: 74, border: '3px solid var(--a)', background: '#1c1300', padding: '0 18px', gap: 16, minWidth: 0 }}>
          <span className="blink" style={{ flex: 'none', width: 20, height: 20, background: 'var(--a)', borderRadius: 2 }} />
          <div className="flex flex-col" style={{ minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 27, letterSpacing: '0.02em', color: 'var(--a)', lineHeight: '32px', whiteSpace: 'nowrap' }}>
              LINK LOST — AUTONOMOUS — LAST CONFIRMED ROUTE v{s.seq ?? '—'}
            </span>
            <span className="lbl" style={{ fontSize: 16, color: 'var(--a)', whiteSpace: 'nowrap', letterSpacing: '0.08em' }}>
              ONBOARD SAFETY CORE GUIDING · TELEM QUEUED {s.outbox} · DOWN {Math.floor(s.linkDownS)} S
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center" style={{ flex: 1, gap: 18 }}>
          <div
            className={st.blink ? 'blink' : ''}
            style={{
              padding: '6px 20px',
              border: `3px solid ${st.color}`,
              background: st.fill ? st.color : 'transparent',
              color: st.fill ? '#000' : st.color,
              fontFamily: 'var(--font-ui)',
              fontWeight: 800,
              fontSize: 32,
              letterSpacing: '0.1em',
            }}
          >
            {st.text}
          </div>
          <div className="flex flex-col">
            <span className="lbl" style={{ fontSize: 18 }}>
              Route
            </span>
            <span className="num" style={{ fontSize: 34, color: 'var(--w)', lineHeight: '36px' }}>
              {s.seq !== null ? `v${s.seq}` : '—'}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {s.seq !== null && (
            <div className="flex flex-col" style={{ marginRight: 34 }}>
              <span className="lbl" style={{ fontSize: 18 }}>
                Position <span style={{ textTransform: 'none' }}>1σ</span>
              </span>
              <span className="num" style={{ fontSize: 30, color: s.sigmaM > 20 ? 'var(--a)' : 'var(--w)', lineHeight: '32px' }}>
                ±{Math.round(s.sigmaM)}
                <span className="lbl" style={{ fontSize: 18, marginLeft: 6 }}>
                  M DR
                </span>
              </span>
            </div>
          )}
          <div className="flex items-center" style={{ gap: 12 }}>
            <span style={{ width: 20, height: 20, borderRadius: 10, background: linkCol, boxShadow: `0 0 12px ${linkCol}` }} className={s.link === 'up' ? '' : 'blink'} />
            <div className="flex flex-col">
              <span className="lbl" style={{ fontSize: 18 }}>
                Link {s.localDrop ? '· DEMO DROP' : ''}
              </span>
              <span className="num" style={{ fontSize: 30, color: linkCol, lineHeight: '32px' }}>
                {linkTxt}
                {s.outbox > 0 && <span style={{ fontSize: 20, color: 'var(--a)', marginLeft: 10 }}>Q{s.outbox}</span>}
              </span>
            </div>
          </div>
        </div>
      )}
      <Sep />
      <div className="flex flex-col justify-center" style={{ width: 170 }}>
        <div className="lbl" style={{ fontSize: 18 }}>
          O₂ planned
        </div>
        <div className="num" style={{ fontSize: 40, color: o2Col, lineHeight: '42px' }}>
          {Math.round(s.o2Pct)}
          <span className="lbl" style={{ fontSize: 20, color: 'var(--g2)', marginLeft: 4 }}>
            %
          </span>
        </div>
        <Bar frac={s.o2Pct / 100} width={150} height={12} color={o2Col} />
      </div>
    </div>
  );
}

// ───────────────────────────── cluster ─────────────────────────────

export const CLUSTER_X = 1132;
const CW = 772;

function NextPanel({ s }: { s: Snapshot }) {
  const n = s.next;
  if (s.station) {
    const st = s.station;
    const frac = st.dwellTotalMin > 0 ? 1 - st.dwellLeftMin / st.dwellTotalMin : 0;
    const R = 120, C = 2 * Math.PI * R;
    return (
      <Frame x={0} y={0} w={CW} h={330} label={`Dwell · ${st.id}`}>
        <div className="absolute flex items-center" style={{ left: 22, top: 26, gap: 30 }}>
          <svg width={280} height={280} viewBox="0 0 280 280">
            <circle cx={140} cy={140} r={R} fill="none" stroke="var(--g4)" strokeWidth={18} />
            <circle
              cx={140}
              cy={140}
              r={R}
              fill="none"
              stroke={st.dwellCut ? 'var(--a)' : 'var(--g)'}
              strokeWidth={18}
              strokeDasharray={`${C * frac} ${C}`}
              transform="rotate(-90 140 140)"
              style={{ transition: 'stroke-dasharray 0.3s linear' }}
            />
            <text x={140} y={150} textAnchor="middle" fill="var(--w)" fontSize={64} className="num">
              {fmtCountdown(st.dwellLeftMin)}
            </text>
            <text x={140} y={190} textAnchor="middle" fill="var(--g2)" fontSize={20} className="lbl">
              DWELL LEFT
            </text>
          </svg>
          <div className="flex flex-col" style={{ gap: 10, width: 400 }}>
            <div className="lbl" style={{ fontSize: 20 }}>
              Station {st.index} of {st.total}
            </div>
            <div className="num" style={{ fontSize: 76, lineHeight: '76px', color: 'var(--a)' }}>
              {st.id}
            </div>
            <div className="num" style={{ fontSize: 34, color: 'var(--w)' }}>
              TASKS {st.tasksDone}/{st.tasks.length}
            </div>
            {st.leaveByLtstMin !== null && (
              <div className="num" style={{ fontSize: 26, color: st.dwellCut ? 'var(--a)' : 'var(--g2)' }}>
                {st.dwellCut ? 'DWELL CUT · ' : ''}LEAVE BY {fmtLtst(st.leaveByLtstMin)}
              </div>
            )}
            <div className="lbl" style={{ fontSize: 20, color: 'var(--g)' }}>
              [N] {st.tasksDone < st.tasks.length ? 'TICK TASK' : 'DEPART NOW'}
            </div>
          </div>
        </div>
      </Frame>
    );
  }
  const d = n ? fmtDist(n.distM) : null;
  return (
    <Frame x={0} y={0} w={CW} h={330} label={n?.isHome ? 'Return to' : 'Next stop'}>
      <div className="absolute" style={{ left: 18, top: 16 }}>
        <BearingDial rel={n ? n.relDeg : null} steer={n ? n.steerRelDeg : null} size={296} />
      </div>
      <div className="absolute flex flex-col" style={{ left: 342, top: 18, width: 410 }}>
        {n ? (
          <>
            <div className="flex items-baseline" style={{ gap: 14 }}>
              <span className="num" style={{ fontSize: 60, color: n.isHome ? 'var(--c)' : 'var(--a)', lineHeight: '62px' }}>
                {n.id}
              </span>
              <span className="lbl" style={{ fontSize: 20 }}>
                {n.isHome ? 'HOME' : `${n.index} OF ${n.total - 1}`}
              </span>
            </div>
            {s.offRouteM > 20 ? (
              <div className="num blink" style={{ fontSize: 22, color: 'var(--a)', whiteSpace: 'nowrap' }}>
                OFF ROUTE {Math.round(s.offRouteM)} M · REJOIN TRACK
              </div>
            ) : (
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--g2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name.toUpperCase()}</div>
            )}
            <div className="num" style={{ fontSize: 96, lineHeight: '96px', color: 'var(--w)', marginTop: 2 }}>
              {d!.v}
              <span className="lbl" style={{ fontSize: 30, marginLeft: 8, color: 'var(--g2)' }}>
                {d!.u}
              </span>
            </div>
            <div className="flex" style={{ gap: 28, marginTop: 4 }}>
              <div>
                <div className="lbl" style={{ fontSize: 18 }}>
                  ETA
                </div>
                <div className="num" style={{ fontSize: 36, lineHeight: '40px', color: 'var(--w)' }}>
                  {Math.max(0, Math.round(n.etaMin))}
                  <span className="lbl" style={{ fontSize: 20, marginLeft: 6 }}>
                    MIN
                  </span>
                </div>
              </div>
              <div>
                <div className="lbl" style={{ fontSize: 18 }}>
                  Arrive
                </div>
                <div className="num" style={{ fontSize: 36, lineHeight: '40px', color: 'var(--w)' }}>
                  {fmtLtst(n.arrLtstMin)}
                </div>
              </div>
              <div>
                <div className="lbl" style={{ fontSize: 18 }}>
                  Brg
                </div>
                <div className="num" style={{ fontSize: 36, lineHeight: '40px', color: 'var(--a)' }}>
                  {Math.round(n.relDeg / 30) % 12 || 12}
                  <span className="lbl" style={{ fontSize: 20, marginLeft: 4, color: 'var(--a)' }}>
                    O&apos;CLK
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="num" style={{ fontSize: 56, color: 'var(--g3)' }}>
              — — —
            </div>
            <div className="lbl" style={{ fontSize: 24, marginTop: 12 }}>
              {s.display === 'COMPLETE' ? `AT ${s.homeName} · INGRESS` : 'NO CONFIRMED ROUTE'}
            </div>
            <div className="lbl" style={{ fontSize: 20, marginTop: 6, color: 'var(--g3)' }}>
              {s.display === 'COMPLETE' ? 'EVA COMPLETE' : 'HOLD AT AIRLOCK · AWAIT ROUTE PUSH'}
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}

function MarginsPanel({ s }: { s: Snapshot }) {
  const b = s.bingo;
  const bingoCol = !b ? 'var(--g3)' : b.inMin < 0 ? 'var(--r)' : b.inMin < 10 ? 'var(--a)' : 'var(--w)';
  const wb = s.walkbackMarginMin;
  return (
    <Frame x={0} y={350} w={CW} h={262} label="Margins">
      <div className="absolute flex" style={{ left: 8, top: 26, gap: 4 }}>
        <ArcGauge value={wb === null ? null : wb === -Infinity ? -999 : wb} max={240} label="Walkback mgn" unit="MIN" amberBelow={30} redBelow={10} size={232} />
        <ArcGauge value={s.shelterMin} max={SHELTER_MAX_MIN * 1.2} label={`Shelter ≤${SHELTER_MAX_MIN}`} unit="MIN" amberBelow={SHELTER_MAX_MIN * 0.8} redBelow={SHELTER_MAX_MIN} limitAt={SHELTER_MAX_MIN} invert size={232} />
      </div>
      <div className="absolute flex flex-col" style={{ left: 500, top: 30, width: 256, gap: 6 }}>
        <div className="lbl" style={{ fontSize: 20 }}>
          Bingo {b ? b.id : ''}
        </div>
        <div className={`num ${b && b.inMin < 5 ? 'blink' : ''}`} style={{ fontSize: b && Math.abs(b.inMin) >= 60 ? 54 : 70, lineHeight: '74px', color: bingoCol }}>
          {b ? fmtCountdown(b.inMin) : '--:--'}
        </div>
        <div className="lbl" style={{ fontSize: 18, color: 'var(--g3)' }}>
          {b ? (b.inMin < 0 ? 'PASSED — RETURN' : 'LATEST DEPARTURE') : 'NO BINGO AHEAD'}
        </div>
        {b && (
          <div className="num" style={{ fontSize: 34, color: 'var(--g2)', marginTop: 4 }}>
            BY {fmtLtst(b.ltstMin)}
          </div>
        )}
      </div>
    </Frame>
  );
}

function AdvisoryPanel({ s }: { s: Snapshot }) {
  const heatFrac = s.heatAvgW / (HEAT_BUDGET_W * 1.3);
  const adv = s.heatAdvisory;
  const rest = s.heatRest?.active ? s.heatRest : null;
  const comm = s.comm;
  const commMain = !comm.available ? 'N/A' : comm.inLos ? 'LOS' : 'SHADOW';
  const commSub = !comm.available
    ? 'NO LOS LAYER'
    : comm.changeInMin === null
      ? comm.inLos ? 'CLEAR AHEAD' : 'NO LOS AHEAD'
      : `${comm.inLos ? 'SHADOW' : 'LOS'} IN ${Math.max(1, Math.round(comm.changeInMin))} MIN`;
  const commWarn = comm.available && (!comm.inLos || (comm.changeInMin !== null && comm.changeInMin < 5));
  return (
    <Frame x={0} y={632} w={CW} h={132} label="Advisory" tone={adv || rest ? 'amber' : undefined}>
      <div className="absolute flex items-center" style={{ left: 20, top: 24, gap: 26 }}>
        <div
          className={adv ? 'blink' : ''}
          style={{
            width: 300,
            height: 82,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: `3px solid ${adv || rest ? 'var(--a)' : 'var(--g3)'}`,
            background: adv ? 'var(--a)' : 'transparent',
            color: adv ? '#000' : rest ? 'var(--a)' : 'var(--g2)',
            fontFamily: 'var(--font-ui)',
            fontWeight: 800,
            fontSize: adv || rest ? 30 : 28,
            letterSpacing: '0.05em',
            whiteSpace: 'nowrap',
          }}
        >
          {adv ? 'SLOW PACE — HEAT' : rest ? `HEAT REST ${Math.max(0.1, rest.leftMin).toFixed(1)} MIN` : 'PACE NOMINAL'}
        </div>
        <div className="flex flex-col" style={{ width: 216, gap: 2 }}>
          <div className="lbl" style={{ fontSize: 17, whiteSpace: 'nowrap' }}>
            Heat 30-min avg
          </div>
          <div className="num" style={{ fontSize: 38, lineHeight: '42px', color: adv ? 'var(--a)' : 'var(--w)' }}>
            {s.seq !== null ? Math.round(s.heatAvgW) : '—'}
            <span className="lbl" style={{ fontSize: 18, marginLeft: 6 }}>
              / {HEAT_BUDGET_W} W
            </span>
          </div>
          <svg width={200} height={16}>
            <rect x={1} y={1} width={198} height={14} fill="none" stroke="var(--g3)" strokeWidth={2} />
            <rect x={4} y={4} width={Math.max(0, Math.min(1, heatFrac)) * 192} height={8} fill={adv ? 'var(--a)' : 'var(--g)'} />
            <line x1={4 + (1 / 1.3) * 192} y1={0} x2={4 + (1 / 1.3) * 192} y2={16} stroke="var(--r)" strokeWidth={3} />
          </svg>
        </div>
        <div className="flex flex-col" style={{ width: 170, gap: 2 }}>
          <div className="lbl" style={{ fontSize: 17 }}>
            Hab comm
          </div>
          <div className="num" style={{ fontSize: 34, lineHeight: '40px', color: !comm.available ? 'var(--g3)' : comm.inLos ? 'var(--c)' : 'var(--a)' }}>
            {commMain}
          </div>
          <div className="num" style={{ fontSize: 18, color: commWarn ? 'var(--a)' : 'var(--g2)', whiteSpace: 'nowrap' }}>
            {commSub}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function CuePanel({ s }: { s: Snapshot }) {
  const c = s.cue;
  return (
    <Frame x={0} y={784} w={CW} h={112} label="Heading ref">
      <div className="absolute flex items-center" style={{ left: 18, top: 6, gap: 20 }}>
        <ClockCue rel={c ? c.relDeg : 0} kind={c ? c.kind : 'none'} size={100} />
        <div className="flex flex-col">
          <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: c && c.text.length > 22 ? 34 : 42, color: c ? 'var(--a)' : 'var(--g3)', letterSpacing: '0.03em', lineHeight: '46px' }}>
            {c ? c.text : 'NO TRACK'}
          </div>
          <div className="num" style={{ fontSize: 20, color: 'var(--g2)' }}>
            {c ? c.sub : 'HEADING FROM SUN / LANDMARKS · NO MAGNETIC COMPASS'}
          </div>
        </div>
      </div>
    </Frame>
  );
}

export function Cluster({ s }: { s: Snapshot }) {
  return (
    <div className="absolute" style={{ left: CLUSTER_X, top: 104, width: CW, height: 896 }}>
      <NextPanel s={s} />
      <MarginsPanel s={s} />
      <AdvisoryPanel s={s} />
      <CuePanel s={s} />
    </div>
  );
}

// ───────────────────────────── key legend ─────────────────────────────

export interface KeyDef {
  k: string;
  label: string;
  enabled: boolean;
  on?: boolean;
  run: () => void;
}

export function KeyLegend({ keys }: { keys: KeyDef[] }) {
  return (
    <div className="absolute flex items-center" style={{ left: 16, top: 1010, width: 1888, height: 70, borderTop: '2px solid var(--line)', justifyContent: 'space-between' }}>
      {keys.map((k) => (
        <button
          key={k.k}
          onClick={k.run}
          className="flex items-center"
          style={{
            gap: 14,
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            color: !k.enabled ? 'var(--g4)' : k.on ? 'var(--a)' : 'var(--g)',
            padding: '0 10px',
          }}
        >
          <span className="keycap">{k.k}</span>
          <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 26, letterSpacing: '0.08em', color: !k.enabled ? 'var(--g4)' : k.on ? 'var(--a)' : 'var(--g2)' }}>
            {k.label}
          </span>
        </button>
      ))}
    </div>
  );
}

export { fmtMin };
