/**
 * Zentry-style reveal animations, built dependency-free.
 *
 *  - useReveal3D      — word-level 3D tilt entrance (rotateY/rotateX/translate)
 *  - useClipPortal    — circular → irregular polygon clip-path morph on scroll
 *  - useExpandPanel   — small centered panel expands to full-bleed on scroll (scrub)
 *  - useLoaderProgress— boot-loader progress simulation (readiness + minimum time)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { prefersReducedMotion } from "./animations";
import { observeScrub } from "../lib/scroll";

const THEME_ATTR = "data-theme";

/**
 * Dynamic background theme: the page crossfades between machine bays as you
 * scroll — inherited CSS custom properties make every surface respond.
 */
export function useScrollTheme(): void {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const sections = document.querySelectorAll<HTMLElement>("[data-theme]");
    if (!sections.length) return;

    let raf = 0;
    const pick = () => {
      raf = 0;
      const center = window.innerHeight * 0.42;
      let best: HTMLElement | null = null;
      let bestDist = Infinity;
      for (const s of sections) {
        const r = s.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        const dist = Math.abs(r.top + r.height / 2 - center);
        if (dist < bestDist) { bestDist = dist; best = s; }
      }
      if (best) document.documentElement.setAttribute(THEME_ATTR, best.dataset.theme ?? "");
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(pick); };
    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
}

/** Split text into word spans prepared for the 3D entrance. */
export function useRevealWords(text: string, startDelay = 0): { words: string[]; delays: number[] } {
  return useMemo(() => {
    const words = text.split(" ");
    return { words, delays: words.map((_, i) => startDelay + i * 90) };
  }, [text, startDelay]);
}

/**
 * Circular → irregular polygon "portal" morph, scrubbed by scroll (Zentry's
 * signature video-frame reveal, applied to a content panel).
 */
export function useClipPortal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return setProgress(1), undefined;
    return observeScrub(el, { start: 0.92, end: 0.35 })(e => setProgress(e.progress));
  }, []);

  // radius in % of half-width — from a soft rounded panel (20%) to 0 (sharp edges)
  const radius = 20 * (1 - progress);
  // a wobbly polygon: verts drift from center-ish (circle feel) to full spread
  const spread = 50 * progress;
  const clip = (() => {
    if (radius > 19.2) return "circle(120% at 50% 50%)"; // before reveal: big soft blob
    const px = (x: number) => `${50 + (spread * (x - 50)) / 50}%`;
    const py = (y: number) => `${50 + (spread * (y - 50)) / 50}%`;
    // irregular octagon — asymmetric, portal-like silhouette
    const verts: Array<[number, number]> = [[8, 12], [70, 2], [96, 30], [88, 82], [55, 98], [12, 90], [2, 45]];
    return `polygon(${verts.map(([x, y]) => `${px(x)} ${py(y)}`).join(", ")})`;
  })();

  const borderRadius = `${Math.max(0, radius) * 1.4}px`;

  return { ref, progress, clip, borderRadius };
}

/**
 * Small centered panel expands to full viewport width over its scroll range,
 * losing its radius as it goes (Zentry's pinned mask expansion, scrub: real).
 */
export function useExpandPanel<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return setProgress(1), undefined;
    return observeScrub(el, { start: 0.95, end: 0.25 })(e => setProgress(e.progress));
  }, []);

  const eased = 1 - Math.pow(1 - progress, 3);
  // width: 62% → 100%; height: 420px → 78vh; radius 28px → 0
  const width = 62 + 38 * eased;
  const heightPx = 420 + 420 * eased;
  const radius = Math.max(0, 28 * (1 - eased));

  return { ref, progress, eased, width, heightPx, radius };
}

/** Float → clamp loader progress; resolves when (target reached) AND min time passed. */
export function useLoaderProgress(minMs: number, done: boolean): { pct: number; finished: boolean } {
  const [pct, setPct] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion() || done) {
      setPct(100);
      return;
    }
    const started = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / minMs);
      // eased approach so the last 2% takes a moment ("real" boot feel)
      const e = 1 - Math.pow(1 - t, 2.2);
      const target = Math.floor(e * 100);
      setPct(target);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setFinished(true);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [minMs, done]);

  return { pct, finished: finished || done || prefersReducedMotion() };
}
