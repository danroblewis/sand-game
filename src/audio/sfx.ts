// Synthesised sound effects (Web Audio API, no assets). Soft, short, tactile; modest levels.
//
// Every sound is a pure "synth" that schedules nodes on any BaseAudioContext, so the same code runs
// live (AudioContext) and offline (OfflineAudioContext, for level measurement). The live engine:
// - creates the AudioContext lazily on the first user gesture (never autoplays; iOS unlock),
// - master gain -> gentle compressor (safety limiter) -> destination,
// - one shared noise buffer, at most MAX_VOICES concurrent one-shots,
// - a continuous sand hiss (looping band-passed noise) whose level follows the flow rate.

export type SoundName = 'pop' | 'thaw' | 'land' | 'step' | 'climb' | 'push' | 'slide' | 'undo' | 'win' | 'debris' | 'belt';

export interface SoundOpts {
  /** Box color index (pop pitch). */
  color?: number;
  /** Cells fallen (land loudness). */
  fell?: number;
  /** Alternating foot (step pitch). */
  foot?: 0 | 1;
  /** Start offset in seconds (group pop stagger). */
  delay?: number;
}

const MASTER_GAIN = 0.5;
/** One-shot level trim (the compressor in the master chain pulls levels down; measured offline). */
const LEVEL = 3;
/** Sand hiss gain at full flow (before master). */
const HISS_LEVEL = 0.14;
const MAX_VOICES = 8;

// ---------------------------------------------------------------------------------------------
// Building blocks

export function makeNoise(ctx: BaseAudioContext, seconds = 1): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x9e3779b9;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    d[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  return buf;
}

/** Attack/exponential-decay envelope on a gain param. */
function env(g: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak * LEVEL, t + attack);
  g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, t: number, f0: number, f1: number, glide: number, peak: number, attack: number, decay: number): number {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + glide);
  env(g.gain, t, peak, attack, decay);
  o.connect(g).connect(out);
  const end = t + attack + decay + 0.02;
  o.start(t);
  o.stop(end);
  return end;
}

function noiseBurst(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, filter: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack: number, decay: number): number {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const bq = ctx.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) bq.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
  const g = ctx.createGain();
  env(g.gain, t, peak, attack, decay);
  src.connect(bq).connect(g).connect(out);
  const end = t + attack + decay + 0.02;
  src.start(t, Math.random() * 0.5);
  src.stop(end);
  return end;
}

// Pentatonic pitch per color so simultaneous (group) pops chord nicely.
const PENTA = [0, 2, 4, 7, 9];
function popFreq(color: number): number {
  const c = Math.max(0, (color | 0) - 1);
  return 587.33 * Math.pow(2, (PENTA[c % 5] + 12 * Math.floor(c / 5) * 0.5) / 12);
}

type Synth = (ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t: number, o: SoundOpts) => number;

// ---------------------------------------------------------------------------------------------
// The palette. Each returns the time it ends.

export const SYNTHS: Record<SoundName, Synth> = {
  // Box completed: bright blip gliding up + two short sine sparkle partials.
  pop: (ctx, out, _n, t, o) => {
    const f = popFreq(o.color ?? 1);
    let end = tone(ctx, out, 'triangle', t, f, f * 1.5, 0.06, 0.32, 0.004, 0.14);
    end = Math.max(end, tone(ctx, out, 'sine', t + 0.025, f * 3, f * 3, 0, 0.06, 0.002, 0.07));
    end = Math.max(end, tone(ctx, out, 'sine', t + 0.045, f * 4.5, f * 4.5, 0, 0.045, 0.002, 0.06));
    return end;
  },
  // Thaw: crystalline chime, three notes (down, down, up).
  thaw: (ctx, out, _n, t) => {
    let end = t;
    [1567.98, 1318.51, 1760].forEach((f, i) => {
      end = Math.max(end, tone(ctx, out, 'sine', t + i * 0.07, f, f, 0, 0.13, 0.003, 0.26));
      end = Math.max(end, tone(ctx, out, 'sine', t + i * 0.07, f * 2.01, f * 2.01, 0, 0.03, 0.002, 0.12));
    });
    return end;
  },
  // Box / hero landed: low thud scaled by cells fallen (1 = tick, 6 = thump).
  land: (ctx, out, noise, t, o) => {
    const k = 0.25 + 0.75 * Math.min(1, Math.max(1, o.fell ?? 1) / 6);
    let end = noiseBurst(ctx, out, noise, t, 'lowpass', 500 + 300 * k, 250, 0.7, 0.45 * k, 0.002, 0.05 + 0.05 * k);
    end = Math.max(end, tone(ctx, out, 'sine', t, 150, 55, 0.12, 0.42 * k, 0.003, 0.1 + 0.08 * k));
    return end;
  },
  // Hero step: soft tick, alternating feet.
  step: (ctx, out, noise, t, o) => {
    const f = o.foot ? 1150 : 920;
    let end = tone(ctx, out, 'triangle', t, f, f * 0.8, 0.03, 0.12, 0.002, 0.035);
    end = Math.max(end, noiseBurst(ctx, out, noise, t, 'bandpass', 2400, 2400, 1.5, 0.09, 0.001, 0.02));
    return end;
  },
  // Hero climbed: slightly higher double tick.
  climb: (ctx, out, _n, t) => {
    const a = tone(ctx, out, 'triangle', t, 1300, 1100, 0.03, 0.11, 0.002, 0.035);
    return Math.max(a, tone(ctx, out, 'triangle', t + 0.06, 1550, 1300, 0.03, 0.12, 0.002, 0.04));
  },
  // Hero pushed a box: short band-passed scrape.
  push: (ctx, out, noise, t) => noiseBurst(ctx, out, noise, t, 'bandpass', 700, 1150, 1.2, 0.4, 0.01, 0.07),
  // Box dragged one cell: very quiet slide tick.
  slide: (ctx, out, noise, t) => noiseBurst(ctx, out, noise, t, 'bandpass', 1800, 1500, 2, 0.08, 0.003, 0.03),
  // Undo: reversed-feeling downward blip.
  undo: (ctx, out, _n, t) => tone(ctx, out, 'sine', t, 880, 440, 0.12, 0.16, 0.02, 0.12),
  // Win: short 4-note arpeggio (C E G C).
  win: (ctx, out, _n, t) => {
    let end = t;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      end = Math.max(end, tone(ctx, out, 'triangle', t + i * 0.09, f, f, 0, 0.16, 0.005, 0.32));
      end = Math.max(end, tone(ctx, out, 'sine', t + i * 0.09, f * 2, f * 2, 0, 0.03, 0.004, 0.15));
    });
    return end;
  },
  // Debris dissolved: faint sparkle.
  debris: (ctx, out, _n, t) => {
    let end = t;
    for (let i = 0; i < 4; i++) {
      const f = 2200 + ((i * 7919) % 5) * 420;
      end = Math.max(end, tone(ctx, out, 'sine', t + i * 0.035, f, f, 0, 0.035, 0.002, 0.06));
    }
    return end;
  },
  // Belt step: barely audible click.
  belt: (ctx, out, _n, t) => tone(ctx, out, 'square', t, 1500, 1200, 0.008, 0.008, 0.001, 0.012),
};

// ---------------------------------------------------------------------------------------------
// Live engine

type Ctor = typeof AudioContext;

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private enabled: boolean;
  // Sand hiss
  private hissGain: GainNode | null = null;
  private hissFilter: BiquadFilterNode | null = null;
  private flowEnv = 0;
  private lastHissSet = 0;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** AudioContext state for debugging ('none' until the first gesture or if unsupported). */
  get state(): string {
    return this.ctx ? this.ctx.state : 'none';
  }

  /** Call from a user gesture: creates/resumes the context (iOS needs a sound started in the gesture). */
  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
        const C = w.AudioContext ?? w.webkitAudioContext;
        if (!C) return;
        const ctx = new C();
        this.ctx = ctx;
        this.noise = makeNoise(ctx, 1);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10;
        comp.knee.value = 8;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.15;
        this.master = ctx.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.master.connect(comp).connect(ctx.destination);
        // Sand hiss: looping noise -> band-pass -> gain (0 until sand flows).
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        this.hissFilter = ctx.createBiquadFilter();
        this.hissFilter.type = 'bandpass';
        this.hissFilter.frequency.value = 2200;
        this.hissFilter.Q.value = 0.9;
        this.hissGain = ctx.createGain();
        this.hissGain.gain.value = 0;
        src.connect(this.hissFilter).connect(this.hissGain).connect(this.master);
        src.start();
        // iOS: play a silent buffer inside the gesture to unlock output.
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        s.connect(ctx.destination);
        s.start(0);
      }
      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null; // audio unavailable: stay silent
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!this.ctx) {
      if (on) this.unlock();
      return;
    }
    try {
      if (on) void this.ctx.resume().catch(() => {});
      else {
        this.flowEnv = 0;
        this.hissGain?.gain.setValueAtTime(0, this.ctx.currentTime);
        void this.ctx.suspend().catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }

  /** One-shot sound. Silently ignored when muted, locked, unavailable, or over the voice cap. */
  play(name: SoundName, o: SoundOpts = {}): void {
    const ctx = this.ctx;
    if (!this.enabled || !ctx || !this.master || !this.noise || ctx.state !== 'running') return;
    if (this.voices >= MAX_VOICES) return;
    try {
      const t = ctx.currentTime + 0.005 + (o.delay ?? 0);
      const end = SYNTHS[name](ctx, this.master, this.noise, t, o);
      this.voices++;
      window.setTimeout(() => this.voices--, Math.max(0, (end - ctx.currentTime) * 1000) + 20);
    } catch {
      /* ignore */
    }
  }

  /**
   * Per frame: grains that crossed region edges per sim step (from `transfer` events). Drives the
   * hiss with a ~150 ms attack / ~300 ms release envelope; silent when nothing flows. No allocation.
   */
  update(dt: number, grainsPerStep: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.hissGain || !this.hissFilter || !this.enabled || ctx.state !== 'running') return;
    const target = grainsPerStep > 0 ? Math.min(1, Math.sqrt(grainsPerStep / 40)) : 0;
    const tau = target > this.flowEnv ? 0.15 : 0.3;
    this.flowEnv += (target - this.flowEnv) * (1 - Math.exp(-dt / tau));
    if (this.flowEnv < 0.002 && target === 0) this.flowEnv = 0;
    const now = ctx.currentTime;
    if (now - this.lastHissSet < 0.03) return; // ~30 Hz parameter updates are plenty
    this.lastHissSet = now;
    this.hissGain.gain.setTargetAtTime(HISS_LEVEL * this.flowEnv, now, 0.03);
    // brighter/higher with faster flow, with a little drift
    const f = 1500 + 1500 * this.flowEnv + 120 * Math.sin(now * 3.1);
    this.hissFilter.frequency.setTargetAtTime(f, now, 0.05);
  }
}

/**
 * Render one sound through the same master chain offline (for level checks). Returns peak and RMS
 * of the output. Not used at runtime.
 */
export async function measureSound(
  sound: SoundName | 'hiss' | [SoundName | 'hiss', SoundOpts][],
  o: SoundOpts = {},
  sampleRate = 44100,
): Promise<{ peak: number; rms: number; seconds: number }> {
  const list: [SoundName | 'hiss', SoundOpts][] = Array.isArray(sound) ? sound : [[sound, o]];
  const seconds = 1.2;
  const ctx = new OfflineAudioContext(1, Math.floor(sampleRate * seconds), sampleRate);
  const noise = makeNoise(ctx, 1);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 8;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(comp).connect(ctx.destination);
  for (const [name, opts] of list) {
    if (name === 'hiss') {
      // full-flow hiss (envelope at 1)
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const bq = ctx.createBiquadFilter();
      bq.type = 'bandpass';
      bq.frequency.value = 3000;
      bq.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.value = HISS_LEVEL;
      src.connect(bq).connect(g).connect(master);
      src.start(0);
    } else {
      SYNTHS[name](ctx, master, noise, 0.01 + (opts.delay ?? 0), opts);
    }
  }
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    const a = Math.abs(d[i]);
    if (a > peak) peak = a;
    sum += d[i] * d[i];
  }
  return { peak, rms: Math.sqrt(sum / d.length), seconds };
}
