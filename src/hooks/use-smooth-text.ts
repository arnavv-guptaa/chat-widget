import { useEffect, useRef, useState } from "react";

/**
 * Rate-aware, paced smoothing buffer for streamed text.
 *
 * THE PROBLEM: the model streams text in coarse, irregular bursts — a chunk,
 * then a gap, then another chunk. Rendering chunks as they land looks "chunky";
 * draining them as fast as possible (a naive buffer) just moves the chunkiness
 * to a "burst → empty → stop → burst" rhythm, because the buffer races to empty
 * and then has nothing to show until the next chunk arrives.
 *
 * THE FIX — paced reveal with a small cushion: estimate the recent arrival rate
 * and reveal characters at a STEADY speed tracking that rate, deliberately
 * keeping a small reserve of received-but-unshown text. That reserve is spent
 * gliding through the gaps between chunks, so the output is continuous instead
 * of bursty. The price is a small, BOUNDED trailing lag (~a few hundred ms of
 * text) — which self-corrects:
 *
 *   - Cushion too big (model sped up / a big chunk landed) → reveal faster to
 *     pull the lag back under the cap. Never falls far behind.
 *   - Cushion near empty (model paused) → ease off so we don't stall abruptly;
 *     if it genuinely runs dry we simply wait for more (rare with a cushion).
 *
 * When streaming ends (or the text is replaced/shrinks) we snap to the full
 * text immediately — nothing is ever lost or left lagging.
 */

// Tuning (the "small cushion" profile).
const TARGET_LAG_MS = 220; // aim to keep ~this much text in reserve to glide over gaps
const MAX_LAG_MS = 600; // hard cap — above this, sprint to catch up (never lag more)
const MIN_CPS = 25; // floor reveal speed (chars/sec) so slow streams still move
const MAX_CPS = 1400; // ceiling so a huge backlog reveals fast but not instantly
const RATE_SMOOTHING = 0.15; // EMA factor for the arrival-rate estimate (lower = smoother)

/**
 * Whether the user has requested reduced motion. Read once per hook instance
 * (the preference effectively never flips mid-stream). SSR-safe: defaults to
 * `false` when matchMedia is unavailable, so server render === first client
 * render and there's no hydration mismatch.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useSmoothText(target: string, enabled: boolean): string {
  // ACCESSIBILITY: the per-character RAF drip below mutates the DOM dozens of
  // times per second. Inside a live region, screen readers that batch
  // announcements (NVDA+Chrome, VoiceOver+Safari) sample mid-drip and announce
  // only a fragment — or nothing. Users who set "reduce motion" (commonly SR
  // users) get the full text immediately instead, so the live region announces
  // coherent chunks as they arrive from the model. This also disables the
  // purely-decorative typing animation, which is the documented intent of the
  // preference. Visual layout and stick-to-bottom are unaffected.
  const reduceMotion = prefersReducedMotion();
  const animate = enabled && !reduceMotion;

  const [displayed, setDisplayed] = useState(target);

  const targetRef = useRef(target);
  const shownLenRef = useRef(target.length);
  const rafRef = useRef<number | null>(null);

  // Arrival-rate tracking (chars/ms), and a fractional cursor so sub-1-char/frame
  // speeds still progress smoothly over time.
  const rateRef = useRef(0); // EMA of arrival rate (chars per ms)
  const lastTargetLenRef = useRef(target.length);
  const lastTimeRef = useRef(0);
  const shownFracRef = useRef(target.length); // fractional reveal cursor

  targetRef.current = target;

  useEffect(() => {
    if (!animate) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      shownLenRef.current = target.length;
      shownFracRef.current = target.length;
      lastTargetLenRef.current = target.length;
      setDisplayed(target);
      return;
    }

    // Fresh stream / reset if the target shrank (component reused for a new msg).
    if (target.length < shownLenRef.current) {
      shownLenRef.current = 0;
      shownFracRef.current = 0;
    }
    rateRef.current = 0;
    lastTargetLenRef.current = target.length;
    lastTimeRef.current = 0;

    const tick = (now: number) => {
      const full = targetRef.current;

      // dt since last frame (ms). First frame seeds time and bails.
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = now;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(100, now - lastTimeRef.current); // clamp dt (tab-switch safety)
      lastTimeRef.current = now;

      // Update arrival-rate estimate from newly-received text this frame.
      const arrived = full.length - lastTargetLenRef.current;
      lastTargetLenRef.current = full.length;
      if (dt > 0) {
        const instRate = arrived / dt; // chars per ms this frame
        rateRef.current =
          rateRef.current === 0
            ? instRate
            : rateRef.current * (1 - RATE_SMOOTHING) + instRate * RATE_SMOOTHING;
      }

      const shown = shownFracRef.current;
      const backlog = full.length - shown;

      if (backlog <= 0) {
        // Caught up; idle but keep the loop alive — more text may arrive.
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // How much "time worth" of text are we currently behind by?
      const rate = rateRef.current; // chars/ms
      const lagMs = rate > 0 ? backlog / rate : TARGET_LAG_MS;

      // Base reveal speed = recent arrival rate (so we track the model), then
      // nudged by how the cushion compares to target: behind target → speed up,
      // ahead of target → ease down. Sprint hard if past the hard cap.
      let cps = rate * 1000; // chars/sec tracking arrival
      if (lagMs > MAX_LAG_MS) {
        cps = Math.max(cps, (backlog / (MAX_LAG_MS / 1000)) * 1.5); // sprint to catch up
      } else if (lagMs > TARGET_LAG_MS) {
        cps *= 1.25; // a touch faster to trim toward the target cushion
      } else {
        cps *= 0.85; // hold back a little to keep the cushion and glide gaps
      }
      cps = Math.min(MAX_CPS, Math.max(MIN_CPS, cps));

      const advance = (cps / 1000) * dt; // chars this frame (fractional)
      const nextFrac = Math.min(full.length, shown + advance);
      shownFracRef.current = nextFrac;

      const nextLen = Math.floor(nextFrac);
      if (nextLen !== shownLenRef.current) {
        shownLenRef.current = nextLen;
        setDisplayed(full.slice(0, nextLen));
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // Loop reads latest target via ref; only restart when animation toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  return animate ? displayed : target;
}
