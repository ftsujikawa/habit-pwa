"""アプリのアイコン(緑の背景に白いチェックマーク)を PNG で作る。標準ライブラリだけを使う。

使い方: python3 tools/make-icons.py
"""
import math
import struct
import zlib
from pathlib import Path

BG = (47, 125, 79)
FG = (255, 255, 255)
# チェックマークの折れ線(0〜1 の相対座標)。maskable の安全領域(中央80%)に収める。
POINTS = [(0.30, 0.52), (0.44, 0.66), (0.71, 0.38)]
STROKE = 0.075  # 線の太さの半分


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def make_png(size):
    pts = [(x * size, y * size) for x, y in POINTS]
    half = STROKE * size
    rows = []
    for y in range(size):
        row = bytearray([0])  # フィルタ種別: なし
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            d = min(seg_dist(px, py, *pts[i], *pts[i + 1]) for i in range(len(pts) - 1))
            a = max(0.0, min(1.0, half - d + 0.5))  # 縁をなめらかにする
            row += bytes(round(b + (f - b) * a) for b, f in zip(BG, FG))
        rows.append(bytes(row))

    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)  # 8bit RGB
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))


def main():
    out = Path(__file__).resolve().parent.parent / 'icons'
    out.mkdir(exist_ok=True)
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
        (out / name).write_bytes(make_png(size))
        print(f'{name} ({size}x{size})')


if __name__ == '__main__':
    main()
