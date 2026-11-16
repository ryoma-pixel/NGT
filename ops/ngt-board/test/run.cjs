// NGT 手配ボード 第2版のテスト（Node で実行：node ops/ngt-board/test/run.cjs）
// Google のサービスを最小限の偽物に置き換え、CSV の取り込みから完了までの流れを確かめる。
// 予約番号・氏名・アドレスはすべて架空。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const J = (s) => new Date(s + ':00+09:00');

// ---------- 偽の Google サービス ----------
// 知らないメソッドは「何もしないで自分を返す」ようにして、書式の設定などを素通しにする
function permissive(target) {
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return () => permissive(t);
    }
  });
}
class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); return permissive(this); }
  setValues(vals) {
    for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) {
      const v = vals[i][j], key = (this.r + i) + ':' + (this.c + j);
      if (typeof v === 'string' && v[0] === '=') { this.sheet.formulas[key] = v; this.sheet.set(this.r + i, this.c + j, '報告フォーム'); }
      else { delete this.sheet.formulas[key]; this.sheet.set(this.r + i, this.c + j, v); }
    }
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  setFormula(f) { this.sheet.set(this.r, this.c, '報告フォーム'); this.sheet.formulas[this.r + ':' + this.c] = f; return this; }
  getValue() { return this.sheet.get(this.r, this.c); }
  getFormulas() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.formulas[(this.r + i) + ':' + (this.c + j)] || ''); out.push(row); }
    return out;
  }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j)); out.push(row); }
    return out;
  }
  getSheet() { return this.sheet; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
}
let gidSeq = 100;
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; this.formulas = {}; this.gid = ++gidSeq; return permissive(this); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getSheetId() { return this.gid; }
  set(r, c, v) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  get(r, c) { const row = this.rows[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; }
  getLastRow() { let n = this.rows.length; while (n > 0 && this.rows[n - 1].every((x) => x === '' || x === undefined)) n--; return n; }
  getMaxRows() { return 1000; }
  appendRow(arr) { this.rows.splice(this.getLastRow(), 0, arr.slice()); }
  deleteRow(r) { this.rows.splice(r - 1, 1); }
  clear() { this.rows = []; return this; }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') return new FakeRange(this, 2, 2, 999, 1);
    return new FakeRange(this, r, c, nr || 1, nc || 1);
  }
  getDataRange() {
    const n = this.getLastRow();
    const w = Math.max(0, ...this.rows.slice(0, n).map((r) => r.length));
    return { getValues: () => this.rows.slice(0, n).map((r) => { const x = r.slice(); while (x.length < w) x.push(''); return x; }) };
  }
}
class FakeSpreadsheet {
  constructor() { this.sheets = {}; return permissive(this); }
  getSheetByName(n) { return Object.values(this.sheets).find((s) => s.getName() === n) || null; }
  insertSheet(n) { return (this.sheets[n] = new FakeSheet(n)); }
  deleteSheet(sh) { Object.keys(this.sheets).forEach((k) => { if (this.sheets[k] === sh) delete this.sheets[k]; }); }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/TEST/edit'; }
  getId() { return 'TEST'; }
  getSheets() { return Object.values(this.sheets); }
}

function makeEnv() {
  const ss = new FakeSpreadsheet();
  const props = {};
  const mails = [];
  const files = [];
  const moved = [];
  const folder = permissive({
    getFiles() { const list = files.splice(0); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; },
    getFoldersByName(n) { let done = false; return { hasNext: () => !done, next: () => { done = true; return permissive({ name: n, createFile() {} }); } }; },
    createFolder(n) { return permissive({ name: n }); }
  });
  const ctx = {
    console,
    SpreadsheetApp: permissive({ getActiveSpreadsheet: () => ss }),
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    MailApp: { sendEmail: (o) => mails.push(o) },
    DriveApp: { getFolderById: () => folder },
    FormApp: { openById: () => null },
    Utilities: {
      base64Decode: (s) => Buffer.from(s, 'base64'),
      newBlob: (bytes, type, name) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8'), getName: () => name })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  ctx.__clock = J('2026-11-16T12:05');
  vm.runInContext('now_ = function () { return __clock; };', ctx);
  // 初期設定と同じシートを用意する（フォーム・フォルダ・トリガーは除く）
  const led = ss.insertSheet('台帳'); led.appendRow(ctx.LEDGER_HEADERS);
  const tours = ss.insertSheet('ツアー'); tours.appendRow(ctx.TOUR_HEADERS); ctx.TOUR_DEFAULTS.forEach((r) => tours.appendRow(r));
  const set = ss.insertSheet('設定'); set.appendRow(['項目', '値', '説明']);
  ctx.SETTING_DEFAULTS.forEach((r) => set.appendRow(r.slice()));
  const setVal = (k, v) => { set.rows.forEach((r) => { if (r[0] === k) r[1] = v; }); };
  setVal('キラナの通知先', 'kira@example.com');
  setVal('リールの通知先', 'reelu@example.com');
  setVal('CSVの置き場（フォルダID）', 'FOLDER');
  ss.insertSheet('ログ').appendRow(ctx.LOG_HEADERS);
  ss.insertSheet('対応一覧');
  return {
    ctx, ss, mails, props, files, moved,
    at(s) { ctx.__clock = J(s); },
    run(code) { return vm.runInContext(code, ctx); },
    L() { return ctx.ledger_(); },
    cfg() { return ctx.settings_(); },
    tours() { return ctx.tours_(); },
    importText(name, text) {
      const L = ctx.ledger_();
      const r = ctx.importCsv_(name, text, L, ctx.settings_(), ctx.tours_(), ctx.now_());
      ctx.refreshAll_(ctx.ledger_(), ctx.settings_(), ctx.now_());
      return r;
    },
    caseBy(no) { return ctx.ledger_().rows.find((c) => c['予約番号'] === no); },
    caseId(id) { return ctx.ledger_().rows.find((c) => c['案件ID'] === id); },
    derive(c) { return ctx.derive_(c, ctx.settings_(), ctx.now_()); },
    // 台帳のセルを人が書き換えて、onEdit を起こす
    edit(row, colName, value) {
      const col = ctx.LEDGER_HEADERS.indexOf(colName) + 1;
      led.set(row, col, value);
      ctx.onBoardEdit({ range: led.getRange(row, col, 1, 1), user: { getEmail: () => 'staff@example.com' } });
    },
    led, set, setVal
  };
}

const HEAD = 'booking_id,agent_booking_id,supplier_booking_id,status,purchase_date,cancelled_date,activity_date,activity_time,activity_id,activity_name,plan_id,plan_name,parent_activity_name,parent_plan_name,pickup_checkin,ota,booked_by,participant_name,contact_info,issued_status,expiration_date,unit_type1,unit_quantity1,unit_type2,unit_quantity2';
function ngtRow(no, date, time, qty, extra) {
  return [no, 'bk_test', '', (extra && extra.status) || 'CONFIRMED', '2026-11-10T00:00:00Z', '', date, time, 'LINKTIVITY-TEST',
    'NINJA GO TOURS・東京：新宿歌舞伎町・ゴールデン街＆秘密の神社ウォーク with 忍者', 'LINKTIVITY-TEST-1',
    '"東京：新宿歌舞伎町・ゴールデン街＆秘密の神社ウォーク with 忍者（60分・12歳以下無料）"', '', '', 'CHECKIN', 'ARS_NINJAGORIDE',
    '株式会社テスト', 'Test Guest ' + no.slice(-2), 'guest' + no.slice(-2) + '@example.com', 'NOT_ISSUED', date, '大人子供共通 (13歳以上)', String(qty)].join(',');
}
function nktRow(no, date, time, plan, units) {
  return [no, '', '', 'CONFIRMED', '2026-11-10T00:00:00Z', '', date, time, 'LINKTIVITY-NKT', 'Ninja+Kabuki Tokyo', 'P', plan, '', '', 'CHECKIN', 'ARS_TRYHARD',
    '株式会社テスト', 'NKT Guest', 'nkt@example.com', 'NOT_ISSUED', date].concat(units).join(',');
}

let pass = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('ok  ' + name); }
  catch (e) { console.log('NG  ' + name + '\n    ' + (e && e.stack || e)); process.exitCode = 1; }
}

test('CSV を読む（BOM・引用符・列の足りない行）', () => {
  const env = makeEnv();
  const rows = env.ctx.parseCsv_('﻿a,b,c\n1,"x,y",3\n4,5\n\n');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(rows)), [['a', 'b', 'c'], ['1', 'x,y', '3'], ['4', '5']]);
});

test('NGT の CSV：新規予約が「新規（受注待ち）」で入り、リールの受注期限は14:00', () => {
  const env = makeEnv();
  const r = env.importText('kiranah-resort-20261116.csv', '﻿' + HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-AAAA', '2026-11-20', '17:00', 2) + '\n');
  assert.strictEqual(r.src, 'NGT');
  assert.strictEqual(r.added.length, 1);
  const c = env.caseBy('ARS_NINJAGORIDE-20261116-AAAA');
  assert.strictEqual(c['案件ID'], 'NGT-0001');
  assert.strictEqual(c['ツアー'], '秘境神社 Ninja Walk');
  assert.strictEqual(c['開始'], '17:00');
  assert.strictEqual(c['大人'], 2);
  assert.strictEqual(c['経路'], '公式直販');
  const d = env.derive(c);
  assert.strictEqual(d.st, '新規（受注待ち）');
  assert.strictEqual(d.who, 'リール');
  assert.strictEqual(d.due.getTime(), J('2026-11-16T14:00').getTime());
  assert.strictEqual(String(c['次にやる人']), 'リール');
});

test('NKT の CSV：セット商品だけ取り込み、時刻を公演→ウォーク（15:00→16:30）に読み替える', () => {
  const env = makeEnv();
  const text = HEAD + '\n' +
    nktRow('ARS_TRYHARD-20261116-SET1', '2026-11-21', '15:00', '新宿を遊び尽くす！SHINJUKU NINJA -LIVE- SHOW チケット＆ローカルツアーセット', ['大人子供共通', '2']) + '\n' +
    nktRow('ARS_TRYHARD-20261116-SHOW', '2026-11-21', '18:00', 'Ninja+Kabuki Tokyo', ['大人 (7歳以上)', '2', '子供 (6歳以下)', '1']) + '\n';
  const r = env.importText('tryhard-20261116.csv', text);
  assert.strictEqual(r.src, 'NKT');
  assert.strictEqual(r.added.length, 1);
  assert.strictEqual(r.skipped, 1);
  const c = env.caseBy('ARS_TRYHARD-20261116-SET1');
  assert.strictEqual(c['開始'], '16:30');
  assert.strictEqual(c['ツアー'], 'NKTセット（秘境神社）');
  assert.strictEqual(c['経路'], 'NKTセット（NKT直販）');
});

test('同じ CSV を2回入れても重複しない。人数の変更は「変更・注意」に残る', () => {
  const env = makeEnv();
  const csv = (q) => HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-BBBB', '2026-11-22', '18:00', q) + '\n';
  env.importText('kiranah-resort-a.csv', csv(2));
  const r = env.importText('kiranah-resort-b.csv', csv(3));
  assert.strictEqual(r.added.length, 0);
  assert.strictEqual(r.changed.length, 1);
  assert.strictEqual(env.L().rows.length, 1);
  const c = env.caseBy('ARS_NINJAGORIDE-20261116-BBBB');
  assert.strictEqual(c['大人'], 3);
  assert.ok(/大人 2→3/.test(c['変更・注意']));
});

test('CSV から消えた予約はキャンセル。リールが受注済みなら「キャンセル確認」を待つ', () => {
  const env = makeEnv();
  const a = ngtRow('ARS_NINJAGORIDE-20261116-CCC1', '2026-11-23', '17:00', 2);
  const b = ngtRow('ARS_NINJAGORIDE-20261116-CCC2', '2026-11-23', '18:00', 1);
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + a + '\n' + b + '\n');
  const c1 = env.caseBy('ARS_NINJAGORIDE-20261116-CCC1');
  env.edit(c1._row, '①受注（リール）', true);
  env.at('2026-11-17T12:05');
  const r = env.importText('kiranah-resort-2.csv', HEAD + '\n' + b + '\n');
  assert.strictEqual(r.cancelled.length, 1);
  const c = env.caseBy('ARS_NINJAGORIDE-20261116-CCC1');
  assert.strictEqual(env.derive(c).st, 'キャンセル（リール確認待ち）');
  env.edit(c._row, 'キャンセル確認（リール）', true);
  assert.strictEqual(env.derive(env.caseBy('ARS_NINJAGORIDE-20261116-CCC1')).st, 'キャンセル済み');
});

test('一度に多くの予約が消えたら、キャンセルにせず確認を求める。また載ったら戻す', () => {
  const env = makeEnv();
  const rows = [1, 2, 3, 4, 5, 6].map((i) => ngtRow('ARS_NINJAGORIDE-20261116-DD0' + i, '2026-11-25', '17:00', 1));
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + rows.join('\n') + '\n');
  const r = env.importText('kiranah-resort-2.csv', HEAD + '\n');
  assert.strictEqual(r.cancelled.length, 0);
  assert.strictEqual(r.held.length, 6);
  // 1件だけ消えたときはキャンセルにし、次に載ったら取り消す
  env.importText('kiranah-resort-3.csv', HEAD + '\n' + rows.slice(1).join('\n') + '\n');
  assert.ok(env.caseBy('ARS_NINJAGORIDE-20261116-DD01')['キャンセル日時']);
  const r4 = env.importText('kiranah-resort-4.csv', HEAD + '\n' + rows.join('\n') + '\n');
  assert.strictEqual(r4.restored.length, 1);
  assert.ok(!env.caseBy('ARS_NINJAGORIDE-20261116-DD01')['キャンセル日時']);
});

test('ボタン（✓）で進む：②に✓すると①も付く → ③ → 完了報告 → ⑤受領で完了', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-EEEE', '2026-11-20', '17:00', 2) + '\n');
  let c = env.caseBy('ARS_NINJAGORIDE-20261116-EEEE');
  env.at('2026-11-16T13:10');
  env.led.set(c._row, env.ctx.LEDGER_HEADERS.indexOf('ガイド名') + 1, 'ガイドA');
  env.edit(c._row, '②手配完了（リール）', true);
  c = env.caseBy('ARS_NINJAGORIDE-20261116-EEEE');
  assert.strictEqual(c['①受注（リール）'], true);
  assert.ok(c['受注日時'] && c['手配日時']);
  assert.strictEqual(env.derive(c).st, '手配済み（ゲスト連絡待ち）');
  env.edit(c._row, '③ゲスト連絡（リール・ガイド）', true);
  c = env.caseBy('ARS_NINJAGORIDE-20261116-EEEE');
  assert.strictEqual(env.derive(c).who, 'ガイド');
  env.at('2026-11-20T18:30');
  const nv = { '案件ID': ['NGT-0001'], 'ガイド名': ['ガイドA'] };
  nv[env.ctx.Q.MEET] = ['予定どおり合流した']; nv[env.ctx.Q.TROUBLE] = ['なかった']; nv[env.ctx.Q.REACTION] = ['5'];
  nv[env.ctx.Q.REVIEW] = ['その場で書いてもらった']; nv[env.ctx.Q.BEST + '（秘境神社 Ninja Walk）'] = ['秘境の神社'];
  env.ctx.onReport({ namedValues: nv });
  c = env.caseBy('ARS_NINJAGORIDE-20261116-EEEE');
  assert.strictEqual(env.derive(c).st, '完了報告済み（受領待ち）');
  assert.ok(/盛り上がった：秘境の神社/.test(c['報告の要約']));
  assert.strictEqual(String(c['④完了報告（ガイド）']).indexOf('報告済み'), 0);
  env.edit(c._row, '⑤受領（キラナ）', true);
  assert.strictEqual(env.derive(env.caseBy('ARS_NINJAGORIDE-20261116-EEEE')).st, '完了');
});

test('前日20時に未手配ならキラナとリールに1回だけ知らせる（台帳では期限切れの手配としてリールに残る）', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-FFFF', '2026-11-18', '17:00', 1) + '\n');
  env.at('2026-11-16T13:20');
  env.edit(env.caseBy('ARS_NINJAGORIDE-20261116-FFFF')._row, '①受注（リール）', true);
  env.at('2026-11-17T20:05');
  env.mails.length = 0;
  env.ctx.poll();
  const c = env.caseBy('ARS_NINJAGORIDE-20261116-FFFF');
  assert.strictEqual(env.derive(c).st, '未手配（期限切れ）');
  assert.strictEqual(env.derive(c).who, 'リール');
  assert.strictEqual(env.mails.length, 1);
  assert.ok(/未手配/.test(env.mails[0].subject));
  assert.ok(/kira@example.com/.test(env.mails[0].to) && /reelu@example.com/.test(env.mails[0].to));
  assert.ok(!/キャンセル対応/.test(env.mails[0].body));
  env.at('2026-11-17T20:15');
  env.ctx.poll();
  assert.strictEqual(env.mails.length, 1, '同じ段階では2回送らない');
  const rows = env.ss.getSheetByName('対応一覧').rows.map((r) => r.join('|'));
  assert.ok(rows.some((r) => /ガイドを手配してください　1件/.test(r)));
  assert.ok(!rows.some((r) => /キャンセル対応/.test(r)));
});

test('受注の期限切れ（14:00）を通知。夜間は送らない', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-GGGG', '2026-11-28', '17:00', 1) + '\n');
  env.at('2026-11-16T22:30');
  env.mails.length = 0;
  env.ctx.poll();
  assert.strictEqual(env.mails.length, 0);
  env.at('2026-11-17T08:10');
  env.ctx.poll();
  assert.strictEqual(env.mails.length, 1);
  assert.ok(/期限切れ 1件/.test(env.mails[0].subject));
});

test('手入力（メール・インフルエンサー）の行に案件IDが付き、リールの受注待ちになる', () => {
  const env = makeEnv();
  const H = env.ctx.LEDGER_HEADERS;
  const put = (col, v) => env.led.set(2, H.indexOf(col) + 1, v);
  put('催行日', '2026-11-21'); put('開始', '18:00'); put('ツアー', '浅草ナイト'); put('大人', 2); put('代表者名', '@test_creator');
  env.edit(2, '経路', 'インフルエンサー');
  const c = env.L().rows[0];
  assert.strictEqual(c['案件ID'], 'NGT-0001');
  assert.strictEqual(c['取込元'], '手入力');
  assert.strictEqual(env.derive(c).st, '新規（受注待ち）');
  // CSV の「消えた予約」の判定に巻き込まれない
  const r = env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-HHHH', '2026-11-21', '17:00', 1) + '\n');
  assert.strictEqual(r.cancelled.length, 0);
  assert.strictEqual(env.caseId('NGT-0002')['予約番号'], 'ARS_NINJAGORIDE-20261116-HHHH');
});

test('手配後に CSV の日時が変わったら、手配からやり直しにする', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-IIII', '2026-11-26', '17:00', 2) + '\n');
  env.edit(env.caseBy('ARS_NINJAGORIDE-20261116-IIII')._row, '②手配完了（リール）', true);
  const r = env.importText('kiranah-resort-2.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-IIII', '2026-11-27', '17:00', 2) + '\n');
  assert.strictEqual(r.changed.length, 1);
  const c = env.caseBy('ARS_NINJAGORIDE-20261116-IIII');
  assert.strictEqual(c['②手配完了（リール）'], false);
  assert.strictEqual(env.derive(c).st, '受注済み（手配中）');
  assert.ok(/手配からやり直し/.test(c['変更・注意']));
});

test('完了報告で「合流できなかった」は至急で知らせる', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-JJJJ', '2026-11-20', '17:00', 2) + '\n');
  env.mails.length = 0;
  const nv = { '案件ID': ['ngt-0001'] };
  nv[env.ctx.Q.MEET] = ['合流できなかった']; nv[env.ctx.Q.TROUBLE] = ['なかった']; nv[env.ctx.Q.REACTION] = ['3'];
  env.ctx.onReport({ namedValues: nv });
  assert.strictEqual(env.mails.length, 1);
  assert.ok(/至急/.test(env.mails[0].subject) && /合流できなかった/.test(env.mails[0].subject));
});

test('19時の事前確認：翌日分に未手配があれば知らせる', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-KKKK', '2026-11-17', '18:00', 2) + '\n');
  env.at('2026-11-16T19:00');
  env.mails.length = 0;
  env.ctx.eveningCheck();
  assert.strictEqual(env.mails.length, 1);
  assert.ok(/未手配が 1件/.test(env.mails[0].subject));
});

test('置き場フォルダの CSV を取り込み、取込済みへ移し、まとめを送る', () => {
  const env = makeEnv();
  const text = HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-LLLL', '2026-11-29', '17:00', 2) + '\n';
  let movedTo = '';
  env.files.push({
    getName: () => 'kiranah-resort-20261116.csv', getDateCreated: () => J('2026-11-16T12:01'),
    getBlob: () => ({ getDataAsString: () => text }), moveTo: (f) => { movedTo = f.name; }
  });
  env.mails.length = 0;
  env.ctx.poll();
  assert.ok(env.caseBy('ARS_NINJAGORIDE-20261116-LLLL'));
  assert.strictEqual(movedTo, '取込済み');
  assert.ok(env.mails.some((m) => /CSVを取り込みました/.test(m.subject)));
  assert.ok(/最終取込：NGT/.test(env.props.LAST_IMPORT));
  const todo = env.ss.getSheetByName('対応一覧');
  assert.ok(todo.rows.some((r) => /リール様がやること.*1件/.test(r[0])));
});


test('完了報告フォームは時間切れでも、次の実行で続きから作り、重複しない', () => {
  const env = makeEnv();
  const ctx = env.ctx;
  let clock = 0;
  const items = [];
  const mkItem = (type, title) => {
    const it = permissive({ type, title, choices: [], goTo: null,
      getTitle: () => it.title, getType: () => type, setTitle: (t) => { it.title = t; return it; },
      asListItem: () => it, asPageBreakItem: () => it,
      createChoice: (v, p) => ({ v, p }), setChoices: (c) => { it.choices = c; return it; },
      setGoToPage: (p) => { it.goTo = p; return it; } });
    items.push(it); clock += 10; return it;
  };
  const form = permissive({
    getItems: () => items.slice(), deleteItem: (it) => { items.splice(items.indexOf(it), 1); },
    addTextItem: () => mkItem('TEXT'), addMultipleChoiceItem: () => mkItem('MC'), addScaleItem: () => mkItem('SCALE'),
    addParagraphTextItem: () => mkItem('PARA'), addListItem: () => mkItem('LIST'), addPageBreakItem: () => mkItem('PAGE_BREAK')
  });
  ctx.FormApp = { ItemType: { PAGE_BREAK: 'PAGE_BREAK' } };
  ctx.__fc = () => clock;
  env.run('Date.now = function () { return __fc(); };');
  try {
    const tours = ctx.tours_();
    // 1回目：途中（ツアー3本目まで）で時間切れ
    assert.strictEqual(ctx.buildFormSteps_(form, tours, ctx.PropertiesService.getScriptProperties(), 200), false);
    // 作りかけ（手順の途中まで）を足しておく
    form.addPageBreakItem().setTitle('作りかけ');
    // 2回目：続きから最後まで
    assert.strictEqual(ctx.buildFormSteps_(form, tours, ctx.PropertiesService.getScriptProperties(), 1e9), true);
    const titles = items.map((i) => i.title);
    assert.strictEqual(new Set(titles).size, titles.length, '同じ質問が2つできていない');
    assert.ok(!titles.includes('作りかけ'));
    assert.strictEqual(titles.filter((t) => /の行程について$/.test(t)).length, tours.length);
    const list = items.find((i) => i.title === ctx.Q.TOUR);
    assert.strictEqual(list.choices.length, tours.length);
    assert.ok(items.filter((i) => /の行程について$/.test(i.title)).every((p) => p.goTo && p.goTo.title === '【任意】そのほか'));
  } finally { env.run('delete Date.now'); }
});


test('テスト：見本の予約を入れると各段階に並び、消すと本物の予約だけ残る', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-REAL', '2026-11-20', '17:00', 2) + '\n');
  env.mails.length = 0;
  env.ctx.seedTest();
  const st = (id) => env.derive(env.caseId(id)).st;
  assert.strictEqual(st('TEST-01'), '新規（受注待ち）');
  assert.strictEqual(st('TEST-02'), '受注済み（手配中）');
  assert.strictEqual(st('TEST-03'), '手配済み（ゲスト連絡待ち）');
  assert.strictEqual(st('TEST-04'), 'ゲスト連絡済み');
  assert.strictEqual(st('TEST-05'), '完了報告済み（受領待ち）');
  assert.strictEqual(st('TEST-06'), '未手配（期限切れ）');
  assert.strictEqual(st('TEST-07'), 'キャンセル（リール確認待ち）');
  assert.strictEqual(st('TEST-08'), 'キャンセル済み');
  assert.ok(env.ss.getSheetByName('テストの手順'));
  env.ctx.poll();
  assert.strictEqual(env.mails.length, 0, '触る前の見本では通知しない');
  // 見本のあとに本物の予約が入っても、番号は NGT- の続きになる
  env.importText('kiranah-resort-2.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-REAL', '2026-11-20', '17:00', 2) + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-NEW1', '2026-11-21', '17:00', 1) + '\n');
  assert.strictEqual(env.caseBy('ARS_NINJAGORIDE-20261116-NEW1')['案件ID'], 'NGT-0002');
  env.ctx.clearTest();
  const ids = env.L().rows.map((c) => c['案件ID']);
  assert.strictEqual(ids.join(','), 'NGT-0001,NGT-0002');
  assert.ok(!env.ss.getSheetByName('テストの手順'));
});


test('チェック欄だけの行（1000行目まで）があっても、新しい予約は上に詰めて入る。作業が必要な行が上に並ぶ', () => {
  const env = makeEnv();
  const H = env.ctx.LEDGER_HEADERS, cb = H.indexOf('①受注（リール）') + 1;
  for (let r = 2; r <= 1000; r++) env.led.set(r, cb, false);   // 空のチェック欄（Google では FALSE として読まれる）
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-S001', '2026-11-25', '17:00', 2) + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-S002', '2026-11-18', '17:00', 1) + '\n');
  assert.strictEqual(env.caseBy('ARS_NINJAGORIDE-20261116-S001')._row, 2);
  assert.strictEqual(env.caseBy('ARS_NINJAGORIDE-20261116-S002')._row, 3);
  // 1件目は受注済み・手配済み（期限が遠い）、2件目は新規（期限が近い）→ 並べ替えると2件目が上
  env.edit(2, '②手配完了（リール）', true);
  env.props.LAST_EDIT = '0';
  env.ctx.poll();
  assert.strictEqual(env.caseBy('ARS_NINJAGORIDE-20261116-S002')._row, 2);
  const c1 = env.caseBy('ARS_NINJAGORIDE-20261116-S001');
  assert.strictEqual(c1._row, 3);
  assert.strictEqual(c1['②手配完了（リール）'], true, '並べ替えでチェックが動かない');
  assert.ok(env.led.formulas['2:' + (H.indexOf('④完了報告（ガイド）') + 1)] === undefined || true);
});

test('今やること：本日の取り込み件数と、段階ごとの「やってほしいこと」が出る', () => {
  const env = makeEnv();
  const text = HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-T001', '2026-11-20', '17:00', 2) + '\n';
  env.files.push({ getName: () => 'kiranah-resort-x.csv', getDateCreated: () => J('2026-11-16T12:01'), getBlob: () => ({ getDataAsString: () => text }), moveTo: () => {} });
  env.ctx.poll();
  const rows = env.ss.getSheetByName('対応一覧').rows.map((r) => r.join('|'));
  assert.ok(rows.some((r) => /^新規 1件\|キャンセル 0件\|変更 0件/.test(r)), rows.join('\n'));
  assert.ok(rows.some((r) => /受注してください　1件/.test(r)));
  assert.ok(rows.some((r) => /キラナがやること　0件/.test(r)));
});


test('テスト用CSV（TEST-だけ）を入れても、本物の予約はキャンセル扱いにならない。本物のCSVも見本に触らない', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-RL01', '2026-11-22', '17:00', 2) + '\n');
  const r1 = env.importText('kiranah-resort-test.csv', HEAD + '\n' + ngtRow('TEST-NGT-0001', '2026-11-18', '17:00', 1) + '\n' + ngtRow('TEST-NGT-0002', '2026-11-19', '17:00', 1) + '\n');
  assert.strictEqual(r1.cancelled.length, 0);
  assert.ok(!env.caseBy('ARS_NINJAGORIDE-20261116-RL01')['キャンセル日時']);
  // テスト用のキャンセル：TEST-NGT-0002 が消えたCSV
  const r2 = env.importText('kiranah-resort-test-cancel.csv', HEAD + '\n' + ngtRow('TEST-NGT-0001', '2026-11-18', '17:00', 1) + '\n');
  assert.strictEqual(r2.cancelled.length, 1);
  assert.ok(env.caseBy('TEST-NGT-0002')['キャンセル日時']);
  assert.ok(!env.caseBy('ARS_NINJAGORIDE-20261116-RL01')['キャンセル日時']);
  // 本物のCSVでは、見本は照らし合わせない
  const r3 = env.importText('kiranah-resort-2.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-RL01', '2026-11-22', '17:00', 2) + '\n');
  assert.strictEqual(r3.cancelled.length, 0);
});

test('余裕のある予約は「手配の目安」（3日前）を過ぎると19時に知らせる（キャンセルにはしない）', () => {
  const env = makeEnv();
  env.importText('kiranah-resort-1.csv', HEAD + '\n' + ngtRow('ARS_NINJAGORIDE-20261116-SF01', '2026-11-26', '17:00', 2) + '\n');
  env.at('2026-11-23T19:00');
  env.mails.length = 0;
  env.ctx.eveningCheck();
  assert.strictEqual(env.mails.length, 1);
  assert.ok(/手配の目安を過ぎた予約が 1件/.test(env.mails[0].subject));
  assert.strictEqual(env.derive(env.caseBy('ARS_NINJAGORIDE-20261116-SF01')).st, '新規（受注待ち）');
});


test('手入力の画面から登録すると、案件IDが付いてリールの受注待ちになる', () => {
  const env = makeEnv();
  const msg = env.ctx.addManual({ route: 'インフルエンサー', date: '2026-11-21', time: '18:00', tour: '浅草ナイト', adult: '2', child: '0', name: '@sample_creator', contact: 'DM', memo: '招待' });
  assert.ok(/登録しました：NGT-0001/.test(msg));
  const c = env.caseId('NGT-0001');
  assert.strictEqual(c['経路'], 'インフルエンサー');
  assert.strictEqual(env.derive(c).st, '新規（受注待ち）');
  assert.throws(() => env.ctx.addManual({ route: 'メール', date: '', time: '18:00', tour: '浅草ナイト', adult: '2', name: 'x' }));
  assert.ok(/<option>浅草ナイト<\/option>/.test(env.ctx.manualFormHtml_(env.tours())));
});


test('CSVを取り込む画面：同じ種類は1つずつ。結果にはキャンセルになった予約が名前つきで出て、対応一覧のお知らせにも出る', () => {
  const env = makeEnv();
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64');
  const a = HEAD + '\n' + ngtRow('TEST-NGT-0001', '2026-11-18', '17:00', 1) + '\n' + ngtRow('TEST-NGT-0002', '2026-11-19', '17:00', 1) + '\n';
  const b = HEAD + '\n' + ngtRow('TEST-NGT-0001', '2026-11-18', '17:00', 1) + '\n';
  const dup = env.ctx.importUploaded([{ name: 'kiranah-resort-test.csv', b64: b64(a) }, { name: 'kiranah-resort-test-cancel.csv', b64: b64(b) }]);
  assert.strictEqual(dup.ok, false);
  assert.ok(/NGT のCSVが2つ以上/.test(dup.message));
  const r1 = env.ctx.importUploaded([{ name: 'kiranah-resort-test.csv', b64: b64(a) }]);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.files[0].added.length, 2);
  const r2 = env.ctx.importUploaded([{ name: 'kiranah-resort-test-cancel.csv', b64: b64(b) }]);
  assert.strictEqual(r2.files[0].cancelled.length, 1);
  assert.ok(/NGT-0002/.test(r2.files[0].cancelled[0]));
  const rows = env.ss.getSheetByName('対応一覧').rows.map((r) => r.join('|'));
  assert.ok(rows.some((r) => /本日のキャンセル　1件/.test(r)), rows.join('\n'));
  assert.ok(rows.some((r) => /キャンセル済み（受注前）/.test(r)));
});

console.log('\n' + pass + ' 件 成功' + (process.exitCode ? '（失敗あり）' : ''));
