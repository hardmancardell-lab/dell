/**
 * Sound for "The Long Haul", built on the browser's Web Audio API (no audio files, no new dependency).
 *
 * Browsers only allow sound after the player does something (a key press or a click), so the audio context is
 * created on the first such action (`unlock`). Until then every call here does nothing, and if the browser has no
 * Web Audio at all the game simply stays silent. Sound is on by default with a visible mute button; the choice is
 * remembered in localStorage when that is available.
 *
 * Mix rules (owner feedback: "once I let go of acceleration I still hear car rumbling"):
 *  - Stopped with no throttle: silent. Every channel is exactly 0 and fades out within about 0.15 s.
 *  - Coasting (throttle off, still rolling): the engine note drops quickly to a very quiet murmur; a faint wind and
 *    tyre hiss scales with speed and fades as the car slows.
 *  - Throttle on: the engine note rises with speed. Braking: a slightly lower note.
 *  - Dirt lane: a soft road hum (filtered noise) on top of the tyre noise.
 * All of those levels come from pure functions (below) so they are unit tested without a browser.
 */

const STORAGE_KEY = "dellegate.longHaul.sound";
const IDLE_HZ = 52;
const TOP_HZ = 150;
const LOW_FUEL_BELOW = 25;
const LOW_FUEL_BEEP_EVERY_SECONDS = 1.6;
const ENGINE_MAX_GAIN = 0.07;
const WIND_MAX_GAIN = 0.045;
const TYRE_MAX_GAIN = 0.03;
const DIRT_MAX_GAIN = 0.05;
/** Hard ceiling on the sum of the continuous channels (engine + wind + tyre + dirt), before the effects. */
export const MASTER_CAP = 0.16;
/** Below this speed fraction with no throttle, everything is exactly silent. */
const REST_FRACTION = 0.02;
/** Time constant (seconds) for fading a channel out: inaudible in about 0.1 s, with a hard zero at 0.16 s. */
const FADE_OUT_TC = 0.03;
const FADE_OUT_HARD_ZERO_SECONDS = 0.16;

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/**
 * Engine pitch for a speed between 0 (stopped) and 1 (top speed). Always between IDLE_HZ and TOP_HZ.
 * With the throttle off the note drops quickly (engine braking); braking lowers it a little more.
 */
export function engineHz(speedFraction: number, throttleOn = true, braking = false): number {
  const f = clamp01(speedFraction);
  let hz = IDLE_HZ + (TOP_HZ - IDLE_HZ) * f * (throttleOn ? 1 : 0.55);
  if (braking) hz = IDLE_HZ + (hz - IDLE_HZ) * 0.85;
  return hz;
}

/**
 * Engine loudness. Silent when sound is off, and silent when the car is at rest with no throttle (the old idle
 * rumble is gone). Throttle on: rises with speed. Throttle off while rolling: a very quiet murmur that fades with
 * speed. Braking: a touch quieter than coasting. Never above ENGINE_MAX_GAIN.
 */
export function engineGain(speedFraction: number, throttleOn: boolean, enabled: boolean, braking = false): number {
  if (!enabled) return 0;
  const f = clamp01(speedFraction);
  let level: number;
  if (throttleOn) level = 0.45 + 0.5 * f;
  else if (f < REST_FRACTION) level = 0;
  else level = 0.12 * f * (braking ? 0.7 : 1);
  return Math.min(1, level) * ENGINE_MAX_GAIN;
}

/** Wind rush: scales with speed (about its 1.6 power), 0 at rest. */
export function windGain(speedFraction: number, enabled: boolean): number {
  if (!enabled) return 0;
  const f = clamp01(speedFraction);
  if (f < 0.01) return 0;
  return Math.pow(f, 1.6) * WIND_MAX_GAIN;
}

/** Tyre noise on tarmac: scales with speed, 0 at rest. */
export function tyreGain(speedFraction: number, enabled: boolean): number {
  if (!enabled) return 0;
  const f = clamp01(speedFraction);
  if (f < 0.01) return 0;
  return Math.pow(f, 0.8) * TYRE_MAX_GAIN;
}

/** Soft road hum on the dirt lane (filtered noise). 0 off the dirt and at rest. */
export function dirtHumGain(speedFraction: number, onDirt: boolean, enabled: boolean): number {
  if (!enabled || !onDirt) return 0;
  const f = clamp01(speedFraction);
  if (f < 0.01) return 0;
  return (0.35 + 0.65 * f) * DIRT_MAX_GAIN;
}

/** Brightness of the wind noise: opens up with speed. */
export function windFilterHz(speedFraction: number): number {
  return 500 + 2500 * clamp01(speedFraction);
}

/** Brightness of the tyre noise: opens up with speed. */
export function tyreFilterHz(speedFraction: number): number {
  return 300 + 900 * clamp01(speedFraction);
}

export interface AudioMix {
  engine: number;
  engineHz: number;
  wind: number;
  windHz: number;
  tyre: number;
  tyreHz: number;
  dirt: number;
}

/** Every continuous level for one frame. The four gains never add up to more than MASTER_CAP. NaN-safe. */
export function mixLevels(speedFraction: number, throttleOn: boolean, braking: boolean, onDirt: boolean, enabled: boolean): AudioMix {
  const f = clamp01(speedFraction);
  let engine = engineGain(f, throttleOn, enabled, braking);
  let wind = windGain(f, enabled);
  let tyre = tyreGain(f, enabled);
  let dirt = dirtHumGain(f, onDirt, enabled);
  const sum = engine + wind + tyre + dirt;
  if (sum > MASTER_CAP) {
    const k = MASTER_CAP / sum;
    engine *= k; wind *= k; tyre *= k; dirt *= k;
  }
  return { engine, engineHz: engineHz(f, throttleOn, braking), wind, windHz: windFilterHz(f), tyre, tyreHz: tyreFilterHz(f), dirt };
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

interface Channel {
  gain: GainNode;
  last: number;
}

export class LongHaulAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private noiseSources: AudioBufferSourceNode[] = [];
  private windFilter: BiquadFilterNode | null = null;
  private tyreFilter: BiquadFilterNode | null = null;
  private engineCh: Channel | null = null;
  private windCh: Channel | null = null;
  private tyreCh: Channel | null = null;
  private dirtCh: Channel | null = null;
  private lastHz = -1;
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
        this.startNoise();
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
    if (!enabled) this.silenceAll();
  }

  private makeChannel(destination: AudioNode, source: AudioNode): Channel {
    const gain = this.ctx!.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(destination);
    return { gain, last: 0 };
  }

  private startEngine(): void {
    if (!this.ctx || !this.master) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = IDLE_HZ;
    this.engineSub = this.ctx.createOscillator();
    this.engineSub.type = "square";
    this.engineSub.frequency.value = IDLE_HZ / 2;
    this.engineOsc.connect(filter);
    this.engineSub.connect(filter);
    this.engineCh = this.makeChannel(this.master, filter);
    this.engineOsc.start();
    this.engineSub.start();
  }

  /** Wind, tyre and dirt noise all come from one short looped white-noise buffer through different filters. */
  private startNoise(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const length = Math.max(1, Math.floor(ctx.sampleRate * 2));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    const source = (): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      this.noiseSources.push(s);
      return s;
    };

    const wind = source();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.5;
    wind.connect(this.windFilter);
    this.windCh = this.makeChannel(this.master, this.windFilter);

    const tyre = source();
    this.tyreFilter = ctx.createBiquadFilter();
    this.tyreFilter.type = "lowpass";
    this.tyreFilter.frequency.value = 400;
    tyre.connect(this.tyreFilter);
    this.tyreCh = this.makeChannel(this.master, this.tyreFilter);

    const dirt = source();
    const dirtFilter = ctx.createBiquadFilter();
    dirtFilter.type = "lowpass";
    dirtFilter.frequency.value = 240;
    dirtFilter.Q.value = 0.8;
    dirt.connect(dirtFilter);
    this.dirtCh = this.makeChannel(this.master, dirtFilter);

    // Different start offsets so the three layers are not the same noise.
    wind.start(0, 0);
    tyre.start(0, 0.7);
    dirt.start(0, 1.3);
  }

  /** Moves a channel toward a target. Rises ease in; a fall to zero fades out within ~0.15 s and lands on exactly 0. */
  private drive(ch: Channel | null, target: number): void {
    if (!ch || !this.ctx) return;
    const t = this.ctx.currentTime;
    const param = ch.gain.gain;
    if (target === 0) {
      if (ch.last === 0) return;
      param.cancelScheduledValues(t);
      param.setTargetAtTime(0, t, FADE_OUT_TC);
      param.setValueAtTime(0, t + FADE_OUT_HARD_ZERO_SECONDS);
    } else if (Math.abs(target - ch.last) > 1e-4 || ch.last === 0) {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(target, t, target > ch.last ? 0.05 : FADE_OUT_TC * 1.5);
    }
    ch.last = target;
  }

  private silenceAll(): void {
    this.drive(this.engineCh, 0);
    this.drive(this.windCh, 0);
    this.drive(this.tyreCh, 0);
    this.drive(this.dirtCh, 0);
  }

  /** Called every frame while the game runs. */
  update(speedFraction: number, throttleOn: boolean, fuel: number, nowSeconds: number, braking = false, onDirt = false): void {
    if (!this.ctx || !this.engineOsc || !this.engineSub) return;
    const t = this.ctx.currentTime;
    const mix = mixLevels(speedFraction, throttleOn, braking, onDirt, this.enabled);
    if (Math.abs(mix.engineHz - this.lastHz) > 0.25) {
      this.lastHz = mix.engineHz;
      this.engineOsc.frequency.setTargetAtTime(mix.engineHz, t, 0.06);
      this.engineSub.frequency.setTargetAtTime(mix.engineHz / 2, t, 0.06);
    }
    this.windFilter?.frequency.setTargetAtTime(mix.windHz, t, 0.1);
    this.tyreFilter?.frequency.setTargetAtTime(mix.tyreHz, t, 0.1);
    this.drive(this.engineCh, mix.engine);
    this.drive(this.windCh, mix.wind);
    this.drive(this.tyreCh, mix.tyre);
    this.drive(this.dirtCh, mix.dirt);
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
      for (const s of this.noiseSources) s.stop();
      void this.ctx?.close();
    } catch {
      /* already closed */
    }
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineSub = null;
    this.noiseSources = [];
    this.windFilter = null;
    this.tyreFilter = null;
    this.engineCh = null;
    this.windCh = null;
    this.tyreCh = null;
    this.dirtCh = null;
  }
}
