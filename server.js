// 高周波椅子取り 検知アプリ — ローカルサーバー
// 静的ファイル配信 + WebSocket ブロードキャスト。外部ネットワーク非依存。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// --- 静的ファイル配信 ---
const httpServer = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath === '/') urlPath = '/detector.html';
    // ディレクトリトラバーサル対策
    const safePath = normalize(join(PUBLIC_DIR, urlPath));
    if (!safePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const data = await readFile(safePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(safePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
  }
});

// --- WebSocket ---
const wss = new WebSocketServer({ server: httpServer });

// 最新状態。検知ページから来た state を保持し、心拍で再送する。
let lastState = { type: 'state', playing: false, level: -Infinity, threshold: null, timestamp: Date.now() };

function broadcast(obj, exclude) {
  const msg = JSON.stringify(obj);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === 1) client.send(msg);
  }
}

wss.on('connection', (ws) => {
  // 接続直後に現在状態を送る（受信ページが即座に描画できるように）
  ws.send(JSON.stringify(lastState));
  console.log(`[ws] client connected (total: ${wss.clients.size})`);

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'state') {
      lastState = { ...msg, timestamp: Date.now() };
      // 検知ページ以外の全クライアントへ即時ブロードキャスト
      broadcast(lastState, ws);
    }
  });

  ws.on('close', () => console.log(`[ws] client disconnected (total: ${wss.clients.size})`));
});

// 生存確認用の心拍（500ms ごと）。状態が変化していなくても送り続ける。
setInterval(() => {
  broadcast({ ...lastState, type: 'heartbeat', clients: wss.clients.size });
}, 500);

// --- 起動 ---
httpServer.listen(PORT, () => {
  const urls = [`http://localhost:${PORT}/`];
  for (const [, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${PORT}/`);
    }
  }
  console.log('\n=== 高周波椅子取り 検知サーバー 起動 ===');
  console.log(`検知ページ (Mac):   ${urls[0]}detector.html`);
  console.log('受信ページ (iPhone):');
  for (const u of urls.slice(1)) console.log(`   ${u}receiver.html`);
  if (urls.length === 1) console.log('   （LAN の IPv4 アドレスが見つかりません。テザリング接続を確認）');
  console.log('========================================\n');
});
