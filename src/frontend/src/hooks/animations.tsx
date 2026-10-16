/** Animation hooks: text scramble, typewriter, word reveal, scroll reveal. */
import { useEffect, useRef, useState } from "react";

/**
 * Prefers-reduced-motion users get instant text, no glyph cycling.
 * `?motion=full` force-enables animation regardless (testing + demos on
 * motion-restricted machines).
 */
export function prefersReducedMotion(): boolean {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("motion") === "full"
  ) {
    return false;
  }
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const GLYPHS = "!<>-_\\/[]{}—=+*^?#________ABCDEFGH0123456789";

/**
 * Scramble-decode: characters resolve left-to-right, unresolved ones cycle
 * through glyphs. Settles within `settleMs`.
 */
export function useTextScramble(target: string, settleMs = 900, startDelay = 250): string {
  const [output, setOutput] = useState("");
  const frame = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setOutput(target);
      return;
    }
    let raf = 0;
    let timer = 0;
    const startedAt = performance.now() + startDelay;

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed < 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const progress = Math.min(1, elapsed / settleMs);
      const resolved = Math.floor(progress * target.length);
      let next = "";
      for (let i = 0; i < target.length; i++) {
        const ch = target[i];
        if (i < resolved || ch === " ") next += ch;
        else next += GLYPHS[(frame.current * 7 + i * 13) % GLYPHS.length];
      }
      frame.current += 1;
      setOutput(next);
      if (progress < 1) raf = requestAnimationFrame(tick);
      else setOutput(target);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [target, settleMs, startDelay]);

  return output;
}

/** Character-by-character typewriter with a blinking caret rendered by CSS. */
export function useTypewriter(text: string, msPerChar = 34, startDelay = 500): { shown: string; done: boolean } {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let interval = 0;
    const timeout = window.setTimeout(() => {
      interval = window.setInterval(() => {
        setCount((c) => {
          if (c >= text.length) {
            clearInterval(interval);
            return c;
          }
          return c + 1;
        });
      }, msPerChar);
    }, startDelay);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [text, msPerChar, startDelay]);

  return { shown: text.slice(0, count), done: count >= text.length };
}

/** Word-by-word fade-in stagger for sub-headlines. Returns per-word delays. */
export function useWordStagger(words: string[], stepMs = 55, startDelay = 350): number[] {
  return words.map((_, i) => startDelay + i * stepMs);
}

/**
 * Scroll reveal via IntersectionObserver. Attach the returned ref to any
 * element; it gains `is-visible` when 15% of it enters the viewport.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}): { ref: React.RefObject<T>; visible: boolean } {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      setVisible(true);
      el.classList.add("is-visible");
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            entry.target.classList.add("is-visible");
            if (options?.once !== false) observer.unobserve(entry.target);
          }
        }
      },
      {
        threshold: options?.threshold ?? 0.15,
        rootMargin: options?.rootMargin ?? "0px 0px -10% 0px"
      }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [options?.threshold, options?.rootMargin, options?.once]);

  return { ref, visible };
}

/** Split a heading into per-character spans for the split-text reveal. */
export function SplitChars({ text }: { text: string }): JSX.Element {
  return (
    <span className="split-chars" aria-label={text}>
      {text.split("").map((ch, i) => (
        <span key={i} className="ch" style={{ transitionDelay: `${i * 20}ms` }} aria-hidden="true">
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  );
}

/** Tracks window scroll past a threshold (header border, hero parallax). */
export function useScrolled(threshold = 12): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

/**
 * Page-level reveal: watches every `.reveal` element that does not already have
 * a hook-managed ref and flips `is-visible` on when it enters the viewport.
 * Mount once per page (Landing, Pricing). Respects reduced motion + ?motion=full.
 * `deps` lets pages re-scan after gated content (e.g. the boot loader) renders.
 * Uses IntersectionObserver with a rAF scroll fallback so reveal never depends
 * on quirky observer behavior in any embedded browser.
 */
export function usePageReveals(deps: unknown[] = []): void {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)"));
    if (prefersReducedMotion()) {
      for (const el of els) el.classList.add("is-visible");
      return;
    }
    const remaining = new Set(els);

    const check = () => {
      const vh = window.innerHeight;
      for (const el of remaining) {
        const top = el.getBoundingClientRect().top;
        if (top < vh * 0.9) {
          el.classList.add("is-visible");
          remaining.delete(el);
        }
      }
      if (!remaining.size) {
        window.clearInterval(iv);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
    };
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        check();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // Safety net: a slow 200 ms poll while elements are pending, so reveal works
    // even in embedded browsers that drop scroll events. Self-clears when done.
    const iv = window.setInterval(check, 200);
    const finish = () => {
      window.clearInterval(iv);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    check();

    return finish;
  }, deps);
}
