"""Build a tiny Japanese subset of Dela Gothic One containing only the characters used on the site.

Run after adding Japanese text that should appear in the display font:
    python3 scripts/subset-font.py
Characters not in the subset fall back to the system Japanese font, so nothing breaks.
"""
import glob, re, shutil, subprocess

SRC = 'node_modules/@fontsource/dela-gothic-one/files/'
chars = set()
for path in glob.glob('src/**/*.*', recursive=True):
    if path.endswith(('.astro', '.md', '.json', '.ts')):
        chars |= set(re.findall(r'[　-ヿ㐀-鿿＀-￯]', open(path, encoding='utf-8').read()))
text = ''.join(sorted(chars))
open('scripts/font-subset-chars.txt', 'w', encoding='utf-8').write(text)
subprocess.run(['pyftsubset', SRC + 'dela-gothic-one-japanese-400-normal.woff2', f'--text={text}',
                '--flavor=woff2', '--output-file=public/fonts/dela-gothic-one-jp-subset.woff2', '--layout-features=*'], check=True)
shutil.copy(SRC + 'dela-gothic-one-latin-400-normal.woff2', 'public/fonts/dela-gothic-one-latin.woff2')
print(len(text), 'Japanese characters')
