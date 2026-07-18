#!/usr/bin/env python3
"""実音源を解析し、検知帯域(16-18.2kHz)のエネルギー分布・無音区間・帯域内訳を出す。"""
import sys
import numpy as np
import soundfile as sf

FRAME = 4096
HOP = 1024
BAND_LO, BAND_HI = 16000, 18200

def band_bins(sr, lo, hi, n=FRAME):
    freqs = np.fft.rfftfreq(n, 1 / sr)
    return np.where((freqs >= lo) & (freqs <= hi))[0], freqs

def analyze(path):
    x, sr = sf.read(path, dtype="float64")
    if x.ndim > 1:
        x = x.mean(axis=1)  # モノラル化
    dur = len(x) / sr
    win = np.hanning(FRAME)
    bins, freqs = band_bins(sr, BAND_LO, BAND_HI)

    # 1kHz刻みの帯域内訳（spec の表と対応）
    subbands = [(15000, 16000), (16000, 17000), (17000, 18000), (18000, 19000)]
    sub_idx = [np.where((freqs >= a) & (freqs < b))[0] for a, b in subbands]

    band_db, sub_db, amp = [], [[] for _ in subbands], []
    for start in range(0, len(x) - FRAME, HOP):
        seg = x[start:start + FRAME]
        amp.append(np.sqrt(np.mean(seg ** 2)))  # RMS（無音検出用）
        mag2 = np.abs(np.fft.rfft(seg * win)) ** 2
        p = mag2[bins].sum()
        band_db.append(10 * np.log10(p + 1e-20))
        for k, idx in enumerate(sub_idx):
            sub_db[k].append(10 * np.log10(mag2[idx].sum() + 1e-20))

    band_db = np.array(band_db); amp = np.array(amp)
    t = np.arange(len(band_db)) * HOP / sr

    # 真の無音フレーム（振幅ほぼ0）
    silent = amp < 1e-5
    music = ~silent

    def pct(a, p):
        return float(np.percentile(a, p)) if len(a) else float("nan")

    print(f"\n===== {path.split('/')[-1]} =====")
    print(f"長さ {dur:.1f}s  サンプルレート {sr}Hz  フレーム {len(band_db)}")
    print(f"[検知帯域 16-18.2kHz エネルギー dB(相対)]")
    print(f"  音楽中: 中央値 {pct(band_db[music],50):6.1f}  5%点 {pct(band_db[music],5):6.1f}  最小 {band_db[music].min():6.1f}")
    print(f"  無音中: 中央値 {pct(band_db[silent],50):6.1f}  95%点 {pct(band_db[silent],95):6.1f}  最大 {band_db[silent].max() if silent.any() else float('nan'):6.1f}")
    gap = pct(band_db[music], 5) - (pct(band_db[silent], 95) if silent.any() else -200)
    print(f"  → 音楽の谷(5%点) と 無音の上端(95%点) の差 = {gap:.1f} dB（この差が大きいほど閾値が置きやすい）")

    print(f"[1kHz刻みの帯域内訳（音楽中の中央値 dB）]")
    for (a, b), s in zip(subbands, sub_db):
        s = np.array(s)
        print(f"  {a//1000}-{b//1000}kHz: {pct(s[music],50):6.1f}")

    # 無音区間（連続する silent フレームをまとめる）
    print(f"[無音区間]")
    runs = []
    i = 0
    while i < len(silent):
        if silent[i]:
            j = i
            while j < len(silent) and silent[j]:
                j += 1
            runs.append((t[i], (j - i) * HOP / sr))
            i = j
        else:
            i += 1
    for start, length in runs:
        if length > 0.3:
            m, s = divmod(start, 60)
            print(f"  {int(m)}:{s:05.2f}  長さ {length:.1f}s")

if __name__ == "__main__":
    for p in sys.argv[1:]:
        analyze(p)
