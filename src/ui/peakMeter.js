/**
 * Live peak meter for A/B preview — sample peak + peak-hold with
 * OK / HOT / CLIP status against a delivery ceiling (dBTP / dBFS).
 */

import { peakStatus } from '../audio/peakPolish.js';

function dbFromLin(x) {
  return x > 1e-8 ? 20 * Math.log10(x) : -60;
}

export class LivePeakMeter {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.root
   * @param {() => number} opts.getPeakLin  returns 0..1+ instantaneous peak
   * @param {() => boolean} opts.isPlaying
   * @param {number} [opts.ceilingDb]
   */
  constructor({ root, getPeakLin, isPlaying, ceilingDb = -1.0 }) {
    this.root = root;
    this.getPeakLin = getPeakLin;
    this.isPlaying = isPlaying;
    this.ceilingDb = ceilingDb;
    this.holdDb = -60;
    this.holdUntil = 0;
    this.clipLatched = false;
    this._raf = 0;
    this._build();
  }

  _build() {
    this.root.innerHTML = `
      <div class="peaklive" id="peakLive">
        <div class="peaklive__head">
          <span class="peaklive__label">Live peak</span>
          <span class="peaklive__status" data-peak-status>IDLE</span>
        </div>
        <div class="peaklive__bar" aria-hidden="true">
          <div class="peaklive__fill" data-peak-fill></div>
          <div class="peaklive__hold" data-peak-hold></div>
          <div class="peaklive__ceil" data-peak-ceil></div>
        </div>
        <div class="peaklive__readout">
          <span data-peak-inst>−∞</span>
          <span class="peaklive__holdtxt">hold <b data-peak-holdtxt>−∞</b></span>
          <span class="peaklive__ceiltxt">ceil <b data-peak-ceiltxt></b></span>
        </div>
      </div>`;
    this.elStatus = this.root.querySelector('[data-peak-status]');
    this.elFill = this.root.querySelector('[data-peak-fill]');
    this.elHold = this.root.querySelector('[data-peak-hold]');
    this.elCeil = this.root.querySelector('[data-peak-ceil]');
    this.elInst = this.root.querySelector('[data-peak-inst]');
    this.elHoldTxt = this.root.querySelector('[data-peak-holdtxt]');
    this.elCeilTxt = this.root.querySelector('[data-peak-ceiltxt]');
    this.setCeiling(this.ceilingDb);
  }

  setCeiling(ceilingDb) {
    this.ceilingDb = ceilingDb;
    if (this.elCeilTxt) this.elCeilTxt.textContent = `${ceilingDb.toFixed(1)} dB`;
    // Map -60..0 dB onto the bar; place ceiling marker
    const pct = this._dbToPct(ceilingDb);
    if (this.elCeil) this.elCeil.style.left = `${pct}%`;
  }

  reset() {
    this.holdDb = -60;
    this.holdUntil = 0;
    this.clipLatched = false;
    this._paint(-60, -60, 'idle');
  }

  _dbToPct(db) {
    const lo = -48;
    const hi = 3;
    return Math.max(0, Math.min(100, ((db - lo) / (hi - lo)) * 100));
  }

  _paint(instDb, holdDb, status) {
    const root = this.root.querySelector('.peaklive');
    if (!root) return;
    root.dataset.status = status;
    if (this.elStatus) {
      this.elStatus.textContent =
        status === 'clip' ? 'CLIP' :
        status === 'hot' ? 'HOT' :
        status === 'warn' ? 'NEAR' :
        status === 'ok' ? 'OK' : 'IDLE';
    }
    if (this.elFill) this.elFill.style.width = `${this._dbToPct(instDb)}%`;
    if (this.elHold) this.elHold.style.left = `${this._dbToPct(holdDb)}%`;
    if (this.elInst) {
      this.elInst.textContent = Number.isFinite(instDb) && instDb > -59
        ? `${instDb.toFixed(1)} dBFS`
        : '−∞';
    }
    if (this.elHoldTxt) {
      this.elHoldTxt.textContent = Number.isFinite(holdDb) && holdDb > -59
        ? `${holdDb.toFixed(1)}`
        : '−∞';
    }
  }

  start() {
    if (this._raf) return;
    const loop = () => {
      this._raf = requestAnimationFrame(loop);
      const playing = this.isPlaying?.();
      if (!playing) {
        // Decay hold slowly when idle
        if (this.holdDb > -60) {
          this.holdDb = Math.max(-60, this.holdDb - 0.08);
          this._paint(-60, this.holdDb, this.clipLatched ? 'clip' : 'idle');
        }
        return;
      }
      const lin = this.getPeakLin?.() ?? 0;
      const instDb = dbFromLin(lin);
      const now = performance.now();
      if (instDb > this.holdDb) {
        this.holdDb = instDb;
        this.holdUntil = now + 1200;
      } else if (now > this.holdUntil) {
        this.holdDb = Math.max(instDb, this.holdDb - 0.35);
      }
      let status = peakStatus(instDb, this.ceilingDb);
      if (peakStatus(this.holdDb, this.ceilingDb) === 'clip') {
        this.clipLatched = true;
        status = 'clip';
      } else if (this.clipLatched && status === 'ok') {
        // keep CLIP latched until reset / track change
        status = 'clip';
      }
      this._paint(instDb, this.holdDb, status);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
}
