/**
 * Sound effects synthesised with WebAudio (GDD §16): no audio files, nothing to license and
 * nothing to download. Everything is built from oscillators and filtered noise.
 */

export type SoundName = 'whistle' | 'throw' | 'splash' | 'post' | 'net' | 'save' | 'cheer' | 'groan' | 'horn' | 'click' | 'charge';

export class Sfx {
  enabled = true;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Browsers only allow audio after a user gesture: call this from the first tap or key. */
  unlock(): void {
    try {
      if (!this.context) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.context = new Ctor();
        this.master = this.context.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.context.destination);
        // One second of white noise, reused by every noisy sound.
        const length = this.context.sampleRate;
        this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {
      this.context = null;
    }
  }

  /** `intensity` 0–1 scales loudness (and pitch, for some sounds). */
  play(name: SoundName, intensity = 1): void {
    const ctx = this.context;
    const out = this.master;
    if (!this.enabled || !ctx || !out || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const level = Math.min(1, Math.max(0.1, intensity));
    try {
      switch (name) {
        case 'whistle':
          // Pea whistle: two close high tones with a fast warble.
          for (const frequency of [2350, 2520]) this.tone(frequency, now, 0.42, 0.16, 'square', { tremolo: 34, attack: 0.01 });
          break;
        case 'throw':
          this.burst(now, 0.14, 0.22 * level, { type: 'bandpass', from: 900, to: 2600, q: 1.2 });
          break;
        case 'splash':
          this.burst(now, 0.38, 0.4 * level, { type: 'lowpass', from: 4200, to: 500, q: 0.6 });
          this.burst(now + 0.03, 0.25, 0.18 * level, { type: 'highpass', from: 3000, to: 6000, q: 0.5 });
          break;
        case 'post':
          // Metal tube: inharmonic partials that ring out.
          for (const [frequency, gain] of [[540, 0.3], [1240, 0.22], [2010, 0.14], [3120, 0.08]] as const) {
            this.tone(frequency, now, 0.7, gain, 'sine', { attack: 0.002 });
          }
          this.burst(now, 0.05, 0.3, { type: 'highpass', from: 2000, to: 2000, q: 0.7 });
          break;
        case 'net':
          this.burst(now, 0.3, 0.3 * level, { type: 'bandpass', from: 2600, to: 700, q: 0.8 });
          break;
        case 'save':
          this.burst(now, 0.1, 0.45, { type: 'lowpass', from: 1400, to: 300, q: 1 });
          this.tone(150, now, 0.12, 0.3, 'sine', { attack: 0.002, to: 70 });
          break;
        case 'cheer':
          this.burst(now, 1.5, 0.3, { type: 'bandpass', from: 900, to: 1500, q: 0.5, swell: 0.25 });
          this.burst(now, 1.3, 0.14, { type: 'bandpass', from: 2400, to: 2000, q: 0.8, swell: 0.3 });
          break;
        case 'groan':
          this.burst(now, 0.9, 0.2, { type: 'bandpass', from: 700, to: 320, q: 0.7, swell: 0.15 });
          break;
        case 'horn':
          for (const frequency of [196, 247, 294]) this.tone(frequency, now, 1.1, 0.14, 'sawtooth', { attack: 0.03 });
          break;
        case 'click':
          this.tone(880, now, 0.05, 0.12, 'triangle', { attack: 0.002 });
          break;
        case 'charge':
          this.tone(300 + 500 * level, now, 0.05, 0.05, 'triangle', { attack: 0.004 });
          break;
      }
    } catch {
      // A sound that fails to start must never interrupt the game.
    }
  }

  private tone(
    frequency: number,
    start: number,
    duration: number,
    gain: number,
    type: OscillatorType,
    options: { tremolo?: number; attack?: number; to?: number } = {},
  ): void {
    const ctx = this.context as AudioContext;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.to) oscillator.frequency.exponentialRampToValueAtTime(options.to, start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + (options.attack ?? 0.01));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    if (options.tremolo) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = options.tremolo;
      depth.gain.value = gain * 0.6;
      lfo.connect(depth);
      depth.connect(envelope.gain);
      lfo.start(start);
      lfo.stop(start + duration);
    }
    envelope.connect(this.master as GainNode);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private burst(
    start: number,
    duration: number,
    gain: number,
    filter: { type: BiquadFilterType; from: number; to: number; q: number; swell?: number },
  ): void {
    const ctx = this.context as AudioContext;
    if (!this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter.type;
    biquad.Q.value = filter.q;
    biquad.frequency.setValueAtTime(filter.from, start);
    biquad.frequency.exponentialRampToValueAtTime(Math.max(40, filter.to), start + duration);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + (filter.swell ?? 0.008));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(biquad);
    biquad.connect(envelope);
    envelope.connect(this.master as GainNode);
    source.start(start, Math.random() * 0.5);
    source.stop(start + duration + 0.02);
  }
}
