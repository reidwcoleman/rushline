// Procedural sound: UI sfx, a city bed that follows the simulation, and a quiet generative pad.
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private bed!: GainNode;
  private rumble!: GainNode;
  private rainG!: GainNode;
  private pad!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;
  musicOn = true;
  private nextChord = 0;
  private chordIdx = 0;
  private nextBird = 0;

  get ready() { return !!this.ctx; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctx) return;
    const c = (this.ctx = new Ctx());
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.9; this.master.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.6; this.sfxBus.connect(this.master);
    // noise buffer
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    }
    const mkNoise = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return g;
    };
    this.bed = mkNoise('bandpass', 520, 0.4);
    this.rumble = mkNoise('lowpass', 140, 0.5);
    this.rainG = mkNoise('highpass', 2400, 0.4);
    this.pad = c.createGain(); this.pad.gain.value = 0; this.pad.connect(this.master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.3;
    lp.connect(this.pad);
    (this as any).padFilter = lp;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.08);
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2, delay = 0, slide = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(dur: number, freq: number, vol: number, sweep = 0.4, delay = 0) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxBus); src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  sfx(name: string) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'click': this.tone(760, 0.05, 'triangle', 0.12); break;
      case 'tick': this.tone(1200, 0.03, 'sine', 0.06); break;
      case 'build': this.tone(150, 0.14, 'sine', 0.35, 0, 0.6); this.burst(0.12, 1800, 0.22, 0.3); this.tone(520, 0.08, 'triangle', 0.1, 0.03); break;
      case 'demolish': this.burst(0.42, 2400, 0.4, 0.18); this.tone(90, 0.3, 'sine', 0.3, 0, 0.5); break;
      case 'line': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.14, i * 0.075)); break;
      case 'alert': this.tone(466, 0.16, 'square', 0.07); this.tone(349, 0.22, 'square', 0.07, 0.16); break;
      case 'unlock': this.tone(330, 0.5, 'triangle', 0.16, 0, 2.2); this.tone(660, 0.4, 'sine', 0.1, 0.12); break;
      case 'milestone': [392, 494, 587, 784].forEach((f, i) => { this.tone(f, 0.9, 'sine', 0.13, i * 0.09); this.tone(f * 2, 0.6, 'triangle', 0.05, i * 0.09); }); break;
      case 'over': [330, 262, 196, 131].forEach((f, i) => this.tone(f, 0.9, 'sawtooth', 0.08, i * 0.22)); break;
      case 'horn': this.tone(98, 0.9, 'sawtooth', 0.07); this.tone(123, 0.9, 'sawtooth', 0.05); this.tone(196, 0.9, 'triangle', 0.04); break;
      case 'bell': this.tone(1568, 0.34, 'sine', 0.06); this.tone(1568, 0.34, 'sine', 0.05, 0.16); this.tone(2349, 0.2, 'sine', 0.025, 0.02); break;
      case 'error': this.tone(180, 0.14, 'square', 0.08); this.tone(140, 0.18, 'square', 0.08, 0.1); break;
    }
  }

  /** drive the ambience from the sim state */
  update(pop: number, night: number, rain: number, traffic: number, speed: number, dt: number) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const live = speed > 0 ? 1 : 0.35;
    const city = Math.min(1, pop / 3000);
    this.bed.gain.setTargetAtTime((0.012 + city * 0.05) * live * (1 - night * 0.45), t, 0.8);
    this.rumble.gain.setTargetAtTime((0.01 + traffic * 0.1 + city * 0.03) * live, t, 0.8);
    this.rainG.gain.setTargetAtTime(rain * 0.035, t, 1.2);
    // birds by day
    if (!this.muted && night < 0.3 && rain < 0.2 && speed > 0) {
      this.nextBird -= dt;
      if (this.nextBird <= 0) {
        this.nextBird = 3 + Math.random() * 9;
        const base = 2400 + Math.random() * 1600;
        const n = 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < n; i++) this.tone(base * (1 + (i % 2) * 0.12), 0.07, 'sine', 0.018, i * 0.09, 1.25);
      }
    }
    // generative pad
    if (this.musicOn && !this.muted) {
      this.pad.gain.setTargetAtTime(0.05 * (0.5 + 0.5 * live), t, 2);
      this.nextChord -= dt;
      if (this.nextChord <= 0) {
        this.nextChord = 9.5;
        const prog = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 62], [55, 59, 62, 65]];
        const chord = prog[this.chordIdx++ % prog.length];
        const f = (this as any).padFilter as BiquadFilterNode;
        for (const m of chord) {
          const freq = 440 * Math.pow(2, (m - 69) / 12);
          for (const det of [-6, 6]) {
            const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = det;
            const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1, t + 3.2); g.gain.linearRampToValueAtTime(0.0001, t + 10.5);
            o.connect(g); g.connect(f); o.start(t); o.stop(t + 11);
          }
        }
      }
    } else this.pad.gain.setTargetAtTime(0, t, 0.5);
  }
}
