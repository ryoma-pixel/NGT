// 1ファイル版を作る：Code.gs に設定の初期値（通知先など）を足して、貼り付け用の .gs を1つ出力する。
// 使い方：node ops/ngt-board/build.cjs [設定の初期値.json] > 出力先.gs
// 設定の初期値（アドレスなど）はリポジトリに入れないこと。
'use strict';
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
const overrides = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : {};
process.stdout.write([
  code.trimEnd(),
  '',
  '// ===== 1ファイル版：設定の初期値（build.cjs が追加）=====',
  'SETTING_OVERRIDES = ' + JSON.stringify(overrides, null, 2) + ';',
  ''
].join('\n'));
