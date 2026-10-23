"""Developer-only rasterizer for the extension's simple vector download icon."""
from pathlib import Path
import struct
import zlib
import math

ROOT=Path(__file__).resolve().parent/'assets'
ROOT.mkdir(exist_ok=True)
def distance(x,y,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)
def pixel(x,y):
    if math.hypot(max(.23-x,0,x-.77),max(.23-y,0,y-.77))>.21:
        return (0,0,0,0)
    if min(distance(x,y,a,b) for a,b in [((.5,.25),(.5,.73)),((.30,.54),(.5,.75)),((.5,.75),(.70,.54))])<.037:
        return (255,255,255,255)
    return (24,55,115,255)
def chunk(kind,data):
    return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
for size in [16,32,48,128]:
    raw=bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            samples=[pixel((x+(sx+.5)/4)/size,(y+(sy+.5)/4)/size) for sx in range(4) for sy in range(4)]
            alpha=sum(p[3] for p in samples)
            raw.extend([round(sum(p[c]*p[3] for p in samples)/alpha) if alpha else 0 for c in range(3)]+[round(alpha/16)])
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>2I5B',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
    (ROOT/f'icon-{size}.png').write_bytes(png)
