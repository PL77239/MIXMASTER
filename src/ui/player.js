// Small A/B audio player driven by two AudioBuffers sharing one timeline.
export class ABPlayer {
  constructor({ onTime, onEnd }) {
    this.ctx = null;
    this.buffers = { original: null, mastered: null };
    this.which = 'original';
    this.source = null;
    this.startedAt = 0;
    this.offset = 0;
    this.playing = false;
    this.onTime = onTime;
    this.onEnd = onEnd;
    this._raf = null;
  }

  _ensureCtx() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setBuffers(original, mastered) {
    this.buffers.original = original;
    this.buffers.mastered = mastered;
    this.offset = 0;
  }

  get duration() {
    const b = this.buffers[this.which];
    return b ? b.duration : 0;
  }

  _stopSource() {
    if (this.source) {
      try { this.source.onended = null; this.source.stop(); } catch (e) { /* noop */ }
      this.source = null;
    }
  }

  _tick = () => {
    if (!this.playing) return;
    const t = this.offset + (this.ctx.currentTime - this.startedAt);
    if (t >= this.duration) {
      this.pause();
      this.offset = 0;
      this.onTime && this.onTime(this.duration, this.duration);
      this.onEnd && this.onEnd();
      return;
    }
    this.onTime && this.onTime(t, this.duration);
    this._raf = requestAnimationFrame(this._tick);
  };

  play() {
    this._ensureCtx();
    const buffer = this.buffers[this.which];
    if (!buffer) return;
    this._stopSource();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.connect(this.ctx.destination);
    this.source.start(0, Math.min(this.offset, buffer.duration - 0.01));
    this.startedAt = this.ctx.currentTime;
    this.playing = true;
    this._raf = requestAnimationFrame(this._tick);
  }

  pause() {
    if (this.playing && this.ctx) {
      this.offset += this.ctx.currentTime - this.startedAt;
    }
    this.playing = false;
    this._stopSource();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
    return this.playing;
  }

  seek(fraction) {
    this.offset = Math.max(0, Math.min(1, fraction)) * this.duration;
    if (this.playing) this.play();
    else this.onTime && this.onTime(this.offset, this.duration);
  }

  switchTo(which) {
    if (which === this.which) return;
    const wasPlaying = this.playing;
    if (this.playing) {
      this.offset += this.ctx.currentTime - this.startedAt;
      this._stopSource();
      this.playing = false;
    }
    this.which = which;
    if (wasPlaying) this.play();
    else this.onTime && this.onTime(this.offset, this.duration);
  }
}
