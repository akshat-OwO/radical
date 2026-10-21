"""Regenerate the example's small PNG identity assets with Python's standard library."""

import struct
import zlib
from pathlib import Path


def png(size, mark_size, background):
    points = [(0.05, 0.52), (0.19, 0.43), (0.35, 0.69),
              (0.57, 0.15), (0.95, 0.15), (0.95, 0.29),
              (0.67, 0.29), (0.40, 0.91), (0.30, 0.91), (0.15, 0.62)]
    offset = (size - mark_size) / 2
    points = [(offset + x * mark_size, offset + y * mark_size) for x, y in points]
    rows = []
    for y in range(size):
        row = bytearray(background * size)
        if offset <= y <= offset + mark_size:
            crossings = []
            for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]):
                if (y1 > y) != (y2 > y):
                    crossings.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
            crossings.sort()
            for start, end in zip(crossings[::2], crossings[1::2]):
                for x in range(max(0, int(start)), min(size, int(end))):
                    row[x * 4:x * 4 + 4] = bytes([255, 255, 255, 255])
        rows.append(b'\0' + row)

    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))


root = Path(__file__).parent
(root / 'icon.png').write_bytes(png(1024, 700, bytes([0, 0, 0, 0])))
(root / 'splash.png').write_bytes(png(2732, 500, bytes([0, 0, 0, 0])))
