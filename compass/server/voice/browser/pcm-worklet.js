// COMPASS audio worklets. Mic: context rate -> 24 kHz PCM16 frames (40 ms).
// Player: 24 kHz PCM16 -> context rate, instant flush for barge-in.
const TARGET = 24000;

class CompassMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET; // e.g. 2 for 48 kHz
    this.pos = 0;
    this.frame = new Int16Array(960);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    // Linear resample to 24 kHz.
    while (this.pos < ch.length) {
      const i = Math.floor(this.pos); const f = this.pos - i;
      const a = ch[i]; const b = i + 1 < ch.length ? ch[i + 1] : a;
      const v = Math.max(-1, Math.min(1, a + (b - a) * f));
      this.frame[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === this.frame.length) {
        let s = 0; for (let k = 0; k < this.n; k++) s += (this.frame[k] / 32768) ** 2;
        const buf = this.frame.buffer.slice(0);
        this.port.postMessage({ type: 'frame', pcm: buf, rms: Math.sqrt(s / this.n) }, [buf]);
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    return true;
  }
}

class CompassPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = TARGET / sampleRate; // source samples per output sample
    this.queue = []; this.cur = null; this.idx = 0;
    this.played = 0; // in 24 kHz source samples
    this.active = false;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'push') {
        const i16 = new Int16Array(m.pcm); const f = new Float32Array(i16.length);
        for (let k = 0; k < i16.length; k++) f[k] = i16[k] / 32768;
        this.queue.push(f);
      } else if (m.type === 'flush') {
        this.queue = []; this.cur = null; this.idx = 0;
        const wasActive = this.active; this.active = false;
        this.port.postMessage({ type: 'flushed', played: this.played, wasActive });
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    for (let k = 0; k < out.length; k++) {
      if (!this.cur || this.idx >= this.cur.length) {
        if (this.cur) { this.idx -= this.cur.length; }
        this.cur = this.queue.shift() || null;
        if (!this.cur) {
          this.idx = 0;
          if (this.active) { this.active = false; this.port.postMessage({ type: 'drained', played: this.played }); }
          out[k] = 0; continue;
        }
      }
      if (!this.active) { this.active = true; this.port.postMessage({ type: 'started', played: this.played }); }
      const i = Math.floor(this.idx); const f = this.idx - i;
      const a = this.cur[i]; const b = i + 1 < this.cur.length ? this.cur[i + 1] : a;
      out[k] = a + (b - a) * f;
      const before = Math.floor(this.idx);
      this.idx += this.step;
      this.played += Math.floor(this.idx) - before;
    }
    return true;
  }
}

registerProcessor('compass-mic', CompassMic);
registerProcessor('compass-player', CompassPlayer);
