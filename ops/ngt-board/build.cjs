// 1ファイル版を作る：Code.gs と Index.html（と、あれば設定の初期値）を1つの .gs にまとめる。
// 使い方：node ops/ngt-board/build.cjs [設定の初期値.json] > 出力先.gs
// 設定の初期値（宛先など）はリポジトリに入れないこと。
'use strict';
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const code = fs.readFileSync(path.join(dir, 'Code.gs'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'Index.html'), 'utf8');
const overrides = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : {};
const out = [
  code.trimEnd(),
  '',
  '// ===== 1ファイル版：画面の HTML と設定の初期値（build.cjs が追加）=====',
  'INDEX_HTML = ' + JSON.stringify(html) + ';',
  'SETTING_OVERRIDES = ' + JSON.stringify(overrides, null, 2) + ';',
  ''
].join('\n');
process.stdout.write(out);
