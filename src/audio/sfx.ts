/**
 * Sound effects synthesised with WebAudio (GDD §16): no audio files, nothing to license and
 * nothing to download. Everything is built from oscillators and filtered noise.
 *
 * Besides the one-off effects there is a background (the "ambience"): the water moving with the
 * swimmers, the odd stroke splashing, and a crowd that murmurs, gets excited on a break and
 * reacts to goals, saves, the post and the referee. It is kept low on purpose.
 */

export type SoundName = 'whistle' | 'goalWhistle' | 'throw' | 'splash' | 'post' | 'net' | 'save' | 'cheer' | 'groan' | 'horn' | 'click' | 'charge';

/** What the crowd reacts to. "Us" is always our team. */
export type CrowdMoment =
  | 'goalUs'
  | 'goalThem'
  | 'saveUs'
  | 'saveThem'
  | 'post'
  | 'exclusionThem'
  | 'exclusionUs'
  | 'stealUs'
  | 'win'
  | 'lose';

interface AmbienceNodes {
  bus: GainNode;
  /** How loud the water is (it follows the swimming); the slow swell rides on `surface`. */
  water: GainNode;
  spray: GainNode;
  crowd: GainNode | null;
  sources: AudioScheduledSourceNode[];
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** Level of the water with nobody swimming and with everybody sprinting (the old loudest). */
const WATER_STILL = 0.018;
const WATER_SPRINT = 0.07;
/** Peak of the applause for one of our goals (Julián: an ovation, louder than the rest of the crowd). */
const APPLAUSE_GOAL = 0.2;
/** The murmur of the crowd: normal, and how high it goes while the stand celebrates a goal. */
const CROWD_BASE = 0.02;
const CROWD_OVATION = 0.15;
/** The long goal whistle holds its level, so it starts a little lower than the short one. */
const GOAL_WHISTLE = 0.085;

export class Sfx {
  enabled = true;
  /** Loudness of the background: 1 normal, 0.5 low, 0 none (Ajustes → Ambiente). */
  ambienceLevel = 1;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  /** Four seconds of noise for the long loops (one second would be heard repeating). */
  private bed: AudioBuffer | null = null;
  /** A pre-baked round of applause: hundreds of claps would be too many nodes to schedule live. */
  private applauseBuffer: AudioBuffer | null = null;
  private amb: AmbienceNodes | null = null;
  /** The ambience asked for before audio was unlocked (a page opened straight into a match). */
  private wanted: { crowd: boolean } | null = null;
  private ducked = false;
  private strokeClock = 0;
  private ambienceTick = 0;
  /** The swimming, smoothed: it rises quickly with a sprint and settles slowly with the attack. */
  private activity = 0;
  /** Until then (audio clock) the crowd is celebrating and its murmur is not touched. */
  private ovationUntil = 0;

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
      if (this.wanted && !this.amb) this.startAmbience(this.wanted);
    } catch {
      this.context = null;
    }
  }

  /** In the background the game is silent. */
  setHidden(hidden: boolean): void {
    const ctx = this.context;
    if (!ctx) return;
    try {
      if (hidden && ctx.state === 'running') void ctx.suspend();
      else if (!hidden && ctx.state === 'suspended') void ctx.resume();
    } catch {
      // Nothing to do: the next tap unlocks it again.
    }
  }

  // ------------------------------------------------------------------------------------------
  // Ambience: water and crowd
  // ------------------------------------------------------------------------------------------

  /** Starts the background of a match, a shoot-out or a training session (without crowd). */
  startAmbience(options: { crowd: boolean }): void {
    this.stopAmbience();
    this.wanted = options;
    const ctx = this.context;
    const master = this.master;
    if (!ctx || !master) return;
    try {
      this.bed ??= this.makeNoise(ctx, 4);
      // Baked now, while the match is being set up, not at the first goal (a hitch on a phone).
      if (options.crowd) this.applauseBuffer ??= this.makeApplause(ctx);
      const now = ctx.currentTime;
      const bus = ctx.createGain();
      bus.gain.setValueAtTime(0.0001, now);
      bus.gain.setTargetAtTime(this.busLevel(), now, 0.8);
      bus.connect(master);
      const sources: AudioScheduledSourceNode[] = [];

      // Water: a low wash that swells slowly like the surface, and a hiss of spray with the swimming.
      const water = ctx.createGain();
      water.gain.value = WATER_STILL;
      const surface = ctx.createGain();
      surface.gain.value = 1;
      const waterSource = this.loopSource(ctx, this.bed);
      const low = this.filter(ctx, 'lowpass', 620, 0.5);
      waterSource.connect(low).connect(surface).connect(water).connect(bus);
      const spray = ctx.createGain();
      spray.gain.value = 0;
      waterSource.connect(this.filter(ctx, 'bandpass', 2300, 0.7)).connect(spray).connect(bus);
      const swell = ctx.createOscillator();
      swell.frequency.value = 0.17;
      const swellDepth = ctx.createGain();
      swellDepth.gain.value = 0.3;
      swell.connect(swellDepth).connect(surface.gain);
      sources.push(waterSource, swell);

      // Crowd: a murmur around voice frequencies, with a little babble in it.
      let crowd: GainNode | null = null;
      if (options.crowd) {
        crowd = ctx.createGain();
        crowd.gain.value = 0.025;
        const crowdSource = this.loopSource(ctx, this.bed, 1.7);
        crowdSource.connect(this.filter(ctx, 'bandpass', 430, 1.1)).connect(crowd);
        const upper = ctx.createGain();
        upper.gain.value = 0.45;
        crowdSource.connect(this.filter(ctx, 'bandpass', 1050, 1.6)).connect(upper).connect(crowd);
        crowd.connect(bus);
        for (const [rate, depth] of [
          [2.9, 0.006],
          [5.3, 0.004],
        ] as const) {
          const babble = ctx.createOscillator();
          babble.frequency.value = rate;
          const amount = ctx.createGain();
          amount.gain.value = depth;
          babble.connect(amount).connect(crowd.gain);
          sources.push(babble);
        }
        sources.push(crowdSource);
      }
      for (const source of sources) {
        if (source instanceof AudioBufferSourceNode) source.start(now, Math.random() * 3);
        else source.start(now);
      }
      this.amb = { bus, water, spray, crowd, sources };
      this.strokeClock = 0.5;
      this.activity = 0;
    } catch {
      this.amb = null;
    }
  }

  stopAmbience(): void {
    this.wanted = null;
    const amb = this.amb;
    const ctx = this.context;
    this.amb = null;
    if (!amb || !ctx) return;
    try {
      const now = ctx.currentTime;
      amb.bus.gain.cancelScheduledValues(now);
      amb.bus.gain.setTargetAtTime(0.0001, now, 0.15);
      for (const source of amb.sources) source.stop(now + 0.8);
      setTimeout(() => amb.bus.disconnect(), 1000);
    } catch {
      // Already stopped.
    }
  }

  /** Paused: the background drops to a whisper. */
  duckAmbience(ducked: boolean): void {
    this.ducked = ducked;
    this.applyLevel();
  }

  /** The settings changed (sound on or off, ambience level). */
  applyLevel(): void {
    const amb = this.amb;
    const ctx = this.context;
    if (!amb || !ctx) return;
    amb.bus.gain.setTargetAtTime(this.busLevel(), ctx.currentTime, 0.3);
  }

  private busLevel(): number {
    if (!this.enabled) return 0.0001;
    return Math.max(0.0001, 2.8 * this.ambienceLevel * (this.ducked ? 0.25 : 1));
  }

  /**
   * Every step: `activity` 0–1 is how hard the swimmers are swimming (louder water, more
   * strokes splashing), `tension` 0–1 how close a goal feels (the crowd gets louder).
   * Julián: the water as loud as before with many swimming fast, quieter once the positions
   * settle. It rises in a third of a second and takes a second or two to calm down.
   */
  setAmbience(activity: number, tension: number, dt: number): void {
    const amb = this.amb;
    const ctx = this.context;
    if (!amb || !ctx || ctx.state !== 'running' || this.ambienceLevel <= 0 || !this.enabled) return;
    const target = clamp01(activity);
    this.activity += (target - this.activity) * (1 - Math.exp(-dt / (target > this.activity ? 0.3 : 1.1)));
    const a = this.activity;
    // Strokes: the odd splash from somebody swimming hard.
    this.strokeClock -= dt;
    if (this.strokeClock <= 0) {
      this.strokeClock = (0.25 + 1.2 * (1 - a)) * (0.5 + Math.random());
      if (a > 0.12) {
        const now = ctx.currentTime;
        const pitch = 900 + Math.random() * 1600;
        this.burst(now, 0.12 + Math.random() * 0.12, (0.012 + 0.03 * a) * (0.6 + 0.4 * Math.random()), { type: 'bandpass', from: pitch, to: pitch * 0.45, q: 0.9 }, amb.bus);
      }
    }
    // The continuous parts only need a few updates a second.
    this.ambienceTick += dt;
    if (this.ambienceTick < 0.1) return;
    this.ambienceTick = 0;
    const now = ctx.currentTime;
    amb.water.gain.setTargetAtTime(WATER_STILL + (WATER_SPRINT - WATER_STILL) * a, now, 0.25);
    amb.spray.gain.setTargetAtTime(0.016 * a, now, 0.25);
    if (now >= this.ovationUntil) amb.crowd?.gain.setTargetAtTime(CROWD_BASE + 0.04 * clamp01(tension), now, 0.6);
  }

  /** The crowd reacts. Quiet if there is no crowd (training) or no ambience. */
  crowd(moment: CrowdMoment, strength = 1): void {
    const amb = this.amb;
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running') return;
    if (!amb?.crowd || this.ambienceLevel <= 0) {
      // Without a crowd, the old short reactions to goals.
      if (moment === 'goalUs') this.play('cheer');
      else if (moment === 'goalThem') this.play('groan');
      return;
    }
    const bus = amb.bus;
    const now = ctx.currentTime;
    const k = clamp01(strength);
    try {
      switch (moment) {
        case 'goalUs':
        case 'win':
          // The whole stand celebrates (Julián): an ovation that lasts through the replay.
          this.ovation(now, k, moment === 'win' ? 6 : 9);
          break;
        case 'goalThem':
          // Disappointment at home, and their few supporters celebrating at the far end.
          this.burst(now, 1.3, 0.12 * k, { type: 'bandpass', from: 650, to: 340, q: 0.8, swell: 0.12 }, bus);
          this.cheer(now + 0.15, 0.35 * k, 2.2, { voices: 7, far: true });
          this.applause(now + 0.4, 4, APPLAUSE_GOAL * 0.4 * k);
          break;
        case 'saveUs':
          // "¡Uaaah!" and applause for our keeper.
          this.burst(now, 1.2, 0.21 * k, { type: 'bandpass', from: 480, to: 1000, q: 0.7, swell: 0.18 }, bus);
          this.applause(now + 0.25, 1.8, 0.18 * k);
          break;
        case 'saveThem':
          this.burst(now, 1.0, 0.1 * k, { type: 'bandpass', from: 900, to: 430, q: 0.8, swell: 0.1 }, bus);
          break;
        case 'post':
          // "¡Uuuuh!": up, then down.
          this.burst(now, 0.5, 0.17 * k, { type: 'bandpass', from: 420, to: 760, q: 1, swell: 0.12 }, bus);
          this.burst(now + 0.45, 0.8, 0.14 * k, { type: 'bandpass', from: 760, to: 380, q: 1, swell: 0.05 }, bus);
          break;
        case 'exclusionThem':
          this.burst(now, 0.8, 0.07 * k, { type: 'bandpass', from: 700, to: 1000, q: 0.7, swell: 0.12 }, bus);
          this.applause(now + 0.1, 1.0, 0.06 * k);
          break;
        case 'exclusionUs':
          // Booing the referee, and a couple of whistles.
          this.burst(now, 1.5, 0.15 * k, { type: 'bandpass', from: 300, to: 260, q: 2.2, swell: 0.25 }, bus);
          for (let i = 0; i < 3; i++) {
            const at = now + 0.15 + Math.random() * 0.8;
            const f = 2400 + Math.random() * 900;
            this.tone(f, at, 0.28, 0.02 * k, 'sine', { attack: 0.03, to: f * 1.25 }, bus);
          }
          break;
        case 'stealUs':
          this.burst(now, 0.6, 0.05 * k, { type: 'bandpass', from: 650, to: 900, q: 0.7, swell: 0.1 }, bus);
          break;
        case 'lose':
          this.applause(now, 2.2, 0.06 * k);
          break;
      }
    } catch {
      // A reaction that fails must never interrupt the game.
    }
  }

  /**
   * A goal of ours: the murmur of the whole crowd rises and holds for a few seconds, they shout it
   * ("¡gooool!"), a few whistle, and then a long round of applause (`seconds`) through the replay.
   */
  private ovation(now: number, k: number, seconds: number): void {
    const amb = this.amb;
    if (!amb?.crowd) return;
    const crowd = amb.crowd.gain;
    crowd.cancelScheduledValues(now);
    crowd.setValueAtTime(crowd.value, now);
    crowd.setTargetAtTime(CROWD_BASE + (CROWD_OVATION - CROWD_BASE) * k, now, 0.15);
    crowd.setTargetAtTime(CROWD_BASE, now + 3.4, 1.3);
    this.ovationUntil = now + 6;
    this.cheer(now, k, 3.4, { voices: 18, far: false });
    for (let i = 0; i < 4; i++) {
      // Two fingers in the mouth: a whistle that goes up and comes down.
      const at = now + 0.5 + Math.random() * 2.4;
      const f = 2300 + Math.random() * 1000;
      const length = 0.35 + Math.random() * 0.35;
      this.tone(f, at, length * 0.4, 0.03 * k, 'sine', { attack: 0.04, to: f * 1.22 }, amb.bus);
      this.tone(f * 1.22, at + length * 0.4, length * 0.6, 0.03 * k, 'sine', { attack: 0.01, to: f * 0.95 }, amb.bus);
    }
    this.applause(now + 0.6, seconds, APPLAUSE_GOAL * k);
  }

  /**
   * A crowd shouting: a roar of noise in the band of voices that swells and holds, and on top many
   * voices, each at its own pitch and a moment apart, through the vowel "o". `far` = a few
   * supporters at the other end (duller).
   */
  private cheer(start: number, k: number, seconds: number, options: { voices: number; far: boolean }): void {
    const ctx = this.context as AudioContext;
    const amb = this.amb;
    if (!amb || !this.noise) return;
    const out = ctx.createGain();
    out.gain.value = 1;
    const tone = this.filter(ctx, 'lowpass', options.far ? 1300 : 3200, 0.5);
    out.connect(tone).connect(amb.bus);
    // The roar.
    for (const [from, to, q, gain] of [
      [520, 760, 0.6, 0.26],
      [1350, 1700, 0.9, 0.1],
    ] as const) {
      const source = ctx.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = q;
      band.frequency.setValueAtTime(from, start);
      band.frequency.linearRampToValueAtTime(to, start + 0.6);
      band.frequency.setTargetAtTime(from, start + seconds * 0.6, seconds * 0.2);
      const envelope = ctx.createGain();
      this.hold(envelope.gain, start, seconds, gain * k);
      source.connect(band).connect(envelope).connect(out);
      source.start(start, Math.random() * 0.5);
      source.stop(start + seconds * 1.25);
    }
    // The voices: sawtooths through the formants of an "o" (500 and 900 Hz), men and women.
    const voices = ctx.createGain();
    voices.gain.value = 0.05 * k;
    const f1 = this.filter(ctx, 'bandpass', 520, 3.5);
    const f2 = this.filter(ctx, 'bandpass', 900, 4.5);
    const f2Level = ctx.createGain();
    f2Level.gain.value = 0.6;
    voices.connect(f1).connect(out);
    voices.connect(f2).connect(f2Level).connect(out);
    for (let v = 0; v < options.voices; v++) {
      const pitch = v % 3 === 2 ? 330 + Math.random() * 150 : 190 + Math.random() * 110;
      const at = start + Math.random() * 0.35;
      const length = seconds * (0.5 + 0.4 * Math.random());
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sawtooth';
      // Up into the shout, a little wobble, and down at the end.
      const f = oscillator.frequency;
      f.setValueAtTime(pitch * 0.82, at);
      f.linearRampToValueAtTime(pitch, at + 0.25);
      for (let t = at + 0.5; t < at + length - 0.3; t += 0.3 + Math.random() * 0.3) f.linearRampToValueAtTime(pitch * (0.97 + Math.random() * 0.06), t);
      f.linearRampToValueAtTime(pitch * 0.8, at + length);
      const envelope = ctx.createGain();
      this.hold(envelope.gain, at, length, 0.4 + 0.6 * Math.random());
      oscillator.connect(envelope).connect(voices);
      oscillator.start(at);
      oscillator.stop(at + length * 1.25);
    }
  }

  /** An envelope that rises quickly, holds most of the time and fades out at the end. */
  private hold(param: AudioParam, start: number, seconds: number, gain: number): void {
    param.setValueAtTime(0.0001, start);
    param.exponentialRampToValueAtTime(gain, start + Math.min(0.3, seconds * 0.15));
    param.setTargetAtTime(gain * 0.75, start + seconds * 0.3, seconds * 0.25);
    param.setTargetAtTime(0.0001, start + seconds * 0.7, seconds * 0.08);
  }

  private applause(start: number, duration: number, gain: number): void {
    const ctx = this.context as AudioContext;
    const amb = this.amb;
    if (!amb) return;
    this.applauseBuffer ??= this.makeApplause(ctx);
    const source = ctx.createBufferSource();
    source.buffer = this.applauseBuffer;
    // The buffer loops seamlessly, so a round of applause can last as long as it needs.
    source.loop = true;
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.15);
    envelope.gain.setTargetAtTime(0.0001, start + duration * 0.55, duration * 0.18);
    source.connect(this.filter(ctx, 'bandpass', 1700, 0.45)).connect(envelope).connect(amb.bus);
    source.start(start, Math.random() * 3);
    source.stop(start + duration * 1.25 + 0.3);
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /**
   * A stand clapping: about a thousand claps spread evenly over four seconds that loop without a
   * seam (a clap that runs past the end carries on at the start). Each clap is a burst of noise
   * through its own resonance, so they do not all sound alike, and a few near ones are louder.
   */
  private makeApplause(ctx: AudioContext): AudioBuffer {
    const rate = ctx.sampleRate;
    const seconds = 4;
    const length = Math.floor(rate * seconds);
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    for (let c = 0; c < 1000; c++) {
      const start = Math.floor(Math.random() * length);
      const amplitude = 0.2 + 0.8 * Math.pow(Math.random(), 3);
      const size = Math.floor((0.01 + 0.018 * Math.random()) * rate);
      const fade = Math.exp(-1 / (size * 0.22));
      // Two-pole resonator between 700 and 2600 Hz: the hollow of the hands.
      const w = (2 * Math.PI * (700 + 1900 * Math.random())) / rate;
      const r = 0.9;
      const b1 = 2 * r * Math.cos(w);
      const b2 = -r * r;
      let y1 = 0;
      let y2 = 0;
      let level = 1;
      for (let i = 0; i < size; i++) {
        const x = (Math.random() * 2 - 1) * level;
        level *= fade;
        const y = x + b1 * y1 + b2 * y2;
        y2 = y1;
        y1 = y;
        const j = (start + i) % length;
        data[j] = (data[j] ?? 0) + y * amplitude * 0.15;
      }
    }
    // Take the thump out (one-pole high-pass) and normalise.
    let previousIn = 0;
    let previousOut = 0;
    let peak = 0;
    for (let i = 0; i < length; i++) {
      const x = data[i] ?? 0;
      const y = 0.96 * (previousOut + x - previousIn);
      previousIn = x;
      previousOut = y;
      data[i] = y;
      peak = Math.max(peak, Math.abs(y));
    }
    if (peak > 0) for (let i = 0; i < length; i++) data[i] = (data[i] ?? 0) / peak;
    return buffer;
  }

  private loopSource(ctx: AudioContext, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = rate;
    return source;
  }

  private filter(ctx: AudioContext, type: BiquadFilterType, frequency: number, q: number): BiquadFilterNode {
    const biquad = ctx.createBiquadFilter();
    biquad.type = type;
    biquad.frequency.value = frequency;
    biquad.Q.value = q;
    return biquad;
  }

  /** `intensity` 0–1 scales loudness (and pitch, for some sounds); `delay` in seconds. */
  play(name: SoundName, intensity = 1, delay = 0): void {
    const ctx = this.context;
    const out = this.master;
    if (!this.enabled || !ctx || !out || ctx.state !== 'running') return;
    const now = ctx.currentTime + Math.max(0, delay);
    const level = Math.min(1, Math.max(0.1, intensity));
    try {
      switch (name) {
        case 'whistle':
          // Pea whistle: two close high tones with a fast warble.
          for (const frequency of [2350, 2520]) this.tone(frequency, now, 0.42, 0.16, 'square', { tremolo: 34, attack: 0.01 });
          break;
        case 'goalWhistle':
          // The referee gives the goal: the same whistle, one long blast held to the end.
          for (const frequency of [2350, 2520]) this.tone(frequency, now, 0.8, GOAL_WHISTLE, 'square', { tremolo: 34, attack: 0.02, hold: true });
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
    options: { tremolo?: number; attack?: number; to?: number; hold?: boolean } = {},
    destination?: AudioNode,
  ): void {
    const ctx = this.context as AudioContext;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (options.to) oscillator.frequency.exponentialRampToValueAtTime(options.to, start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + (options.attack ?? 0.01));
    // Held: full until the last moment, then a quick release (a blast, not a ring dying out).
    if (options.hold) envelope.gain.setValueAtTime(gain, start + duration - 0.07);
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
    envelope.connect(destination ?? (this.master as GainNode));
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private burst(
    start: number,
    duration: number,
    gain: number,
    filter: { type: BiquadFilterType; from: number; to: number; q: number; swell?: number },
    destination?: AudioNode,
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
    envelope.connect(destination ?? (this.master as GainNode));
    source.start(start, Math.random() * 0.5);
    source.stop(start + duration + 0.02);
  }
}
