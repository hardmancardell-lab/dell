/**
 * Sound for "The Long Haul", built on the browser's Web Audio API (no audio files, no new dependency).
 *
 * Browsers only allow sound after the player does something (a key press or a click), so the audio context is
 * created on the first such action (`unlock`). Until then every call here does nothing, and if the browser has no
 * Web Audio at all the game simply stays silent. Sound is on by default with a visible mute button; the choice is
 * remembered in localStorage when that is available.
 */

const STORAGE_KEY = "dellegate.longHaul.sound";
const IDLE_HZ = 52;
const TOP_HZ = 150;
const LOW_FUEL_BELOW = 25;
const LOW_FUEL_BEEP_EVERY_SECONDS = 1.6;
const ENGINE_MAX_GAIN = 0.07;

/** Engine pitch for a speed between 0 (stopped) and 1 (top speed). Always between IDLE_HZ and TOP_HZ. */
export function engineHz(speedFraction: number): number {
  const f = Number.isFinite(speedFraction) ? Math.min(1, Math.max(0, speedFraction)) : 0;
  return IDLE_HZ + (TOP_HZ - IDLE_HZ) * f;
}

/** Engine loudness: a quiet idle that rises a little with speed. Never above ENGINE_MAX_GAIN, 0 when off. */
export function engineGain(speedFraction: number, throttleOn: boolean, enabled: boolean): number {
  if (!enabled) return 0;
  const f = Number.isFinite(speedFraction) ? Math.min(1, Math.max(0, speedFraction)) : 0;
  const base = 0.4 + 0.45 * f + (throttleOn ? 0.15 : 0);
  return Math.min(1, base) * ENGINE_MAX_GAIN;
}

export function readSoundPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveSoundPreference(enabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* storage can be blocked; the choice just is not remembered */
  }
}

type AudioContextCtor = typeof AudioContext;

export class LongHaulAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineGainNode: GainNode | null = null;
  private enabled: boolean;
  private lastBeepAt = -Infinity;

  constructor(enabled: boolean = readSoundPreference()) {
    this.enabled = enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** True once the browser has allowed sound (the player has pressed a key or clicked). */
  get isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Call from a key press or click. Safe to call many times. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor: AudioContextCtor | undefined =
          typeof window !== "undefined" ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) : undefined;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.ctx.destination);
        this.startEngine();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null; // no sound, game still works
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    saveSoundPreference(enabled);
    if (enabled) this.unlock();
    if (!enabled && this.engineGainNode && this.ctx) this.engineGainNode.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
  }

  private startEngine(): void {
    if (!this.ctx || !this.master) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    this.engineGainNode = this.ctx.createGain();
    this.engineGainNode.gain.value = 0;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = IDLE_HZ;
    this.engineSub = this.ctx.createOscillator();
    this.engineSub.type = "square";
    this.engineSub.frequency.value = IDLE_HZ / 2;
    this.engineOsc.connect(filter);
    this.engineSub.connect(filter);
    filter.connect(this.engineGainNode);
    this.engineGainNode.connect(this.master);
    this.engineOsc.start();
    this.engineSub.start();
  }

  /** Called every frame while the game runs. */
  update(speedFraction: number, throttleOn: boolean, fuel: number, nowSeconds: number): void {
    if (!this.ctx || !this.engineOsc || !this.engineSub || !this.engineGainNode) return;
    const t = this.ctx.currentTime;
    const hz = engineHz(speedFraction);
    this.engineOsc.frequency.setTargetAtTime(hz, t, 0.06);
    this.engineSub.frequency.setTargetAtTime(hz / 2, t, 0.06);
    this.engineGainNode.gain.setTargetAtTime(engineGain(speedFraction, throttleOn, this.enabled), t, 0.05);
    if (this.enabled && fuel > 0 && fuel < LOW_FUEL_BELOW && nowSeconds - this.lastBeepAt >= LOW_FUEL_BEEP_EVERY_SECONDS) {
      this.lastBeepAt = nowSeconds;
      this.tone(880, 0.12, "square", 0.05);
    }
  }

  /** Short sound effects. Each is silent when sound is off or not yet unlocked. */
  tollChime(): void { this.tone(660, 0.1, "triangle", 0.12); this.tone(990, 0.16, "triangle", 0.12, 0.1); }
  loanPrompt(): void { this.tone(330, 0.18, "sawtooth", 0.1); this.tone(247, 0.28, "sawtooth", 0.1, 0.18); }
  refuel(): void { this.tone(523, 0.1, "triangle", 0.12); this.tone(659, 0.1, "triangle", 0.12, 0.1); this.tone(784, 0.2, "triangle", 0.12, 0.2); }
  finish(): void { this.tone(523, 0.14, "triangle", 0.14); this.tone(659, 0.14, "triangle", 0.14, 0.14); this.tone(784, 0.14, "triangle", 0.14, 0.28); this.tone(1047, 0.3, "triangle", 0.14, 0.42); }

  private tone(hz: number, seconds: number, type: OscillatorType, volume: number, delaySeconds = 0): void {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== "running") return;
    const start = this.ctx.currentTime + delaySeconds;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(start);
    osc.stop(start + seconds + 0.02);
  }

  dispose(): void {
    try {
      this.engineOsc?.stop();
      this.engineSub?.stop();
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineSub = null;
    this.engineGainNode = null;
  }
}
