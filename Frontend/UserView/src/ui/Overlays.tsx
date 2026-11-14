import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Snapshot, StationInfo } from '../state/store';
import { BearingDial } from './instruments/Instruments';
import { clockText, fmtCountdown, fmtDist, fmtElapsed, fmtLtst, fmtMin } from './format';
import { MAP_H, MAP_W } from './MapView';

const ease = [0.2, 0.8, 0.2, 1] as const;

// ───────────────────────────── NEW ROUTE ─────────────────────────────

export function NewRouteModal({ s }: { s: Snapshot }) {
  const p = s.pending;
  return (
    <AnimatePresence>
      {p && (
        <motion.div
          key={`nr${p.seq}`}
          className="absolute inset-0"
          style={{ background: 'rgba(0,0,0,0.72)', zIndex: 40 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          <motion.div
            className="absolute"
            style={{ left: 440, top: 230, width: 1040, height: 600, background: '#000', border: '4px solid var(--a)', boxShadow: '0 0 0 2px #000, 0 0 60px rgba(255,182,39,0.25)' }}
            initial={{ scale: 0.92, y: 30, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 1.04, opacity: 0 }}
            transition={{ duration: 0.4, ease }}
          >
            <div className="absolute flex items-center hatch-amber" style={{ left: 0, top: 0, right: 0, height: 74, borderBottom: '3px solid var(--a)', padding: '0 30px', justifyContent: 'space-between' }}>
              <span className="blink" style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 34, letterSpacing: '0.16em', color: 'var(--a)' }}>
                ▲ INCOMING ROUTE
              </span>
              <span className="lbl" style={{ fontSize: 20, color: 'var(--a)' }}>
                FROM {p.author === 'earth' ? 'EARTH' : 'HAB'} · {p.parentSeq !== null ? `SUPERSEDES v${p.parentSeq}` : 'FIRST ROUTE'}
              </span>
              <span
                className="num"
                style={{
                  fontSize: 18,
                  padding: '4px 10px',
                  border: `2px solid ${p.sig === 'verified' ? 'var(--g)' : 'var(--a)'}`,
                  color: p.sig === 'verified' ? 'var(--g)' : 'var(--a)',
                  background: '#000',
                }}
              >
                {p.sig === 'verified' ? 'ED25519 ✓ VERIFIED' : p.sig === 'checking' ? 'VERIFYING SIGNATURE…' : p.sig === 'unverified' ? 'SIGNED · KEY UNKNOWN' : 'UNSIGNED · MOCK'}
              </span>
            </div>
            <div className="absolute" style={{ left: 40, top: 100 }}>
              <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 96, lineHeight: '100px', color: 'var(--w)', letterSpacing: '0.02em' }}>
                NEW ROUTE <span style={{ color: 'var(--a)' }}>v{p.seq}</span>
              </div>
            </div>
            <div className="absolute" style={{ left: 40, top: 230, width: 960 }}>
              <div className="lbl" style={{ fontSize: 20 }}>
                Stops
              </div>
              <div className="num" style={{ fontSize: p.stops.length > 5 ? 32 : 40, color: 'var(--g)', lineHeight: p.stops.length > 5 ? '44px' : '52px' }}>
                {[p.fromLabel, ...p.stops, p.toLabel].join('  ›  ')}
              </div>
              <div className="flex" style={{ gap: 60, marginTop: 22 }}>
                <div>
                  <div className="lbl" style={{ fontSize: 20 }}>
                    Distance
                  </div>
                  <div className="num" style={{ fontSize: 46, color: 'var(--w)' }}>
                    {fmtDist(p.distM).v}
                    <span className="lbl" style={{ fontSize: 22, marginLeft: 6 }}>
                      {fmtDist(p.distM).u}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="lbl" style={{ fontSize: 20 }}>
                    Stations
                  </div>
                  <div className="num" style={{ fontSize: 46, color: 'var(--w)' }}>
                    {p.stops.length}
                  </div>
                </div>
                {p.bingo && (
                  <div>
                    <div className="lbl" style={{ fontSize: 20 }}>
                      First bingo
                    </div>
                    <div className="num" style={{ fontSize: 34, color: 'var(--a)', lineHeight: '56px', whiteSpace: 'nowrap' }}>
                      {p.bingo.toUpperCase()}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="absolute flex items-center" style={{ left: 40, right: 40, bottom: 34, height: 96, border: '3px solid var(--g)', justifyContent: 'center', gap: 24 }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 40, color: 'var(--g)', letterSpacing: '0.1em' }}>PRESS</span>
              <span className="keycap" style={{ color: 'var(--g)', minWidth: 70, height: 70, fontSize: 44 }}>
                A
              </span>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 40, color: 'var(--g)', letterSpacing: '0.1em' }}>TO ACCEPT</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────────── STATION ─────────────────────────────

function Photo({ st }: { st: StationInfo }) {
  const [failed, setFailed] = useState<string | null>(null);
  const img = st.image && failed !== st.image.url ? st.image : null;
  return (
    <div className="absolute" style={{ left: 566, top: 330, width: 508, height: 540 }}>
      <div className="lbl" style={{ fontSize: 22, color: 'var(--a)', marginBottom: 8 }}>
        What you&apos;ll see
      </div>
      <div style={{ width: 508, height: 381, border: '3px solid var(--a2)', background: '#050505', position: 'relative', overflow: 'hidden' }}>
        {img ? (
          <img src={img.url} alt={img.caption ?? `Curiosity ${img.camera} sol ${img.sol}`} onError={() => setFailed(img.url)} style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'contrast(1.05)' }} />
        ) : (
          <svg width={508} height={381} viewBox="0 0 508 381">
            <rect x={0} y={0} width={508} height={381} fill="none" />
            {[[30, 30, 1, 1], [478, 30, -1, 1], [30, 351, 1, -1], [478, 351, -1, -1]].map(([x, y, dx, dy], i) => (
              <path key={i} d={`M ${x} ${y + 36 * dy} V ${y} H ${x + 36 * dx}`} fill="none" stroke="var(--g3)" strokeWidth={3} />
            ))}
            <circle cx={254} cy={170} r={44} fill="none" stroke="var(--g3)" strokeWidth={3} />
            <line x1={254} y1={110} x2={254} y2={230} stroke="var(--g3)" strokeWidth={2} />
            <line x1={194} y1={170} x2={314} y2={170} stroke="var(--g3)" strokeWidth={2} />
            <text x={254} y={272} textAnchor="middle" fill="var(--g2)" fontSize={22} className="lbl">
              NO ROVER IMAGE FOR THIS
            </text>
            <text x={254} y={300} textAnchor="middle" fill="var(--g2)" fontSize={22} className="lbl">
              STATION IN THE SITE PACK
            </text>
          </svg>
        )}
      </div>
      {img ? (
        <>
          <div className="num" style={{ fontSize: 22, color: 'var(--w)', marginTop: 10 }}>
            {img.credit} · Sol {img.sol}
          </div>
          <div className="num" style={{ fontSize: 18, color: 'var(--g2)', marginTop: 2 }}>
            CURIOSITY {img.camera.replace(/_/g, ' ')} · RAW IMAGE
          </div>
          {img.caption && (
            <div style={{ fontSize: 16, lineHeight: '20px', color: 'var(--g3)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {img.caption}
            </div>
          )}
        </>
      ) : (
        <div className="num" style={{ fontSize: 18, color: 'var(--g3)', marginTop: 10 }}>
          IMAGERY SHOWN ONLY WHEN THE SITE PACK CARRIES A ROVER IMAGE
        </div>
      )}
    </div>
  );
}

export function StationCard({ s }: { s: Snapshot }) {
  const st = s.station;
  return (
    <AnimatePresence>
      {st && !s.ret && (
        <motion.div
          key={`st${st.id}`}
          className="absolute"
          style={{ left: 0, top: 0, width: MAP_W, height: MAP_H, background: '#000', zIndex: 20, borderRight: '2px solid var(--line)' }}
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.45, ease }}
        >
          <div className="absolute flex flex-col" style={{ left: 30, top: 22, width: 1040 }}>
            <div className="flex items-center" style={{ gap: 18 }}>
              <span className="num" style={{ fontSize: 30, color: '#000', background: 'var(--a)', padding: '2px 14px' }}>
                {st.id}
              </span>
              <span className="lbl" style={{ fontSize: 22, color: 'var(--a)' }}>
                Station {st.index} of {st.total} · arrived · position fix
              </span>
              {st.value !== null && (
                <span className="lbl" style={{ fontSize: 20, marginLeft: 'auto' }}>
                  Science value <span className="num" style={{ color: 'var(--w)', fontSize: 26 }}>{st.value}</span>
                </span>
              )}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-ui)',
                fontWeight: 800,
                fontSize: st.name.length > 34 ? 42 : 50,
                lineHeight: st.name.length > 34 ? '48px' : '58px',
                color: 'var(--w)',
                marginTop: 10,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {st.name}
            </div>
            <div style={{ marginTop: 14, borderLeft: '6px solid var(--g)', paddingLeft: 20 }}>
              <div className="lbl" style={{ fontSize: 20 }}>
                Objective {st.objective ? `${st.objective.id} · goal ${st.objective.goal} · weight ${st.objective.weight}` : '—'}
                {st.otherObjectives.length > 0 && <span style={{ color: 'var(--g3)' }}> · also {st.otherObjectives.join(', ')}</span>}
              </div>
              <div style={{ fontSize: 28, lineHeight: '34px', fontWeight: 700, color: 'var(--g)', marginTop: 4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {st.objective ? st.objective.statement : st.description || 'No objective listed for this station in the STM.'}
              </div>
            </div>
          </div>
          <TaskList st={st} />
          <Photo st={st} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TaskList({ st }: { st: StationInfo }) {
  const n = st.tasks.length;
  const active = Math.min(st.tasksDone, n - 1);
  const start = Math.max(0, Math.min(active - 1, n - 3));
  const vis = st.tasks.slice(start, start + 3);
  return (
    <div className="absolute" style={{ left: 30, top: 330, width: 506 }}>
      <div className="flex items-center" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="lbl" style={{ fontSize: 22 }}>
          Crew tasks
        </span>
        <span className="num" style={{ fontSize: 24, color: 'var(--w)' }}>
          {st.tasksDone}/{n}
        </span>
      </div>
      <div className="flex flex-col" style={{ gap: 12 }}>
        {start > 0 && (
          <div className="lbl" style={{ fontSize: 18, color: 'var(--g3)' }}>
            ▲ {start} DONE ABOVE
          </div>
        )}
        <AnimatePresence initial={false} mode="popLayout">
          {vis.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.3, ease }}
              className="flex"
              style={{
                gap: 16,
                padding: '12px 14px',
                border: `3px solid ${t.active ? 'var(--g)' : t.done ? 'var(--g4)' : 'var(--line)'}`,
                background: t.active ? 'rgba(77,255,148,0.06)' : 'transparent',
              }}
            >
              <svg width={40} height={40} viewBox="0 0 40 40" style={{ flex: 'none', marginTop: 2 }}>
                <rect x={2} y={2} width={36} height={36} fill={t.done ? 'var(--g)' : 'none'} stroke={t.done ? 'var(--g)' : t.active ? 'var(--g)' : 'var(--g3)'} strokeWidth={3} />
                {t.done && <path d="M 9 21 L 17 29 L 32 11" fill="none" stroke="#000" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />}
              </svg>
              <div className="flex flex-col">
                <div style={{ fontSize: 27, lineHeight: '33px', fontWeight: 700, color: t.done ? 'var(--g3)' : 'var(--w)', textDecorationLine: t.done ? 'line-through' : 'none', textDecorationThickness: 2 }}>
                  {t.label}
                </div>
                <div className="num" style={{ fontSize: 17, color: t.done ? 'var(--g4)' : 'var(--g2)', marginTop: 2 }}>
                  {t.id} · {t.objectiveId}
                  {t.instrument ? ` · ${t.instrument.toUpperCase()}` : ''}
                  {t.active ? ' · [N] TICK' : ''}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {start + 3 < n && (
          <div className="lbl" style={{ fontSize: 18, color: 'var(--g3)' }}>
            ▼ {n - start - 3} MORE
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── RETURN NOW ─────────────────────────────

export function ReturnNow({ s }: { s: Snapshot }) {
  const r = s.ret;
  return (
    <AnimatePresence>
      {r && (
        <motion.div
          key="ret"
          className="absolute pulse-border"
          style={{ left: 16, top: 94, width: 1888, height: 908, background: '#000', border: '4px solid var(--r)', zIndex: 30 }}
          initial={{ opacity: 0, scale: 1.02 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease }}
        >
          <div className="absolute flex items-center hatch-red" style={{ left: 0, top: 0, right: 0, height: 104, background: 'var(--r)', padding: '0 34px', justifyContent: 'space-between' }}>
            <span className="blink" style={{ fontFamily: 'var(--font-ui)', fontWeight: 900, fontSize: 76, letterSpacing: '0.12em', color: '#000' }}>
              RETURN NOW
            </span>
            <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 26, letterSpacing: '0.1em', color: '#000' }}>
              {r.source === 'alert' ? `HAB ALERT · ${r.code}` : 'ONBOARD SAFETY CORE'}
            </span>
          </div>
          <div className="absolute" style={{ left: 40, top: 128, width: 1800, fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 40, color: 'var(--a)', letterSpacing: '0.03em' }}>
            {r.reason.toUpperCase()}
          </div>
          <div className="absolute" style={{ left: 70, top: 220 }}>
            <BearingDial rel={r.relDeg} size={600} color="var(--a)" />
          </div>
          <div className="absolute flex flex-col" style={{ left: 760, top: 210, width: 1080 }}>
            <div className="lbl" style={{ fontSize: 26 }}>
              Distance to {r.target} along confirmed route
            </div>
            <div className="num" style={{ fontSize: 190, lineHeight: '190px', color: 'var(--w)' }}>
              {fmtDist(r.distM).v}
              <span className="lbl" style={{ fontSize: 50, marginLeft: 12 }}>
                {fmtDist(r.distM).u}
              </span>
            </div>
            <div className="num" style={{ fontSize: 44, color: 'var(--a)', marginTop: 4 }}>
              {clockText(r.relDeg) === 12 ? 'ON TRACK' : `TURN TO ${clockText(r.relDeg)} O'CLOCK`} · FOLLOW ROUTE BACK
            </div>
            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 20, marginTop: 40 }}>
              {[
                ['ETA nominal', `${fmtMin(r.etaMin)}`, 'MIN', 'var(--w)'],
                ['ETA contingency', `${fmtMin(r.walkbackEtaMin)}`, 'MIN', 'var(--w)'],
                ['Walkback margin', s.walkbackMarginMin === null ? '—' : fmtMin(s.walkbackMarginMin), 'MIN', s.walkbackMarginMin !== null && s.walkbackMarginMin < 10 ? 'var(--r)' : 'var(--w)'],
                ['To shelter', fmtMin(s.shelterMin), 'MIN', s.shelterMin !== null && s.shelterMin > 30 ? 'var(--r)' : 'var(--w)'],
              ].map(([l, v, u, c]) => (
                <div key={l} style={{ borderTop: '3px solid var(--line)', paddingTop: 10 }}>
                  <div className="lbl" style={{ fontSize: 20 }}>
                    {l}
                  </div>
                  <div className="num" style={{ fontSize: 64, color: c }}>
                    {v}
                    <span className="lbl" style={{ fontSize: 22, marginLeft: 6 }}>
                      {u}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="lbl" style={{ fontSize: 20, color: 'var(--g3)', marginTop: 34 }}>
              Onboard guidance · works without the surface link · O₂ {Math.round(s.o2Pct)}% · position <span style={{ textTransform: 'none' }}>1σ</span> ±{Math.round(s.sigmaM)} M
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────────── WAITING / COMPLETE / BOOT ─────────────────────────────

export function WaitingOverlay({ s }: { s: Snapshot }) {
  const show = s.display === 'WAITING_FOR_ROUTE' || (s.display === 'NEW_ROUTE' && s.seq === null);
  return (
    <AnimatePresence>
      {show && (
        <motion.div key="wait" className="absolute flex flex-col items-center" style={{ left: 0, top: 0, width: MAP_W, height: MAP_H, zIndex: 15, background: 'rgba(0,0,0,0.6)', paddingTop: 120 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
          <svg width={240} height={240} viewBox="0 0 240 240">
            {[110, 76, 42].map((r) => (
              <circle key={r} cx={120} cy={120} r={r} fill="none" stroke="var(--g3)" strokeWidth={2} />
            ))}
            <g className="scan">
              <path d="M 120 120 L 120 10 A 110 110 0 0 1 198 42 Z" fill="rgba(77,255,148,0.22)" />
              <line x1={120} y1={120} x2={120} y2={10} stroke="var(--g)" strokeWidth={3} />
            </g>
            <circle cx={120} cy={120} r={6} fill="var(--g)" />
          </svg>
          <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 54, color: 'var(--w)', letterSpacing: '0.08em', marginTop: 30 }}>AWAITING ROUTE</div>
          <div className="lbl" style={{ fontSize: 24, marginTop: 10 }}>
            The hab pushes the confirmed route over the surface link
          </div>
          <div className="num" style={{ fontSize: 24, marginTop: 18, color: s.link === 'up' ? 'var(--g)' : 'var(--a)' }}>
            LINK {s.link === 'up' ? 'UP · LISTENING' : s.link === 'degraded' ? 'DEGRADED' : 'DOWN · RETRYING'}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CompleteOverlay({ s }: { s: Snapshot }) {
  return (
    <AnimatePresence>
      {s.display === 'COMPLETE' && (
        <motion.div key="done" className="absolute flex flex-col items-center" style={{ left: 0, top: 0, width: MAP_W, height: MAP_H, zIndex: 15, background: 'rgba(0,0,0,0.8)', paddingTop: 220 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
          <div className="lbl" style={{ fontSize: 26, color: 'var(--c)' }}>
            Ingress
          </div>
          <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 72, color: 'var(--w)', letterSpacing: '0.06em' }}>AT {s.homeName} · EVA COMPLETE</div>
          <div className="flex" style={{ gap: 70, marginTop: 50 }}>
            {[
              ['Elapsed', `T+${fmtElapsed(s.t)}`],
              ['Walked', `${fmtDist(s.odoM).v} ${fmtDist(s.odoM).u}`],
              ['Stations', `${s.visitedCount}/${s.stopsTotal}`],
              ['O₂ left', `${Math.round(s.o2Pct)}%`],
            ].map(([l, v]) => (
              <div key={l} className="flex flex-col items-center">
                <div className="lbl" style={{ fontSize: 22 }}>
                  {l}
                </div>
                <div className="num" style={{ fontSize: 50, color: 'var(--w)' }}>
                  {v}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function BootScreen({ s }: { s: Snapshot }) {
  return (
    <AnimatePresence>
      {!s.ready && (
        <motion.div key="boot" className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: '#000', zIndex: 60 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
          <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 84, letterSpacing: '0.3em', color: 'var(--g)' }}>MARSWALK</div>
          <div className="lbl" style={{ fontSize: 28, marginTop: 6 }}>
            EVA visor · glass cockpit
          </div>
          <div style={{ width: 520, height: 6, background: 'var(--g4)', marginTop: 60, overflow: 'hidden' }}>
            <motion.div style={{ width: 160, height: 6, background: 'var(--g)' }} animate={{ x: [-160, 520] }} transition={{ repeat: Infinity, duration: 1.2, ease: 'linear' }} />
          </div>
          <div className="num" style={{ fontSize: 26, marginTop: 24, color: s.bootError ? 'var(--r)' : 'var(--g2)' }}>
            {s.bootError ? `BOOT FAULT: ${s.bootError}` : s.bootStage}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────────────────────────── toasts ─────────────────────────────

export function Toasts({ s }: { s: Snapshot }) {
  const col = { info: 'var(--g2)', ok: 'var(--g)', caution: 'var(--a)', warning: 'var(--r)' } as const;
  return (
    <div className="absolute flex flex-col-reverse" style={{ left: 40, bottom: 132, gap: 10, zIndex: 35, width: 1000 }}>
      <AnimatePresence initial={false}>
        {s.toasts.slice(-2).reverse().map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.3, ease }}
            style={{ alignSelf: 'flex-start', padding: '8px 18px', background: '#000', border: `3px solid ${col[t.level]}`, color: col[t.level], fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 26, letterSpacing: '0.05em' }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function MapLegend({ s }: { s: Snapshot }) {
  const item = (sw: React.ReactNode, label: string) => (
    <div className="flex items-center" style={{ gap: 8 }}>
      {sw}
      <span className="lbl" style={{ fontSize: 16, color: 'var(--g2)', whiteSpace: 'nowrap', letterSpacing: '0.08em' }}>
        {label}
      </span>
    </div>
  );
  return (
    <div className="absolute flex items-center" style={{ left: 0, bottom: 0, right: 0, height: 44, padding: '0 16px', gap: 20, zIndex: 5, background: 'rgba(0,0,0,0.82)', borderTop: '2px solid var(--line)' }}>
      {item(<svg width={34} height={12}><line x1={2} y1={6} x2={32} y2={6} stroke="var(--g)" strokeWidth={6} strokeLinecap="round" /></svg>, 'Route')}
      {item(<svg width={34} height={12}><line x1={2} y1={6} x2={32} y2={6} stroke="var(--c)" strokeWidth={3} strokeDasharray="9 6" /></svg>, 'Safe zone')}
      {s.comm.available && item(<div className="hatch-amber" style={{ width: 30, height: 16, border: '2px dashed rgba(255,182,39,0.6)' }} />, 'Comm shadow')}
      {item(<div className="hatch-red" style={{ width: 30, height: 16, border: '2px solid var(--r)' }} />, 'Keep-out')}
      {item(<svg width={18} height={18}><rect x={3} y={3} width={12} height={12} transform="rotate(45 9 9)" fill="var(--a)" /></svg>, 'Next stop')}
      <div style={{ flex: 1 }} />
      <span className="num" style={{ fontSize: 14, color: 'var(--g3)', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
        {s.credit}
      </span>
    </div>
  );
}

export { fmtCountdown, fmtLtst };
