#!/usr/bin/env python3
"""Build the data for the home page map of Tokyo (TokyoMap.astro): the 23 wards and the JR Yamanote Line.

Source of the ward shapes: Global Map Japan (GSI), via github.com/dataofjapan/land (tokyo.geojson).
Usage: python3 scripts/make-tokyo-map.py <tokyo.geojson>  -> writes src/data/tokyo-map.json
Station positions are approximate (for an illustrated map, not for navigation).
"""
import json, math, sys
from pathlib import Path

W = 1000  # map width in SVG units
LAT0 = 35.68
KX = math.cos(math.radians(LAT0))

g = json.load(open(sys.argv[1]))
wards = [f for f in g['features'] if f['properties'].get('area_ja') == '都区部']
assert len(wards) == 23, len(wards)

def rings(f):
    geom = f['geometry']
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    return [p[0] for p in polys]

lons = [c[0] for f in wards for r in rings(f) for c in r]
lats = [c[1] for f in wards for r in rings(f) for c in r]
x0, x1, y0, y1 = min(lons), max(lons), min(lats), max(lats)
s = W / ((x1 - x0) * KX)
H = round((y1 - y0) * s)
PAD = 30
def P(lon, lat): return ((lon - x0) * KX * s + PAD, (y1 - lat) * s + PAD)

def simplify(pts, eps):
    if len(pts) < 3: return pts
    (ax, ay), (bx, by) = pts[0], pts[-1]
    dx, dy = bx - ax, by - ay
    L = math.hypot(dx, dy) or 1e-9
    i, dmax = 0, 0
    for k in range(1, len(pts) - 1):
        px, py = pts[k]
        d = abs(dy * px - dx * py + bx * ay - by * ax) / L
        if d > dmax: i, dmax = k, d
    if dmax > eps:
        return simplify(pts[:i + 1], eps)[:-1] + simplify(pts[i:], eps)
    return [pts[0], pts[-1]]

def area(pts):
    return 0.5 * sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))

out = []
for f in wards:
    d, big, best = [], None, 0
    for r in rings(f):
        pts = [P(*c[:2]) for c in r]
        a = abs(area(pts))
        if a < 30: continue  # tiny islets
        m = len(pts) // 2  # closed ring: simplify the two halves so the ends don't collapse
        sp = simplify(pts[:m + 1], 0.9)[:-1] + simplify(pts[m:], 0.9)
        d.append('M' + ' L'.join(f'{x:.1f} {y:.1f}' for x, y in sp) + 'Z')
        if a > best: best, big = a, pts
    cx = sum(p[0] for p in big) / len(big); cy = sum(p[1] for p in big) / len(big)
    en = f['properties']['ward_en'].replace(' Ku', '')
    out.append({'id': en.lower(), 'en': en, 'ja': f['properties']['ward_ja'], 'd': ' '.join(d), 'x': round(cx, 1), 'y': round(cy, 1)})

# JR Yamanote Line, clockwise from Tokyo (approximate station positions)
YAMANOTE = [
    ('Tokyo', 35.6812, 139.7671), ('Kanda', 35.6918, 139.7709), ('Akihabara', 35.6984, 139.7731), ('Okachimachi', 35.7075, 139.7748),
    ('Ueno', 35.7138, 139.7773), ('Uguisudani', 35.7206, 139.7780), ('Nippori', 35.7278, 139.7707), ('Nishi-Nippori', 35.7320, 139.7668),
    ('Tabata', 35.7381, 139.7608), ('Komagome', 35.7365, 139.7470), ('Sugamo', 35.7334, 139.7394), ('Otsuka', 35.7318, 139.7286),
    ('Ikebukuro', 35.7295, 139.7109), ('Mejiro', 35.7212, 139.7066), ('Takadanobaba', 35.7126, 139.7038), ('Shin-Okubo', 35.7012, 139.7000),
    ('Shinjuku', 35.6896, 139.7006), ('Yoyogi', 35.6831, 139.7020), ('Harajuku', 35.6702, 139.7027), ('Shibuya', 35.6580, 139.7016),
    ('Ebisu', 35.6467, 139.7101), ('Meguro', 35.6339, 139.7157), ('Gotanda', 35.6262, 139.7236), ('Osaki', 35.6197, 139.7286),
    ('Shinagawa', 35.6285, 139.7388), ('Takanawa Gateway', 35.6355, 139.7406), ('Tamachi', 35.6457, 139.7475), ('Hamamatsucho', 35.6553, 139.7571),
    ('Shimbashi', 35.6663, 139.7583), ('Yurakucho', 35.6751, 139.7630),
]
MAJOR = {'Tokyo', 'Ueno', 'Ikebukuro', 'Shinjuku', 'Shibuya', 'Shinagawa', 'Akihabara', 'Harajuku'}
stations = [{'name': n, 'x': round(P(lon, lat)[0], 1), 'y': round(P(lon, lat)[1], 1), 'major': n in MAJOR} for n, lat, lon in YAMANOTE]

# Tour areas: where the walks start (approximate)
AREAS = [
    {'id': 'Shinjuku', 'ja': '新宿', 'lat': 35.6935, 'lon': 139.7030},
    {'id': 'Ueno', 'ja': '上野', 'lat': 35.7105, 'lon': 139.7745},
    {'id': 'Asakusa', 'ja': '浅草', 'lat': 35.7128, 'lon': 139.7925},
]
for a in AREAS:
    a['x'], a['y'] = (round(v, 1) for v in P(a.pop('lon'), a.pop('lat')))

data = {'width': W + 2 * PAD, 'height': H + 2 * PAD, 'wards': out, 'yamanote': stations, 'areas': AREAS,
        'km': round(s / 110.574, 2), 'source': 'Ward shapes: Global Map Japan (GSI). Stations approximate.'}
dst = Path(__file__).resolve().parent.parent / 'src/data/tokyo-map.json'
dst.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
print(dst, round(dst.stat().st_size / 1024, 1), 'KB', data['width'], data['height'])
