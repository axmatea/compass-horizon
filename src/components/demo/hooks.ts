"use client";

import { useEffect, useRef, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/** Animates a number from its previous value to the new one. Off under reduced motion. */
export function useTicker(value: number | null | undefined, duration = 700): number | null {
  const reduced = usePrefersReducedMotion();
  const [prev, setPrev] = useState(value);
  const [from, setFrom] = useState<number | null>(null);
  const [k, setK] = useState(1);
  if (value !== prev) {
    const ok = typeof prev === "number" && Number.isFinite(prev) && typeof value === "number" && Number.isFinite(value);
    setPrev(value);
    setFrom(ok && !reduced ? (prev as number) : null);
    setK(0);
  }
  useEffect(() => {
    if (from === null) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const kk = Math.min(1, (t - t0) / duration);
      setK(kk);
      if (kk < 1) raf = requestAnimationFrame(tick);
      else setFrom(null);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, value, duration]);
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (from === null) return value;
  const e = 1 - Math.pow(1 - k, 3);
  return from + (value - from) * e;
}

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>(fallback = 1200): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.round(w));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
