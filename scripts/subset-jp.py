"""Build the small Japanese font file for the vertical labels (<Tate text="..."> and AREA_JP).

Run after adding Japanese words:  python3 scripts/subset-jp.py
Needs fonttools + brotli (pip install fonttools brotli). The full font (15 MB) is downloaded once
from the Google Fonts repository into .cache/ and is not committed.
"""
import glob, os, re, subprocess, urllib.request

SRC_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/shipporiminchob1/ShipporiMinchoB1-ExtraBold.ttf'
CACHE = '.cache/ShipporiMinchoB1-ExtraBold.ttf'
OUT = 'public/fonts/shippori-mincho-b1-subset.woff2'

chars = set()
for path in glob.glob('src/**/*.astro', recursive=True) + glob.glob('src/**/*.ts', recursive=True):
    text = open(path, encoding='utf-8').read()
    for m in re.findall(r'<Tate[^>]*text="([^"]+)"', text) + re.findall(r"tate:\s*'([^']+)'", text):
        chars.update(m)
    if path.endswith('lib/tours.ts'):
        block = text.split('AREA_JP', 1)[1]
        chars.update(re.findall(r"[぀-ヿ一-鿿]", block))
chars = sorted(c for c in chars if not c.isascii())
print(len(chars), 'characters:', ''.join(chars))

if not os.path.exists(CACHE):
    os.makedirs('.cache', exist_ok=True)
    urllib.request.urlretrieve(SRC_URL, CACHE)
subprocess.run(['pyftsubset', CACHE, f'--text={"".join(chars)}', '--flavor=woff2', f'--output-file={OUT}', '--layout-features=vert,vrt2'], check=True)
print(OUT, os.path.getsize(OUT), 'bytes')
