import { DetectorEngine, DEFAULTS } from '/shared/detector-core.js';

const FFT_SIZE = 2048;  // 窓43ms(48kHz)。分解能23Hzで帯域には十分、反応を速くするため4096から短縮
const STORAGE_KEY = 'chairgame.detector.cfg';

const el = (id) => document.getElementById(id);
const ui = {
  startBtn: el('startBtn'), state: el('state'), clients: el('clients'),
  level: el('level'), levelBar: el('levelBar'),
  lowHz: el('lowHz'), highHz: el('highHz'), threshold: el('threshold'),
  hysteresis: el('hysteresis'), smooth: el('smooth'),
  holdStop: el('holdStop'), holdStart: el('holdStart'),
  setFromNow: el('setFromNow'), spectrum: el('spectrum'), recvUrl: el('recvUrl'),
  peak: el('peak'), clipWarn: el('clipWarn'),
  presetStd: el('presetStd'), presetVoice: el('presetVoice'), presetFar: el('presetFar'),
  calNoise: el('calNoise'), calMusic: el('calMusic'), calApply: el('calApply'),
  calStatus: el('calStatus'), noiseOut: el('noiseOut'), musicOut: el('musicOut'),
  noiseMargin: el('noiseMargin'),
};

let engine = null;
let audioCtx = null;
let analyser = null;
let ws = null;

// 受信 URL 表示（現在ホスト名を利用）
ui.recvUrl.textContent = `http://${location.host}/receiver.html`;

// --- 設定の保存/復元 ---
function loadCfg() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.lowHz != null) ui.lowHz.value = saved.lowHz;
    if (saved.highHz != null) ui.highHz.value = saved.highHz;
    if (saved.threshold != null) ui.threshold.value = saved.threshold;
    if (saved.hysteresisDb != null) ui.hysteresis.value = saved.hysteresisDb;
    if (saved.smoothMs != null) ui.smooth.value = saved.smoothMs;
    if (saved.holdStopMs != null) ui.holdStop.value = saved.holdStopMs;
    if (saved.holdStartMs != null) ui.holdStart.value = saved.holdStartMs;
  } catch { /* ignore */ }
}
function currentCfg() {
  return {
    lowHz: +ui.lowHz.value, highHz: +ui.highHz.value,
    threshold: +ui.threshold.value, hysteresisDb: +ui.hysteresis.value,
    smoothMs: +ui.smooth.value,
    holdStopMs: +ui.holdStop.value, holdStartMs: +ui.holdStart.value,
  };
}
function saveCfg() { localStorage.setItem(STORAGE_KEY, JSON.stringify(currentCfg())); }

function applyCfg() {
  if (engine) engine.setConfig(currentCfg());
  saveCfg();
}
for (const inp of [ui.lowHz, ui.highHz, ui.threshold, ui.hysteresis, ui.smooth, ui.holdStop, ui.holdStart]) {
  inp.addEventListener('change', applyCfg);
}
loadCfg();

// --- WebSocket ---
function connectWs() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.addEventListener('message', (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.clients != null) ui.clients.textContent = `接続 ${m.clients} 台`;
    } catch { /* ignore */ }
  });
  ws.addEventListener('close', () => setTimeout(connectWs, 1000));
}
function broadcastState() {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'state', playing: engine.playing,
      level: Number.isFinite(engine.level) ? +engine.level.toFixed(1) : -999,
      threshold: engine.cfg.threshold, timestamp: Date.now(),
    }));
  }
}

// --- マイク開始 ---
ui.startBtn.addEventListener('click', async () => {
  if (audioCtx) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0;
    src.connect(analyser);

    engine = new DetectorEngine(analyser, audioCtx.sampleRate, currentCfg());
    connectWs();
    ui.startBtn.disabled = true;
    ui.startBtn.textContent = '検知中';
    requestAnimationFrame(loop);
  } catch (e) {
    alert('マイクを開始できません: ' + e.message);
  }
});

// 帯域プリセット（下限・上限をまとめて設定）
function setBand(low, high) { ui.lowHz.value = low; ui.highHz.value = high; applyCfg(); }
ui.presetStd.addEventListener('click', () => setBand(16000, 18500));   // 標準
ui.presetVoice.addEventListener('click', () => setBand(17000, 18500)); // 声除外
ui.presetFar.addEventListener('click', () => setBand(16000, 17500));   // 遠距離：最もよく届く帯域に絞る

ui.setFromNow.addEventListener('click', () => {
  if (!engine) return;
  const lv = engine.measureLevel();
  if (Number.isFinite(lv)) {
    ui.threshold.value = Math.round(lv - 25);
    applyCfg();
  }
});

// --- キャリブレーション（雑音対策）---
const CAL_KEY = 'chairgame.detector.cal';
const cal = { noiseFloor: null, musicLevel: null, ...JSON.parse(localStorage.getItem(CAL_KEY) || '{}') };
let collecting = null; // { samples: [], done: (arr)=>void }

function renderCal() {
  ui.noiseOut.textContent = 'ノイズフロア: ' + (cal.noiseFloor != null ? cal.noiseFloor.toFixed(1) + ' dB' : '—');
  ui.musicOut.textContent = '音源レベル: ' + (cal.musicLevel != null ? cal.musicLevel.toFixed(1) + ' dB' : '—');
  ui.calApply.disabled = !(cal.noiseFloor != null && cal.musicLevel != null);
}
renderCal();

function percentile(arr, p) {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function collect(ms, done) {
  if (!engine) { alert('先に「マイク開始」を押してください'); return; }
  collecting = { samples: [], done };
  const btns = [ui.calNoise, ui.calMusic];
  btns.forEach((b) => (b.disabled = true));
  const t0 = performance.now();
  ui.calStatus.textContent = '測定中…';
  const timer = setInterval(() => {
    const remain = Math.max(0, ms - (performance.now() - t0));
    ui.calStatus.textContent = `測定中… ${(remain / 1000).toFixed(1)}s`;
    if (remain <= 0) {
      clearInterval(timer);
      const samples = collecting.samples;
      collecting = null;
      btns.forEach((b) => (b.disabled = false));
      ui.calStatus.textContent = '';
      done(samples);
    }
  }, 100);
}

ui.calNoise.addEventListener('click', () => collect(3000, (s) => {
  cal.noiseFloor = percentile(s, 95); // 定常ノイズがたまに達する上端
  localStorage.setItem(CAL_KEY, JSON.stringify(cal));
  renderCal();
}));
ui.calMusic.addEventListener('click', () => collect(5000, (s) => {
  cal.musicLevel = percentile(s, 50); // 音源レベルの中央値
  localStorage.setItem(CAL_KEY, JSON.stringify(cal));
  renderCal();
}));
ui.calApply.addEventListener('click', () => {
  if (cal.noiseFloor == null || cal.musicLevel == null) return;
  const margin = +ui.noiseMargin.value || 8;
  const floorGuard = cal.noiseFloor + margin;   // ノイズより十分上
  const musicGuard = cal.musicLevel - 3;        // 音源より少し下
  let th = cal.musicLevel - 25;                 // 基本は音源中央値−25dB
  th = Math.min(Math.max(th, floorGuard), musicGuard);
  ui.threshold.value = Math.round(th);
  applyCfg();
  if (floorGuard >= musicGuard) {
    ui.calStatus.textContent = '⚠️ ノイズと音源の差が小さく誤検知の恐れ（音量↑や設置見直しを）';
  } else {
    ui.calStatus.textContent = `✓ 閾値 ${Math.round(th)}dB（SNR 約 ${(cal.musicLevel - cal.noiseFloor).toFixed(0)}dB）`;
  }
});

// --- メインループ ---
const specCtx = ui.spectrum.getContext('2d');
let timeBuf = null;
function loop(now) {
  const changed = engine.tick(now);
  if (changed) broadcastState();
  if (collecting) collecting.samples.push(engine.level);

  // 表示更新
  const lv = engine.level;
  ui.level.textContent = Number.isFinite(lv) ? lv.toFixed(1) : '−∞';
  const pct = Math.max(0, Math.min(100, ((lv + 120) / 120) * 100));
  ui.levelBar.style.width = pct + '%';
  ui.state.className = 'state-badge ' + (engine.playing ? 'playing' : 'stopped');
  ui.state.textContent = engine.playing ? '鳴っている' : '停止';

  // 入力ピーク／クリップ検知（時間波形の絶対最大値）
  if (!timeBuf) timeBuf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(timeBuf);
  let peak = 0;
  for (let i = 0; i < timeBuf.length; i++) { const a = Math.abs(timeBuf[i]); if (a > peak) peak = a; }
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  ui.peak.textContent = Number.isFinite(peakDb) ? `${peakDb.toFixed(1)} dBFS` : '−∞';
  ui.clipWarn.style.display = peak >= 0.985 ? 'inline-block' : 'none';

  drawSpectrum();
  requestAnimationFrame(loop);
}

function drawSpectrum() {
  const W = ui.spectrum.width, H = ui.spectrum.height;
  specCtx.clearRect(0, 0, W, H);
  const buf = engine.buffer; // tick() 内で取得済み
  const binWidth = engine.binWidth;
  const fromHz = 10000, toHz = 20000;
  const fromBin = Math.floor(fromHz / binWidth), toBin = Math.ceil(toHz / binWidth);

  specCtx.fillStyle = '#0a84ff';
  for (let i = fromBin; i <= toBin; i++) {
    const x = ((i - fromBin) / (toBin - fromBin)) * W;
    const db = buf[i];
    const h = Math.max(0, Math.min(H, ((db + 120) / 120) * H));
    specCtx.fillRect(x, H - h, Math.max(1, W / (toBin - fromBin)), h);
  }
  // 監視帯域の縦線
  specCtx.strokeStyle = '#30d158';
  for (const hz of [engine.cfg.lowHz, engine.cfg.highHz]) {
    const x = ((hz / binWidth - fromBin) / (toBin - fromBin)) * W;
    specCtx.beginPath(); specCtx.moveTo(x, 0); specCtx.lineTo(x, H); specCtx.stroke();
  }
  // 閾値の横線（赤=停止境界、橙=再生境界=閾値+ヒステリシス）
  const yFor = (db) => H - Math.max(0, Math.min(H, ((db + 120) / 120) * H));
  specCtx.strokeStyle = '#ff453a';
  specCtx.beginPath(); specCtx.moveTo(0, yFor(engine.cfg.threshold)); specCtx.lineTo(W, yFor(engine.cfg.threshold)); specCtx.stroke();
  specCtx.strokeStyle = '#ff9f0a';
  specCtx.beginPath();
  const yStart = yFor(engine.cfg.threshold + engine.cfg.hysteresisDb);
  specCtx.moveTo(0, yStart); specCtx.lineTo(W, yStart); specCtx.stroke();
}
