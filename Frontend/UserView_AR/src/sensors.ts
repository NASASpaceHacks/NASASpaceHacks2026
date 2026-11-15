import { useEffect, useRef, useState } from 'react';

/** Rear camera into a <video>. Needs a secure origin (HTTPS or localhost). */
export function useCamera(enabled: boolean) {
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  useEffect(() => {
    if (!enabled) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setState('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        const v = ref.current;
        if (v) {
          v.srcObject = s;
          void v.play().catch(() => {});
        }
        setState('on');
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setState('off');
    };
  }, [enabled]);
  return { ref, state };
}

type IOSOrientationEvent = DeviceOrientationEvent & { webkitCompassHeading?: number };
type IOSOrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

/** iOS asks for motion permission; must be called from a tap handler. */
export async function requestCompassPermission(): Promise<boolean> {
  const C = (globalThis as { DeviceOrientationEvent?: IOSOrientationCtor }).DeviceOrientationEvent;
  if (!C) return false;
  if (typeof C.requestPermission !== 'function') return true;
  try {
    return (await C.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** Device compass heading in degrees (0 = north, clockwise), smoothed; null until the first reading. */
export function useCompass(enabled: boolean): number | null {
  const [hdg, setHdg] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) {
      setHdg(null);
      return;
    }
    let cur: number | null = null;
    let raf = 0;
    let pending: number | null = null;
    const onEv = (e: Event) => {
      const ev = e as IOSOrientationEvent;
      let h: number | null = null;
      if (typeof ev.webkitCompassHeading === 'number') h = ev.webkitCompassHeading;
      else if (ev.absolute && ev.alpha !== null) h = 360 - ev.alpha;
      if (h === null) return;
      h += screen.orientation?.angle ?? 0;
      // Exponential smoothing on the circle.
      if (cur === null) cur = h;
      else cur += (((h - cur + 540) % 360) - 180) * 0.25;
      pending = ((cur % 360) + 360) % 360;
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        setHdg(pending);
      });
    };
    const evName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evName, onEv);
    return () => {
      window.removeEventListener(evName, onEv);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return hdg;
}

/** Keep the screen on while navigating (supported on iOS 16.4+). */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const get = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    void get();
    const onVis = () => document.visibilityState === 'visible' && void get();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [enabled]);
}
