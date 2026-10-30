// Haptics via navigator.vibrate (Android Chrome; absent on iOS Safari -> everything is a no-op and
// the toggle is hidden). Driven by the same event stream as the sound effects.
//
// - Sand flow: a light "texture" of very short pulses, re-issued every TEXTURE_PERIOD while grains
//   are crossing region edges; pulse width 4..10 ms with the flow; stopped within ~100 ms of the
//   flow ending and whenever the tab is hidden.
// - One-shots (pop, thaw, hero landing, win) take priority: while one plays the texture holds off,
//   so a pop is never cut short by the next texture pulse.
// - Nothing vibrates before the first user gesture (Chrome needs sticky activation).
// - Patterns are preallocated: no per-frame allocation.

const TEXTURE_PERIOD = 66; // ms
const TEXTURE_GRACE = 100; // ms without transfers before the texture stops
const TEXTURE_MIN_ENV = 0.08; // smoothed flow level needed to buzz at all

const TEXTURE: number[][] = [];
for (let w = 0; w <= 10; w++) TEXTURE.push([w, TEXTURE_PERIOD - w]);
const POP = [35, 30, 70];
const THAW = [20, 30, 20];
const WIN = [40, 40, 40, 40, 120];
const LAND: number[][] = [];
for (let f = 0; f <= 6; f++) LAND.push([Math.round(10 + 30 * Math.min(1, Math.max(0, f - 1) / 5))]);

const total = (p: number[]) => p.reduce((a, b) => a + b, 0);

export type HapticName = 'pop' | 'thaw' | 'land' | 'win';

export class Haptics {
  readonly supported: boolean;
  private enabled: boolean;
  private activated = false;
  private env = 0;
  private lastFlowAt = -1e9;
  private nextTextureAt = 0;
  private texturing = false;
  private holdUntil = 0;

  constructor(enabled: boolean) {
    this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
    this.enabled = enabled;
    if (this.supported && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.stopTexture();
      });
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Call from a user gesture. */
  activate(): void {
    this.activated = true;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.stopTexture(true);
  }

  /** Supported, on, and the player has interacted (our own gesture flag: the same pointerdown /
   *  keydown / touchend that give Chrome sticky activation). */
  private can(): boolean {
    return this.supported && this.enabled && this.activated;
  }

  private vibrate(p: number | number[]): void {
    try {
      navigator.vibrate(p);
    } catch {
      /* ignore */
    }
  }

  private stopTexture(force = false): void {
    if (this.texturing || force) {
      this.texturing = false;
      if (this.supported && performance.now() >= this.holdUntil) this.vibrate(0);
    }
  }

  private winTimer = 0;

  /** One-shot pattern (pops in one frame: call once). */
  pulse(name: HapticName, fell = 1): void {
    if (!this.can() || document.hidden) return;
    const wait = this.holdUntil - performance.now();
    if (name === 'win' && wait > 0) {
      // The final pop and the win arrive together: let the pop finish, then play the win.
      window.clearTimeout(this.winTimer);
      this.winTimer = window.setTimeout(() => this.pulse('win'), wait + 10);
      return;
    }
    const p = name === 'pop' ? POP : name === 'thaw' ? THAW : name === 'win' ? WIN : LAND[Math.min(6, Math.max(0, fell | 0))];
    this.vibrate(p);
    this.texturing = false;
    this.holdUntil = performance.now() + total(p);
  }

  /** Per frame: grains crossing region edges per sim step (same signal as the sand hiss). */
  update(dt: number, grainsPerStep: number, now: number = performance.now()): void {
    const target = grainsPerStep > 0 ? Math.min(1, Math.sqrt(grainsPerStep / 40)) : 0;
    const tau = target > this.env ? 0.15 : 0.3;
    this.env += (target - this.env) * (1 - Math.exp(-dt / tau));
    if (grainsPerStep > 0) this.lastFlowAt = now;
    if (!this.can()) return;
    const flowing = now - this.lastFlowAt < TEXTURE_GRACE && this.env > TEXTURE_MIN_ENV && !document.hidden;
    if (!flowing) {
      this.stopTexture();
      return;
    }
    if (now < this.holdUntil) return; // a one-shot is playing: don't cut it off
    if (!this.texturing || now >= this.nextTextureAt) {
      const w = Math.round(4 + 6 * this.env);
      this.vibrate(TEXTURE[w]);
      this.texturing = true;
      this.nextTextureAt = now + TEXTURE_PERIOD;
    }
  }
}
