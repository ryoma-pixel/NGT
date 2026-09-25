#!/usr/bin/env python3
"""Make the quiz character portraits (Portrait.astro) from a source illustration.

Usage: python3 scripts/make-character.py <lord|ninja> <source image> [left top right bottom] [--flip]
The optional crop box is in fractions of the source (default: the whole image), trimmed to 4:5 around its centre.
--flip mirrors the picture so the character faces their speech bubble (the Ninja stands to the right of his).
Writes public/images/characters/<who>-240.webp and -480.webp.
"""
import sys
from pathlib import Path
from PIL import Image

flip = '--flip' in sys.argv
args = [a for a in sys.argv[1:] if a != '--flip']
who, src = args[0], args[1]
box = [float(v) for v in args[2:6]] if len(args) >= 6 else [0, 0, 1, 1]
im = Image.open(src).convert('RGB')
W, H = im.size
l, t, r, b = box[0] * W, box[1] * H, box[2] * W, box[3] * H
# trim to 4:5 (w:h) around the centre of the box
w, h = r - l, b - t
if w / h > 0.8:
    nw = h * 0.8; l += (w - nw) / 2; r = l + nw
else:
    nh = w / 0.8; t += (h - nh) / 2; b = t + nh
crop = im.crop((round(l), round(t), round(r), round(b)))
if flip:
    crop = crop.transpose(Image.FLIP_LEFT_RIGHT)
out = Path(__file__).resolve().parent.parent / 'public/images/characters'
out.mkdir(parents=True, exist_ok=True)
for width in (240, 480):
    crop.resize((width, width * 5 // 4), Image.LANCZOS).save(out / f'{who}-{width}.webp', 'WEBP', quality=82, method=6)
    print(out / f'{who}-{width}.webp')
