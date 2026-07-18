// 帯域エネルギー検知コア（Mac 検知ページ / iPhone 単体検知の両方で使う共通ロジック）。
// Web Audio の AnalyserNode を受け取り、16.0〜18.2kHz のパワーを合算して playing/stopped を判定する。

export const DEFAULTS = Object.freeze({
  lowHz: 16000,
  highHz: 18200,
  threshold: -70,      // dB。キャリブレーション前の暫定値
  holdStopMs: 60,      // 停止判定の保持時間（デバウンス）
  holdStartMs: 30,     // 再開判定の保持時間
});

export class DetectorEngine {
  /**
   * @param {AnalyserNode} analyser  fftSize と smoothingTimeConstant は呼び出し側で設定済みであること
   * @param {number} sampleRate      audioContext.sampleRate
   * @param {object} opts            DEFAULTS を上書きする設定
   */
  constructor(analyser, sampleRate, opts = {}) {
    this.analyser = analyser;
    this.sampleRate = sampleRate;
    this.cfg = { ...DEFAULTS, ...opts };
    this.buffer = new Float32Array(analyser.frequencyBinCount);

    this.playing = true;        // 初期は「鳴っている」扱い（頭の無音で誤トリガーしないため）
    this.level = -Infinity;     // 直近の帯域レベル (dB)
    this._silenceStart = null;  // 閾値割れが始まった時刻
    this._loudStart = null;     // 閾値超えが始まった時刻
    this._recomputeBins();
  }

  setConfig(patch) {
    Object.assign(this.cfg, patch);
    if (patch.lowHz !== undefined || patch.highHz !== undefined) this._recomputeBins();
  }

  _recomputeBins() {
    const binWidth = this.sampleRate / this.analyser.fftSize;
    this.lowBin = Math.floor(this.cfg.lowHz / binWidth);
    this.highBin = Math.min(Math.ceil(this.cfg.highHz / binWidth), this.buffer.length - 1);
    this.binWidth = binWidth;
  }

  /** 現在の帯域レベル(dB)を測るだけ。状態遷移は行わない（キャリブレーション用）。 */
  measureLevel() {
    this.analyser.getFloatFrequencyData(this.buffer);
    let energy = 0;
    for (let i = this.lowBin; i <= this.highBin; i++) {
      const db = this.buffer[i];
      if (db > -Infinity) energy += Math.pow(10, db / 10); // dB→リニアに戻して合算
    }
    this.level = energy > 0 ? 10 * Math.log10(energy) : -Infinity;
    return this.level;
  }

  /**
   * 1 フレーム分の判定を進める。状態が変化したら true を返す。
   * @param {number} now  performance.now() 等の単調増加時刻(ms)
   */
  tick(now) {
    this.measureLevel();
    let changed = false;

    if (this.level >= this.cfg.threshold) {
      // 閾値超え（音あり）
      this._silenceStart = null;
      if (!this.playing) {
        if (this._loudStart === null) this._loudStart = now;
        if (now - this._loudStart >= this.cfg.holdStartMs) {
          this.playing = true;
          changed = true;
        }
      } else {
        this._loudStart = null;
      }
    } else {
      // 閾値割れ（無音）
      this._loudStart = null;
      if (this.playing) {
        if (this._silenceStart === null) this._silenceStart = now;
        if (now - this._silenceStart >= this.cfg.holdStopMs) {
          this.playing = false;
          changed = true;
        }
      } else {
        this._silenceStart = null;
      }
    }
    return changed;
  }
}
