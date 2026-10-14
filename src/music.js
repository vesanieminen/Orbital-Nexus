// Generative Blade Runner / Vangelis-esque score, synthesized live with Web Audio.
// Slow jazzy minor-9th pads with filter sweeps, a gliding lead with delayed
// vibrato, sparse bell phrases, sub bass — all drenched in convolution reverb.
// A random walk through chord space means it never repeats. Tempo ~45 BPM feel.
import { rand, randInt, pick, clamp } from './config.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// jazzy voicings (semitones from root)
const CHORDS = [
  { iv: [0, 3, 7, 10, 14] },          // m9
  { iv: [0, 3, 7, 10, 17] },          // m11
  { iv: [0, 4, 7, 11, 14] },          // maj9
  { iv: [0, 4, 7, 11, 18] },          // maj7#11 (Vangelis color)
  { iv: [0, 5, 7, 10, 14] },          // 7sus4
  { iv: [0, 3, 6, 10, 14] },          // ø9
  { iv: [0, 2, 7, 14] },              // sus2add9
  { iv: [0, 3, 7, 14] },              // m(add9)
];
const MINORISH = [true, true, false, false, true, true, false, true];

// lead scales (semitones from root), pentatonic-ish with color tones
const SCALE_MINOR = [0, 3, 5, 7, 10, 12, 14, 15, 17, 19, 22, 24];
const SCALE_MAJOR = [0, 2, 4, 7, 9, 11, 12, 14, 16, 19, 21, 24];

export class Music {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this._timer = null;
    this._root = 45;                    // A2
    this._chordIdx = -1;
    this._phase = 0;                    // section counter for long-form variation
    this._leadSkip = 0.35;
    this._bellP = 0.4;
  }

  // ------------------------------------------------------------- graph
  _init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = this.ctx = new AC();

    const master = this.master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22; comp.ratio.value = 3.5;
    comp.attack.value = 0.01; comp.release.value = 0.7;
    master.connect(comp); comp.connect(ctx.destination);

    // big hall reverb bus
    const conv = ctx.createConvolver();
    conv.buffer = this._makeIR(ctx, 4.6, 2.8);
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    this.send = ctx.createGain(); this.send.gain.value = 1;
    this.send.connect(conv); conv.connect(wet); wet.connect(master);

    // dotted feedback delay for the lead
    this.delayIn = ctx.createGain();
    const dl = ctx.createDelay(1.5); dl.delayTime.value = 0.46;
    const fb = ctx.createGain(); fb.gain.value = 0.36;
    const dWet = ctx.createGain(); dWet.gain.value = 0.4;
    this.delayIn.connect(dl); dl.connect(fb); fb.connect(dl);
    dl.connect(dWet); dWet.connect(this.send);
  }

  _makeIR(ctx, dur, decay) {
    const sr = ctx.sampleRate, n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        let a = Math.pow(1 - t, decay);
        if (i < sr * 0.05) a *= 0.35;                 // pre-delay gap
        d[i] = (Math.random() * 2 - 1) * a;
      }
    }
    return buf;
  }

  // ------------------------------------------------------------- transport
  toggle() {
    if (!this.ctx) this._init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.enabled = !this.enabled;
    const t = this.ctx.currentTime;
    const g = this.master.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    if (this.enabled) {
      g.linearRampToValueAtTime(0.5, t + 4);          // slow, cinematic fade-in
      this._nextChord = t + 1.2;
      if (!this._timer) this._timer = setInterval(() => this._tick(), 400);
    } else {
      g.linearRampToValueAtTime(0, t + 2);
      clearInterval(this._timer); this._timer = null; // already-scheduled tails fade with the master
    }
    return this.enabled;
  }

  _tick() {
    const ctx = this.ctx;
    while (this._nextChord < ctx.currentTime + 2.5) {
      const dur = rand(9, 16);
      const c = this._nextChordData();
      this._pad(c, this._nextChord, dur);
      this._bass(c.root - 12, this._nextChord, dur);
      if (Math.random() < 0.55) this._bass(c.root - 12 + (Math.random() < 0.5 ? 7 : 5), this._nextChord + dur * rand(0.4, 0.6), dur * 0.45);
      this._leadPhrase(c, this._nextChord, dur);
      if (Math.random() < this._bellP) this._bellPhrase(c, this._nextChord, dur);
      this._nextChord += dur;
    }
  }

  // random walk through roots; occasional chromatic-mediant shift for that
  // Vangelis "sudden distant key" feeling
  _nextChordData() {
    if (Math.random() < 0.12) {
      this._root += pick([-4, -3, 3, 4]);
    } else {
      this._root += pick([-5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 7]);
    }
    this._root = clamp(this._root, 40, 52);
    let idx;
    do { idx = randInt(0, CHORDS.length - 1); } while (idx === this._chordIdx);
    this._chordIdx = idx;
    const def = CHORDS[idx];
    const minorish = MINORISH[idx];
    const notes = def.iv.map((s, i) => this._root + 12 + s + (i > 2 && Math.random() < 0.3 ? 12 : 0));
    // long-form: every 5-7 chords, reshuffle density / register
    if (++this._phase % randInt(5, 7) === 0) {
      this._leadSkip = rand(0.2, 0.55);
      this._bellP = rand(0.25, 0.6);
    }
    return { root: this._root, notes, minorish };
  }

  // ------------------------------------------------------------- voices
  // lush pad: detuned saws + triangle subs through a slowly sweeping filter
  _pad(c, t0, dur) {
    const ctx = this.ctx;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 0.8;
    filt.frequency.setValueAtTime(300, t0);
    filt.frequency.linearRampToValueAtTime(rand(650, 1150), t0 + dur * 0.45);
    filt.frequency.linearRampToValueAtTime(340, t0 + dur + 5);
    const lfo = ctx.createOscillator(); lfo.frequency.value = rand(0.02, 0.07);
    const lfoG = ctx.createGain(); lfoG.gain.value = 170;
    lfo.connect(lfoG); lfoG.connect(filt.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + 8);

    const bus = ctx.createGain();
    const lvl = rand(0.13, 0.18);
    bus.gain.setValueAtTime(0, t0);
    bus.gain.linearRampToValueAtTime(lvl, t0 + rand(2.5, 4.5));
    bus.gain.setValueAtTime(lvl, t0 + dur - 1);
    bus.gain.linearRampToValueAtTime(0, t0 + dur + 6);
    filt.connect(bus); bus.connect(this.master); bus.connect(this.send);

    for (const m of c.notes) {
      const f = mtof(m);
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = f;
        o.detune.value = det + rand(-3, 3);
        o.connect(filt); o.start(t0); o.stop(t0 + dur + 7);
      }
      const sub = ctx.createOscillator();
      sub.type = 'triangle'; sub.frequency.value = f / 2;
      const sg = ctx.createGain(); sg.gain.value = 0.5;
      sub.connect(sg); sg.connect(filt);
      sub.start(t0); sub.stop(t0 + dur + 7);
    }
    // airy octave shimmer
    const air = ctx.createGain(); air.gain.value = 0.016;
    air.connect(this.master); air.connect(this.send);
    for (const m of c.notes) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = mtof(m + 12);
      o.connect(air); o.start(t0); o.stop(t0 + dur + 7);
    }
  }

  _bass(midi, t0, dur) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.2, t0 + 1.4);
    g.gain.setValueAtTime(0.2, t0 + dur - 1.5);
    g.gain.linearRampToValueAtTime(0, t0 + dur + 3);
    g.connect(this.master);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    o.connect(g); o2.connect(g2); g2.connect(g);
    o.start(t0); o2.start(t0);
    o.stop(t0 + dur + 4); o2.stop(t0 + dur + 4);
  }

  // gliding saw lead with delayed vibrato — the signature Vangelis voice
  _leadNote(midi, t0, dur, fromFreq) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.Q.value = 1.1;
    filt.frequency.setValueAtTime(900, t0);
    filt.frequency.linearRampToValueAtTime(1700, t0 + 0.6);
    const g = ctx.createGain();
    const lvl = rand(0.09, 0.13);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(lvl, t0 + 0.45);
    g.gain.setValueAtTime(lvl, t0 + Math.max(0.6, dur - 0.9));
    g.gain.linearRampToValueAtTime(0, t0 + dur + 1.1);
    filt.connect(g); g.connect(this.master); g.connect(this.send); g.connect(this.delayIn);

    const vib = ctx.createOscillator(); vib.frequency.value = rand(4.9, 5.7);
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t0);
    vg.gain.setValueAtTime(0, t0 + 0.8);              // vibrato blooms in late
    vg.gain.linearRampToValueAtTime(21, t0 + 1.7);
    vib.connect(vg); vib.start(t0); vib.stop(t0 + dur + 2);

    for (const det of [0, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(fromFreq, t0);
      o.frequency.exponentialRampToValueAtTime(f, t0 + 0.16);   // portamento
      o.detune.value = det;
      vg.connect(o.detune);
      o.connect(filt); o.start(t0); o.stop(t0 + dur + 1.6);
    }
  }

  _leadPhrase(c, t0, dur) {
    if (Math.random() < this._leadSkip) return;       // long rests keep it chill
    const scale = c.minorish ? SCALE_MINOR : SCALE_MAJOR;
    let t = t0 + rand(1.5, dur * 0.5);
    const n = randInt(2, 6);
    let prev = c.root + 24 + pick([0, 3, 7, 12]);
    for (let i = 0; i < n; i++) {
      const cand = [];
      for (const s of scale) {
        const m = c.root + 12 + s;
        if (m >= c.root + 20 && m <= c.root + 36 && Math.abs(m - prev) <= 9) cand.push(m);
      }
      if (!cand.length) break;
      const m = pick(cand);
      const nd = rand(1.2, 3.4);
      this._leadNote(m, t, nd, i === 0 ? mtof(m) : mtof(prev));
      t += nd + rand(0.4, 2.4);
      prev = m;
      if (t > t0 + dur + 3) break;
    }
  }

  // distant glassy bells
  _bellPhrase(c, t0, dur) {
    const ctx = this.ctx;
    const scale = c.minorish ? SCALE_MINOR : SCALE_MAJOR;
    let t = t0 + rand(2, dur * 0.7);
    const n = randInt(2, 5);
    for (let i = 0; i < n; i++) {
      const m = c.root + 24 + pick(scale);
      const f = mtof(m);
      const g = ctx.createGain();
      const lvl = rand(0.05, 0.09);
      g.gain.setValueAtTime(lvl, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + rand(2.2, 3.4));
      g.connect(this.master); g.connect(this.send);
      for (const [mult, amp] of [[1, 1], [2, 0.4], [3.4, 0.15]]) {
        const o = ctx.createOscillator();
        o.type = mult === 1 ? 'triangle' : 'sine';
        o.frequency.value = f * mult;
        const og = ctx.createGain(); og.gain.value = amp;
        o.connect(og); og.connect(g);
        o.start(t); o.stop(t + 4);
      }
      t += rand(1.4, 4.5);
      if (t > t0 + dur + 4) break;
    }
  }
}
