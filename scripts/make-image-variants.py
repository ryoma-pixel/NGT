"""Create smaller copies of large WebP images (name-640.webp, name-1024.webp, name-1600.webp) for srcset.

Run after adding photos:  python3 scripts/make-image-variants.py
"""
import glob, os, re
from PIL import Image

WIDTHS = (640, 1024, 1600)
for path in glob.glob('public/images/**/*.webp', recursive=True):
    if re.search(r'-(640|1024|1600)\.webp$', path) or '/characters/' in path:  # quiz figures have their own sizes (make-character.py)
        continue
    im = Image.open(path)
    for w in WIDTHS:
        out = path[:-5] + f'-{w}.webp'
        if im.width <= w * 1.15 or os.path.exists(out):
            continue
        im.convert('RGB').resize((w, round(im.height * w / im.width)), Image.LANCZOS).save(out, 'WEBP', quality=74, method=6)
        print(out)
