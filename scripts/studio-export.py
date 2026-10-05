"""
Package column articles for the current STUDIO site (owner request 2026-10-05: "次回からこの形式で").

  npm run build
  python3 scripts/studio-export.py <out-dir> <slug> [<slug> ...]

Writes <out-dir>/studio-export/ (STUDIO入稿シート.html + one JPG folder per article) and
<out-dir>/NGT_column_STUDIO_<MMDD>[-<MMDD>...].zip. The sheet has copy buttons for the CMS fields
and for the body as rich text. The body is read from dist/column/<slug>.html; tables become lists
(STUDIO's rich text may break them), images become red placeholders, the FAQ is appended and
links point to https://ninjagotours.com.
"""
import html
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮'
e = html.escape


def front_matter(slug):
    path = f'src/content/columns/{slug}.md'
    try:
        import yaml
        fm = yaml.safe_load(open(path).read().split('---')[1])
    except ImportError:  # no PyYAML: use js-yaml, which Astro already installs
        js = f"const y=require('js-yaml'),f=require('fs');console.log(JSON.stringify(y.load(f.readFileSync('{path}','utf8').split('---')[1],{{schema:y.JSON_SCHEMA}})))"
        fm = json.loads(subprocess.run(['node', '-e', js], check=True, capture_output=True, text=True).stdout)
    return dict(title=fm['title'], description=fm['description'], date=str(fm['publishedAt'])[:10],
                area=fm.get('area', ''), hero=fm['heroImage'],
                faq=[(x['q'], x['a']) for x in fm.get('faq') or []])


def to_jpg(src, dst):
    try:
        from PIL import Image
        Image.open('public' + src).convert('RGB').save(dst, 'JPEG', quality=88)
    except ImportError:  # no Pillow: use sharp, which Astro already installs
        subprocess.run(['node', '-e', f"require('sharp')('public{src}').jpeg({{quality:88}}).toFile('{dst}')"], check=True)


def table_to_list(m):
    t = m.group(0)
    heads = [re.sub('<.*?>', '', h).strip() for h in re.findall(r'<th[^>]*>(.*?)</th>', t, re.S)]
    items = []
    for row in re.findall(r'<tr>(.*?)</tr>', t, re.S):
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        if cells:
            rest = '／'.join(f'{heads[i]}: {c.strip()}' for i, c in enumerate(cells[1:], 1))
            items.append(f'<li><strong>{cells[0].strip()}</strong> — {rest}</li>')
    return '<ul>' + ''.join(items) + '</ul>'


def build(slug, out):
    d = front_matter(slug)
    os.makedirs(f'{out}/{slug}', exist_ok=True)
    s = open(f'dist/column/{slug}.html').read()
    i = s.find('>', s.find('<div class="prose"')) + 1
    body = s[i:s.find('</div>', i)]  # the Markdown body has no nested <div>
    body = re.sub(r' data-astro-cid-\w+', '', body)
    body = re.sub(r'<table>.*?</table>', table_to_list, body, flags=re.S)
    body = body.replace('href="/', 'href="https://ninjagotours.com/')
    cover = f'{slug}-00-cover.jpg'
    to_jpg(d['hero'], f'{out}/{slug}/{cover}')
    imgs = [dict(n='カバー', file=cover, alt='（カバー画像）')]

    def place(m):
        n = len(imgs)
        f = f'{slug}-{n:02d}.jpg'
        to_jpg(m.group(1), f'{out}/{slug}/{f}')
        imgs.append(dict(n=CIRC[n - 1], file=f, alt=html.unescape(m.group(2))))
        return f'</p><p class="ph">【画像{CIRC[n - 1]}をここに挿入：{f}】</p><p>'

    # Each image (also side-by-side pairs and images inside text) becomes its own placeholder line.
    body = re.sub(r'<img src="([^"]+)" alt="([^"]*)"[^>]*>', place, body)
    body = re.sub(r'<p>\s*</p>', '', body)
    if '<img' in body:
        sys.exit(f'{slug}: an image was not converted')
    if d['faq']:
        body += '<h2>FAQ</h2>' + ''.join(f'<h3>{e(q)}</h3><p>{e(a)}</p>' for q, a in d['faq'])
    return d, body, imgs


CSS = """
:root{--ink:#1f2d52;--bg:#f7f0e3;--line:#d9cfbd;--red:#d23d22}
body{margin:0;background:var(--bg);color:#222;font:15px/1.7 -apple-system,"Hiragino Sans",sans-serif}
main{max-width:900px;margin:auto;padding:24px 16px 80px}
h1{color:var(--ink);font-size:24px;margin:0 0 4px}.lead{color:#555}
nav a{display:block;color:var(--ink);margin:4px 0}
section{background:#fff;border:1px solid var(--line);border-radius:10px;padding:20px;margin:28px 0}
h2{color:var(--ink);font-size:19px;margin:0 0 12px}.num{background:var(--ink);color:#fff;border-radius:4px;padding:0 8px;margin-right:8px;font-size:14px}
h3{font-size:15px;color:var(--ink);border-bottom:2px solid var(--ink);padding-bottom:4px;margin:24px 0 10px}
table.f{width:100%;border-collapse:collapse}
table.f th{text-align:left;width:150px;font-weight:600;vertical-align:top;padding:8px 6px;border-bottom:1px solid var(--line);font-size:13px}
table.f td{padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}table.f small{display:block;color:#777}
button{font:inherit;font-size:12px;border:1px solid var(--ink);background:#fff;color:var(--ink);border-radius:6px;padding:3px 10px;cursor:pointer;white-space:nowrap}
button.ok{background:var(--ink);color:#fff}.cpb{font-size:14px;padding:6px 16px;background:var(--ink);color:#fff}
.hint{font-size:13px;color:#555}
.body{border:1px dashed var(--line);border-radius:8px;padding:8px 18px;margin-top:10px;max-height:520px;overflow:auto}
.body h2{font-size:18px;color:#111}.body h3{border:0;color:#111;margin:14px 0 4px}
.body .ph{color:var(--red);font-weight:700}.body a{color:#1a56c4}
ul.imgs{list-style:none;padding:0}ul.imgs li{display:flex;gap:12px;align-items:flex-start;margin:10px 0}
ul.imgs img{width:140px;border-radius:6px;flex:none}.alt{color:#555;font-size:13px}
code{background:#f1ece2;padding:1px 5px;border-radius:4px}
.note{background:#fff8e6;border:1px solid #ecd9a6;border-radius:8px;padding:10px 14px;font-size:13px}
@media(max-width:600px){table.f th{width:90px}ul.imgs img{width:96px}}
"""

JS = """
function flash(b){const t=b.textContent;b.textContent='コピーしました';b.classList.add('ok');setTimeout(()=>{b.textContent=t;b.classList.remove('ok')},1500)}
document.querySelectorAll('.cp').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.t)}catch(e){const r=document.createElement('textarea');r.value=b.dataset.t;document.body.append(r);r.select();document.execCommand('copy');r.remove()}flash(b)});
document.querySelectorAll('.cpb').forEach(b=>b.onclick=async()=>{const el=document.getElementById(b.dataset.b);
try{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([el.innerHTML],{type:'text/html'}),'text/plain':new Blob([el.innerText],{type:'text/plain'})})])}
catch(e){const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('copy');s.removeAllRanges()}flash(b)});
"""


def field(label, val, note=''):
    n = f'<small>{note}</small>' if note else ''
    return (f'<tr><th>{label}</th><td><span class="v">{e(val)}</span>{n}</td>'
            f'<td><button class="cp" data-t="{e(val)}">コピー</button></td></tr>')


def img_row(slug, i):
    cover = i['n'] == 'カバー'
    label = 'カバー' if cover else '画像' + i['n']
    btn = '' if cover else f' <button class="cp" data-t="{e(i["alt"])}">代替テキストをコピー</button>'
    return (f'<li><img src="{slug}/{i["file"]}" alt=""><div><b>{label}</b>　<code>{i["file"]}</code>'
            f'<br><span class="alt">{e(i["alt"])}</span>{btn}</div></li>')


def section(k, slug, m, body, imgs):
    rows = ''.join([
        field('タイトル', m['title']),
        field('スラッグ（URL）', slug, f'公開URL：/column/{slug}'),
        field('公開日', m['date'].replace('-', '/')),
        field('説明文（meta description）', m['description']),
        field('エリア', m['area']),
        field('カバー画像', imgs[0]['file'], 'フォルダ内のファイルをアップロード'),
    ])
    return f'''<section id="a{k}"><h2><span class="num">{k:02d}</span>{e(m["title"])}</h2>
<h3>1. CMSの入力欄</h3><table class="f">{rows}</table>
<h3>2. 本文（リッチテキスト欄に貼り付け）</h3>
<p class="hint">「本文をコピー」→ STUDIO の本文欄に貼り付け。見出し・太字・箇条書き・リンクがそのまま入ります。<br>赤い【画像○をここに挿入】の行を、下の画像に差し替えてから行ごと削除してください。</p>
<button class="cpb" data-b="b{k}">本文をコピー</button>
<div class="body" id="b{k}">{body}</div>
<h3>3. 画像（{len(imgs)}枚）</h3><ul class="imgs">{"".join(img_row(slug, i) for i in imgs)}</ul></section>'''


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    base, slugs = sys.argv[1], sys.argv[2:]
    out = os.path.join(base, 'studio-export')
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    secs, nav, dates = [], [], []
    for k, slug in enumerate(slugs, 1):
        m, body, imgs = build(slug, out)
        secs.append(section(k, slug, m, body, imgs))
        nav.append(f'<a href="#a{k}">{k}. {e(m["title"])}</a>')
        dates.append(m['date'])
    page = f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>STUDIO入稿シート</title>
<style>{CSS}</style></head><body><main>
<h1>STUDIO入稿シート：コラム{len(slugs)}本</h1><p class="lead">NINJA GO TOURS／Column（{"・".join(x.replace("-", "/") for x in dates)}）</p>
<nav>{"".join(nav)}</nav>
<div class="note">・画像はこのファイルと同じフォルダ（記事のスラッグ名）に入っています。<br>・本文の表は STUDIO の本文欄で崩れる可能性があるため、箇条書きに変換済みです。<br>・リンクは <code>https://ninjagotours.com/…</code>（STUDIO の現行サイトと同じURL）にしています。<br>・FAQは本文の最後に見出しとして入れています。</div>
{"".join(secs)}
</main><script>{JS}</script></body></html>'''
    open(os.path.join(out, 'STUDIO入稿シート.html'), 'w').write(page)
    tag = '-'.join(x[5:].replace('-', '') for x in dates)
    zp = os.path.join(base, f'NGT_column_STUDIO_{tag}.zip')
    with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(out):
            for f in files:
                p = os.path.join(root, f)
                z.write(p, os.path.relpath(p, base))
    print(zp)


if __name__ == '__main__':
    main()
