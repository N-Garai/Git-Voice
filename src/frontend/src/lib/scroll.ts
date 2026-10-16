/**
 * Tiny scroll engine — rAF-batched scroll/resize listener + IntersectionObserver.
 * Zero dependencies; consumers turn progress numbers into transforms/clip-paths.
 */

export interface ScrollEntry {
  /** 0 → 1 as the element's scannable range passes through the viewport. */
  progress: number;
}

type Subscriber = (e: ScrollEntry) => void;

interface Tracked {
  el: Element;
  start: number;
  end: number;
  subs: Set<Subscriber>;
  visible: boolean;
}

const tracked = new Set<Tracked>();
let listening = false;
let ticking = false;

/** Defaults: animation starts when the element's top is 85% down the viewport and
 *  completes when it reaches 30%. */
export function observeScrub(el: Element, opts?: { start?: number; end?: number }): (cb: Subscriber) => void {
  const startVh = opts?.start ?? 0.85;
  const endVh = opts?.end ?? 0.3;

  const entry: Tracked = { el, start: 0, end: 0, subs: new Set(), visible: true };
  const subscribe = (cb: Subscriber) => {
    entry.subs.add(cb);
    return () => entry.subs.delete(cb);
  };

  const measure = () => {
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    // Scroll distance over which progress travels.
    const span = Math.max(1, (startVh - endVh) * vh + rect.height * (endVh > 0 ? 0 : 0));
    entry.start = rect.top + window.scrollY - vh * startVh;
    entry.end = entry.start + span + rect.height * 0.35;
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const y = window.scrollY;
      for (const t of tracked) {
        if (!t.subs.size) continue;
        const p = Math.min(1, Math.max(0, (y - t.start) / Math.max(1, t.end - t.start)));
        for (const cb of t.subs) cb({ progress: p });
      }
    });
  };

  if (!listening) {
    listening = true;
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
  }

  tracked.add(entry);
  // Measure twice: layout may shift after fonts settle.
  measure();
  requestAnimationFrame(measure);
  onScroll();

  return subscribe;
}
