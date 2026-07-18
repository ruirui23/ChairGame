// 受信ページ：WS の playing 状態を受けて画面点滅＋音声合図（方式B：一定音ゲート）。
const el = (id) => document.getElementById(id);
const signal = el('signal');
const overlay = el('startOverlay');
const warning = el('warning');
const dbg = el('debug');

const FLASH_HZ = 10;               // 停止時の点滅周波数
const DISCONNECT_MS = 1500;        // 心拍がこの時間途切れたら「未接続」警告

let started = false;
let playing = true;                // 現在の判定状態
let lastMsgAt = 0;

// 設定（localStorage 永続化）
const prefs = {
  screen: true, sound: true, invert: false, debug: false,
  ...JSON.parse(localStorage.getItem('chairgame.receiver') || '{}'),
};
function savePrefs() { localStorage.setItem('chairgame.receiver', JSON.stringify(prefs)); }

// ===== 音声（方式B）=====
let audioCtx = null, sustainOsc = null, sustainGain = null;
function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sustainGain = audioCtx.createGain();
  sustainGain.gain.value = 0;
  sustainGain.connect(audioCtx.destination);
  sustainOsc = audioCtx.createOscillator();
  sustainOsc.type = 'sine';
  sustainOsc.frequency.value = 440;   // 鳴っている間の持続音
  sustainOsc.connect(sustainGain);
  sustainOsc.start();
}
function setSustain(on) {
  if (!audioCtx) return;
  const g = sustainGain.gain;
  g.cancelScheduledValues(audioCtx.currentTime);
  g.linearRampToValueAtTime(on && prefs.sound ? 0.06 : 0, audioCtx.currentTime + 0.02);
}
function blipStop() {
  if (!audioCtx || !prefs.sound) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 880;          // 止まった瞬間の一発（音色を変える）
  g.gain.setValueAtTime(0.25, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + 0.09);
}

// ===== 画面点滅 =====
let flashOn = false;
setInterval(() => {
  if (!started) return;
  if (playing) {
    // 鳴っている間：真っ黒（反転時は真っ白）
    signal.style.background = prefs.invert ? '#fff' : '#000';
  } else if (prefs.screen) {
    // 止まった：白黒点滅
    flashOn = !flashOn;
    signal.style.background = flashOn ? '#fff' : '#000';
  } else {
    signal.style.background = '#000';
  }
}, 1000 / (FLASH_HZ * 2));

// ===== 状態適用 =====
function applyState(nextPlaying) {
  if (nextPlaying === playing) return;
  playing = nextPlaying;
  if (playing) {
    setSustain(true);
  } else {
    setSustain(false);
    blipStop();
  }
}

// ===== WebSocket =====
let ws = null;
function connectWs() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.addEventListener('message', (ev) => {
    lastMsgAt = performance.now();
    try {
      const m = JSON.parse(ev.data);
      if (typeof m.playing === 'boolean') applyState(m.playing);
      if (prefs.debug) {
        el('dbgState').textContent = m.playing ? 'PLAYING' : 'STOPPED';
        el('dbgLevel').textContent = `lv ${m.level ?? '—'} / th ${m.threshold ?? '—'}`;
      }
    } catch { /* ignore */ }
  });
  ws.addEventListener('close', () => setTimeout(connectWs, 800));
  ws.addEventListener('error', () => ws.close());
}

// 接続監視
setInterval(() => {
  if (!started) return;
  const stale = performance.now() - lastMsgAt > DISCONNECT_MS;
  warning.style.display = stale ? 'block' : 'none';
}, 300);

// ===== Wake Lock（対応時のみ。iOS Safari は要 HTTPS のため後日 NoSleep 追加）=====
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (wakeLock === null && document.visibilityState === 'visible') requestWakeLock();
      });
    }
  } catch { /* 非対応時は無視 */ }
}

// ===== 開始（タップでアンロック）=====
function start() {
  if (started) return;
  started = true;
  overlay.style.display = 'none';
  initAudio();
  connectWs();
  requestWakeLock();
  lastMsgAt = performance.now();
  applyControls();
}
overlay.addEventListener('click', start);
overlay.addEventListener('touchend', (e) => { e.preventDefault(); start(); });

// ===== コントロール =====
function applyControls() {
  el('toggleScreen').textContent = prefs.screen ? '画面ON' : '画面OFF';
  el('toggleSound').textContent = prefs.sound ? '音ON' : '音OFF';
  el('toggleInvert').textContent = prefs.invert ? '反転ON' : '反転OFF';
  dbg.style.display = prefs.debug ? 'flex' : 'none';
  setSustain(playing);
}
el('toggleScreen').addEventListener('click', () => { prefs.screen = !prefs.screen; savePrefs(); applyControls(); });
el('toggleSound').addEventListener('click', () => { prefs.sound = !prefs.sound; savePrefs(); applyControls(); });
el('toggleInvert').addEventListener('click', () => { prefs.invert = !prefs.invert; savePrefs(); applyControls(); });
el('toggleDebug').addEventListener('click', () => { prefs.debug = !prefs.debug; savePrefs(); applyControls(); });
