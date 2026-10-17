/**
 * Fully procedural audio for The Long Haul — Web Audio API synthesis, no
 * sample files. Deliberate choice, not a shortcut: no licensing/attribution
 * risk, zero bundle weight, and the engine note can react continuously to
 * real game state (speed, throttle, surface) instead of crossfading between
 * a handful of pre-recorded loops.
 *
 * Browsers block audio before a user gesture — start() is called from the
 * first real keydown in long-haul-engine.ts, never at construction time.
 */

function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export class LongHaulAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc1!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private noiseSource!: AudioBufferSourceNode;
  private noiseGain!: GainNode;
  private noiseFilter!: BiquadFilterNode;
  private started = false;
  private muted = false;

  /** Builds the audio graph but does not start sound — call start() on a user gesture. */
  private ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // Two slightly-detuned sawtooth oscillators through a lowpass filter —
    // the detune gives the note body/richness a single oscillator can't,
    // the filter keeps a raw sawtooth from sounding like a buzzer.
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 500;
    this.engineFilter.Q.value = 0.7;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.master);

    this.engineOsc1 = ctx.createOscillator();
    this.engineOsc1.type = "sawtooth";
    this.engineOsc1.frequency.value = 55;
    this.engineOsc1.connect(this.engineGain);

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = "sawtooth";
    this.engineOsc2.frequency.value = 55 * 1.01;
    this.engineOsc2.connect(this.engineGain);

    // Looping filtered white noise for tire/rough-surface rumble.
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 900;
    this.noiseFilter.Q.value = 0.9;

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noiseGain.connect(this.noiseFilter);
    this.noiseFilter.connect(this.master);

    this.noiseSource = ctx.createBufferSource();
    this.noiseSource.buffer = makeNoiseBuffer(ctx, 2);
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseGain);
  }

  start() {
    this.ensureContext();
    if (this.started || !this.ctx) return;
    this.started = true;
    void this.ctx.resume();
    this.engineOsc1.start();
    this.engineOsc2.start();
    this.noiseSource.start();
  }

  /** Called every frame while driving — speedFrac in [0,1]. */
  setEngineState(speedFrac: number, throttleOn: boolean) {
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;
    const freq = 48 + speedFrac * 170;
    this.engineOsc1.frequency.setTargetAtTime(freq, t, 0.08);
    this.engineOsc2.frequency.setTargetAtTime(freq * 1.012, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(350 + speedFrac * 2200, t, 0.08);
    const targetGain = (throttleOn ? 0.22 : 0.1) + speedFrac * 0.05;
    this.engineGain.gain.setTargetAtTime(targetGain, t, 0.12);
  }

  /** active = currently on the rough back-roads surface; intensity scales with speed. */
  setSurfaceNoise(active: boolean, speedFrac: number) {
    if (!this.ctx || !this.started) return;
    const t = this.ctx.currentTime;
    this.noiseGain.gain.setTargetAtTime(active ? 0.05 + speedFrac * 0.09 : 0, t, 0.15);
  }

  private blip(freqStart: number, freqEnd: number, duration: number, type: OscillatorType = "sine", gainPeak = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + Math.min(0.03, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  playToll() {
    this.blip(880, 1320, 0.12, "triangle", 0.25);
  }

  playLoanAlert() {
    if (!this.ctx) return;
    this.blip(440, 330, 0.18, "square", 0.22);
    setTimeout(() => this.blip(440, 330, 0.18, "square", 0.22), 220);
  }

  playAccept() {
    this.blip(260, 160, 0.3, "sawtooth", 0.2);
  }

  playDecline() {
    this.blip(520, 780, 0.15, "sine", 0.18);
  }

  playFinish() {
    if (!this.ctx) return;
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => this.blip(f, f, 0.22, "triangle", 0.24), i * 110);
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.05);
    }
  }

  dispose() {
    if (!this.ctx) return;
    try {
      this.engineOsc1.stop();
      this.engineOsc2.stop();
      this.noiseSource.stop();
    } catch {
      // already stopped — fine
    }
    void this.ctx.close();
    this.ctx = null;
  }
}
