/* ═══════════════════════════════════════════════════
   sound.ts — synthesized stone-placement click
   Uses Web Audio API — no external files needed.
   ═══════════════════════════════════════════════════ */

let audioCtx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  // Resume if suspended (browsers require user gesture)
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

/**
 * Synthesize a short percussive "click" that mimics a
 * Go stone being placed firmly on a wooden board.
 *
 * Uses a very short noise burst → low-pass filter → fast decay.
 * The result is a warm, wooden "clack".
 */
export function playStoneSound(): void {
  try {
    const c = ctx();
    const now = c.currentTime;

    // ── 50ms noise burst ──
    const duration = 0.05;
    const sampleRate = c.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const buffer = c.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      // White noise × sharp exponential decay
      const t = i / sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t / 0.006);
    }

    const source = c.createBufferSource();
    source.buffer = buffer;

    // ── Low-pass → wooden "thud" rather than harsh hiss ──
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, now);

    // ── Subtle resonant peak → body ──
    const peak = c.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.setValueAtTime(400, now);
    peak.Q.setValueAtTime(0.8, now);
    peak.gain.setValueAtTime(6, now);

    // ── Gain envelope: quick attack, fast decay ──
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    source.connect(lp);
    lp.connect(peak);
    peak.connect(gain);
    gain.connect(c.destination);

    source.start(now);
    source.stop(now + 0.1);
  } catch {
    // Silently ignore — audio is non-critical
  }
}

/**
 * Capture sound — deeper, richer than the placement click.
 * Two quick taps in succession, lower filter → sounds like
 * multiple stones being lifted off the board.
 */
export function playCaptureSound(): void {
  try {
    const c = ctx();
    const now = c.currentTime;

    const playTap = (delay: number, lpFreq: number, vol: number) => {
      const t = now + delay;
      const sampleRate = c.sampleRate;
      const length = Math.floor(sampleRate * 0.06);
      const buffer = c.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < length; i++) {
        const s = i / sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-s / 0.009);
      }

      const source = c.createBufferSource();
      source.buffer = buffer;

      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lpFreq, t);

      const peak = c.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.setValueAtTime(300, t);
      peak.Q.setValueAtTime(0.9, t);
      peak.gain.setValueAtTime(5, t);

      const gain = c.createGain();
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      source.connect(lp);
      lp.connect(peak);
      peak.connect(gain);
      gain.connect(c.destination);

      source.start(t);
      source.stop(t + 0.12);
    };

    // Two taps: first at 0ms, second at 60ms — lower, richer
    playTap(0, 1200, 0.5);
    playTap(0.06, 900, 0.45);
  } catch {
    // Silent
  }
}
