# 高周波椅子取り 検知アプリ

可聴域外の高周波 BGM（16.0〜18.2kHz）が「鳴っているか / 止まったか」をマイクで検知し、
LAN 経由で iPhone に低遅延（画面点滅＋音）で伝えるツール。

詳しい設計は [`.docs/spec.md`](.docs/spec.md) を参照。

## 現状（MVP）

実装済み:

1. **検知ロジック**（Mac）— 16-18.2kHz 帯域エネルギー判定・デバウンス（停止60ms / 再開30ms）
2. **WebSocket サーバー** — 静的配信＋全クライアントへ状態ブロードキャスト＋500ms心拍
3. **受信ページ**（iPhone）— 鳴っている間は黒、止まると白黒10Hz点滅
4. **音声合図（方式B）** — 鳴っている間 440Hz 持続音、止まった瞬間 880Hz 一発
5. 接続断の警告表示 / 明暗反転 / 画面・音の個別ON・OFF / デバッグ表示

未実装（今後）: キャリブレーション自動化、iPhone単体検知フォールバック（要HTTPS）、PWA、練習モード、ヘテロダイン方式A。

## 使い方

```bash
npm install
npm start
```

起動後、コンソールに URL が出る。

- **Mac（検知）**: `http://localhost:8080/detector.html` を開き「マイク開始」。
  - マイク権限を許可。`echoCancellation/noiseSuppression/autoGainControl` は false 固定。
  - 音源を再生した状態で「現在値−25dBに設定」を押すと閾値を手早く合わせられる。
- **iPhone（受信）**: 同じ LAN から `http://<MacのIP>:8080/receiver.html` を開き「タップして開始」。

### 検証（音源なしでの簡易確認）

Mac のスペクトラム表示に高周波（口笛・鍵束を擦る音など 16kHz 付近）が乗るか、
閾値をまたいだ時に受信ページが点滅・音を出すかを確認する。

## 構成

```
server.js                  HTTP 静的配信 + WebSocket ブロードキャスト
public/
  detector.html/.js        Mac 検知ページ
  receiver.html/.js        iPhone 受信ページ（点滅＋音）
  shared/detector-core.js  帯域エネルギー検知コア（共通）
  style.css
.docs/spec.md              仕様書
```

## 注意

- iOS 単体検知（自分のマイク）や Screen Wake Lock は HTTPS（セキュアコンテキスト）必須。MVP は HTTP のため未対応。
- Bluetooth イヤホンは 150〜300ms 遅延。**画面を本命、音は保険**。有線推奨。
