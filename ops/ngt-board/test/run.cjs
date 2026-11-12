// NGT 手配ボードのテスト（Node で実行：node ops/ngt-board/test/run.cjs）
// Google のサービス（スプレッドシート・Gmail など）を最小限の偽物に置き換えて、
// 通知メールの取り込みから発注・キャンセルまでの流れを確かめる。
// 予約番号・氏名・アドレスはすべて架空。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const J = (s) => new Date(s + ':00+09:00'); // '2026-11-12T10:00' を日本時間で

// ---------- 偽のスプレッドシート ----------
class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  setNumberFormat() { return this; }
  setNote() { return this; }
  setValues(vals) {
    for (let i = 0; i < vals.length; i++) for (let j = 0; j < vals[i].length; j++) this.sheet.set(this.r + i, this.c + j, vals[i][j]);
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sheet.get(this.r + i, this.c + j)); out.push(row); }
    return out;
  }
}
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  set(r, c, v) { while (this.rows.length < r) this.rows.push([]); const row = this.rows[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
  get(r, c) { const row = this.rows[r - 1] || []; return row[c - 1] === undefined ? '' : row[c - 1]; }
  getLastRow() { return this.rows.length; }
  getMaxRows() { return 1000; }
  appendRow(arr) { this.rows.push(arr.slice()); }
  setFrozenRows() {}
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr || 1, nc || 1); }
  getDataRange() {
    const w = Math.max(0, ...this.rows.map((r) => r.length));
    return { getValues: () => this.rows.map((r) => { const x = r.slice(); while (x.length < w) x.push(''); return x; }) };
  }
}
class FakeSpreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return (this.sheets[n] = new FakeSheet(n)); }
  setSpreadsheetTimeZone() {}
}

// ---------- 偽の Gmail ----------
let seq = 0;
class FakeMessage {
  constructor(o) { Object.assign(this, o); this.id = this.id || 'm' + (++seq); }
  getId() { return this.id; }
  getSubject() { return this.subject; }
  getPlainBody() { return this.body; }
  getDate() { return this.date; }
  getFrom() { return this.from; }
  getThread() { return this.thread; }
}
class FakeThread {
  constructor() { this.id = 't' + (++seq); this.messages = []; this.labels = new Set(); }
  getId() { return this.id; }
  getMessages() { return this.messages.slice(); }
  addLabel(l) { this.labels.add(l.name); return this; }
}
function makeGmail(clock) {
  const threads = [];
  const drafts = {};
  const labels = {};
  const G = {
    threads, drafts,
    deliver(o) { const th = new FakeThread(); const m = new FakeMessage({ ...o, thread: th }); th.messages.push(m); threads.push(th); return m; },
    replyTo(thread, o) { const m = new FakeMessage({ ...o, thread }); thread.messages.push(m); return m; },
    getUserLabelByName(n) { return labels[n] || null; },
    createLabel(n) { return (labels[n] = { name: n }); },
    createDraft(to, subject, body, opts) {
      const id = 'd' + (++seq);
      const d = {
        to, subject, body, opts, getId: () => id,
        send() { delete drafts[id]; const th = new FakeThread(); const m = new FakeMessage({ subject, body, from: 'NINJA GO TOURS <ops@example.com>', to, date: clock(), sent: true, thread: th }); th.messages.push(m); threads.push(th); return m; },
        deleteDraft() { delete drafts[id]; }
      };
      drafts[id] = d;
      return d;
    },
    getDraft(id) { if (!drafts[id]) throw new Error('no draft'); return drafts[id]; },
    search(q) {
      const tok = (q.match(/"([^"]+)"/) || [])[1];
      const after = +(q.match(/after:(\d+)/) || [])[1] || 0;
      if (q.indexOf('in:sent') >= 0) {
        return threads.filter((th) => th.messages.some((m) => m.sent && m.date.getTime() / 1000 >= after && (m.subject + m.body).indexOf(tok) >= 0));
      }
      const fromM = q.match(/^from:([^\s]+)\s/);
      if (fromM && fromM[1] !== 'no-reply@linktivity.co.jp') {
        return threads.filter((th) => th.messages.some((m) => !m.sent && m.from.indexOf(fromM[1]) >= 0 && m.date.getTime() / 1000 >= after && (m.subject + m.body).indexOf(tok) >= 0));
      }
      if (q.indexOf('no-reply@linktivity.co.jp') >= 0) {
        return threads.filter((th) => !th.labels.has('NGT台帳/取込済') && !th.labels.has('NGT台帳/取込不可') && th.messages.some((m) => m.from.indexOf('no-reply@linktivity.co.jp') >= 0));
      }
      throw new Error('想定外の検索: ' + q);
    }
  };
  return G;
}

// ---------- 読み込み ----------
function load(src) {
  let clockT = J('2026-11-12T10:00').getTime();
  const clock = () => new Date(clockT);
  const ss = new FakeSpreadsheet();
  const props = {};
  const mails = [];
  const fetches = [];
  const gmail = makeGmail(clock);
  let uuid = 0;
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    Utilities: {
      getUuid: () => 'uuid-' + (++uuid),
      formatDate: (d, tz, f) => { const t = new Date(d.getTime() + 9 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return f.replace('yyyy', t.getUTCFullYear()).replace('MM', p(t.getUTCMonth() + 1)).replace('dd', p(t.getUTCDate())).replace('HH', p(t.getUTCHours())).replace('mm', p(t.getUTCMinutes())); }
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    MailApp: { sendEmail: (o) => mails.push(o) },
    UrlFetchApp: { fetch: (u, o) => { fetches.push({ u, o }); return { getResponseCode: () => 200, getContentText: () => '' }; } },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getProjectTriggers: () => [], deleteTrigger: () => {},
      newTrigger: () => { const b = { timeBased: () => b, everyMinutes: () => b, atHour: () => b, everyDays: () => b, inTimezone: () => b, create: () => b }; return b; }
    },
    GmailApp: gmail,
    HtmlService: {
      createTemplateFromFile: () => { const t = { from: 'file', evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, view: t.view, from: t.from }) }; return t; },
      createTemplate: (html) => { const t = { from: 'inline', html, evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, view: t.view, from: t.from }) }; return t; }
    },
    ContentService: { createTextOutput: (s) => s }
  };
  vm.createContext(ctx);
  vm.runInContext(src || SRC, ctx, { filename: 'Code.gs' });
  ctx.now_ = clock;
  return { ctx, ss, props, mails, fetches, gmail, setNow: (s) => { clockT = J(s).getTime(); }, clock };
}

function setSetting(env, key, value) {
  const sh = env.ss.getSheetByName('設定');
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) if (rows[i][0] === key) { sh.set(i + 1, 2, value); return; }
  throw new Error('設定がない: ' + key);
}
function cases(env) { return env.ctx.ledger_().rows; }
function caseOf(env, id) { return cases(env).find((c) => c['案件ID'] === id); }

// ---------- 通知メールの見本（架空の番号）----------
const NGT_NEW = (no) => ({
  from: 'LINKTIVITY Inc. <no-reply@linktivity.co.jp>', subject: '予約が入りました # ' + no,
  body: [
    '予約が入りました！', '株式会社Kiranah Resort', 'ご担当者様', '', '新規予約が入りました。', '詳細は下記URLよりご確認ください。',
    '* テスト予約の可能性があります。該当予約を検索できない場合、できても氏名等がTestとなっている場合はご放念ください。',
    'NINJA GO TOURS・東京：新宿歌舞伎町・ゴールデン街＆秘密の神社ウォーク with 忍者',
    '予約番号\t' + no, '代理店予約番号\tbk_test0000000000000000-TEST0000000', 'PLAN名\t東京：新宿歌舞伎町・ゴールデン街＆秘密の神社ウォーク with 忍者（60分・12歳以下無料）',
    '備考:\t', '                    payment_order_id=ars-00000000000000-000000&site=WEBSITE', '2021 Copyright LINKTIVITY Inc.© All Rights Reserved.'
  ].join('\n')
});
const NGT_CANCEL = (no) => ({
  from: 'LINKTIVITY Inc. <no-reply@linktivity.co.jp>', subject: '予約がキャンセルされまし # ' + no,
  body: [
    '予約がキャンセルされました', '株式会社Kiranah Resort', 'ご担当者様', '', 'この予約はキャンセルされました。', '詳細は下記URLよりご確認ください。', '',
    'NINJA GO TOURS・東京：新宿歌舞伎町・ゴールデン街＆秘密の神社ウォーク with 忍者',
    '予約番号\t' + no, '代理店予約番号\tbk_test1111111111111111', 'PLAN名\t東京：新宿歌舞伎町・ゴールデン街＆秘密の神社ウォーク with 忍者（60分・12歳以下無料）',
    '2021 Copyright LINKTIVITY Inc.© All Rights Reserved.'
  ].join('\n')
});
const NKT_NEW = (no, plan) => ({
  from: 'LINKTIVITY Inc. <no-reply@linktivity.co.jp>', subject: '予約が入りました # ' + no,
  body: [
    '予約が入りました！', '株式会社TryHard Japan', 'ご担当者様', '', '新規予約が入りました。', '詳細は下記URLよりご確認ください。',
    '* テスト予約の可能性があります。', 'Ninja+Kabuki Tokyo', '予約番号\t' + no, '代理店予約番号\tbk_test2222-NW1TEST', 'PLAN名\t' + plan,
    '備考:\t', 'payment_order_id=ars-00000000000000-000000&site=WEBSITE'
  ].join('\n')
});

const results = [];
function test(name, fn) {
  try { fn(); results.push(['ok', name]); } catch (e) { results.push(['NG', name, e]); }
}

// ================= 純粋な関数 =================
test('通知メール（新規）を読み取れる', () => {
  const env = load();
  const m = NGT_NEW('ARS_NINJAGORIDE-20261112-TST1');
  const p = env.ctx.parseLinktivityMail(m.subject, m.body);
  assert.strictEqual(p.event, 'new');
  assert.strictEqual(p.bookingNo, 'ARS_NINJAGORIDE-20261112-TST1');
  assert.strictEqual(p.agentNo, 'bk_test0000000000000000-TEST0000000');
  assert.ok(p.plan.startsWith('東京：新宿歌舞伎町'));
  assert.strictEqual(p.product, 'NINJA GO TOURS・東京：新宿歌舞伎町・ゴールデン街＆秘密の神社ウォーク with 忍者');
  assert.strictEqual(p.account, '株式会社Kiranah Resort');
  assert.strictEqual(p.site, 'WEBSITE');
});
test('通知メール（キャンセル・件名が途中で切れている）を読み取れる', () => {
  const env = load();
  const m = NGT_CANCEL('ARS_TRIPLABO_WEB-20261023-TST2');
  const p = env.ctx.parseLinktivityMail(m.subject, m.body);
  assert.strictEqual(p.event, 'cancel');
  assert.strictEqual(p.bookingNo, 'ARS_TRIPLABO_WEB-20261023-TST2');
  assert.strictEqual(env.ctx.channelOf_(p.bookingNo), 'TRIPLABO_WEB');
});
test('表が改行で崩れた本文でも読み取れる', () => {
  const env = load();
  const body = '新規予約が入りました。\n\nNINJA GO TOURS・秘密の神社ウォーク\n予約番号\n\nARS_NINJAGORIDE-20261112-TST9\n代理店予約番号\nbk_x\nPLAN名\n秘密の神社ウォーク（60分）\n';
  const p = env.ctx.parseLinktivityMail('予約が入りました # ARS_NINJAGORIDE-20261112-TST9', body);
  assert.strictEqual(p.bookingNo, 'ARS_NINJAGORIDE-20261112-TST9');
  assert.strictEqual(p.plan, '秘密の神社ウォーク（60分）');
});
test('ツアーの判定（秘密の神社・NKT セット・NKT 単体）', () => {
  const env = load();
  const tours = env.ctx.toursFromRows_(env.ctx.TOUR_DEFAULTS);
  assert.strictEqual(env.ctx.matchTour_('東京：新宿歌舞伎町・ゴールデン街＆秘密の神社ウォーク with 忍者', tours).name, '秘境神社 Ninja Walk');
  assert.strictEqual(env.ctx.matchTour_('新宿を遊び尽くす！SHINJUKU NINJA -LIVE- SHOW チケット＆ローカルツアーセット', tours).name, 'NKTセット（秘境神社 Ninja Walk）');
  assert.strictEqual(env.ctx.matchTour_('Ninja+Kabuki Tokyo 一般チケット', tours), null);
});
test('開始時刻の候補', () => {
  const env = load();
  const t = env.ctx.timeOptions_('17:00-21:30/30');
  assert.strictEqual(t.length, 10); assert.strictEqual(t[0], '17:00'); assert.strictEqual(t[9], '21:30');
  assert.deepStrictEqual(Array.from(env.ctx.timeOptions_('16:30,19:30')), ['16:30', '19:30']);
});
test('入力の期限（昼・夜）', () => {
  const env = load();
  const cfg = env.ctx.normalizeSettings_({ '入力の期限（分）': '120', '夜間の開始': '22:00', '夜間の終了': '08:00' });
  const f = (s) => env.ctx.fmtDT_(env.ctx.detailDue_(J(s), cfg));
  assert.strictEqual(f('2026-11-12T10:05'), '11/12(木) 12:05');
  assert.strictEqual(f('2026-11-12T21:30'), '11/13(金) 10:00'); // 23:30 は夜間 → 朝8時＋2時間
  assert.strictEqual(f('2026-11-12T23:30'), '11/13(金) 10:00');
  assert.strictEqual(f('2026-11-13T07:00'), '11/13(金) 10:00');
});
test('「取り込み開始」の文字は日本時間として読む', () => {
  const env = load();
  assert.strictEqual(env.ctx.toDate_('2026-11-12 10:00').toISOString(), '2026-11-12T01:00:00.000Z');
});

// ================= 一連の流れ =================
function ready() {
  const env = load();
  env.ctx.setup();
  setSetting(env, '通知先メール', 'kiranah@example.com');
  setSetting(env, 'リールの宛先', 'reelu-ops@example.com');
  setSetting(env, 'リールのドメイン', 'reelu.example');
  return env;
}

test('初期設定：シート・取り込み開始・一覧のトークン', () => {
  const env = ready();
  ['台帳', 'ツアー', '設定', 'ログ'].forEach((n) => assert.ok(env.ss.getSheetByName(n), n));
  const cfg = env.ctx.settings_();
  assert.strictEqual(cfg.since.toISOString(), J('2026-11-12T10:00').toISOString());
  assert.ok(env.props.LIST_TOKEN);
});

test('予約 → 詳細待ち → 催促 → 入力 → 下書き → 送信 → リールの返信 → キャンセル → 完了', () => {
  const env = ready();
  const NO = 'ARS_NINJAGORIDE-20261112-TST1';
  env.gmail.deliver({ ...NGT_NEW(NO), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06');
  env.ctx.poll();
  let c = caseOf(env, 'NGT-0001');
  assert.strictEqual(c['状態'], '詳細待ち');
  assert.strictEqual(c['ツアー'], '秘境神社 Ninja Walk');
  assert.strictEqual(c['経路'], '公式直販');
  assert.strictEqual(env.mails.length, 1);
  assert.ok(env.mails[0].subject.includes('新しい予約'));
  assert.ok(env.mails[0].body.includes(NO));

  // 同じメールを二重に取り込まない
  env.ctx.poll();
  assert.strictEqual(cases(env).length, 1);
  assert.strictEqual(env.mails.length, 1);

  // 期限（12:05）を過ぎたら催促。間隔（60分）内は繰り返さない
  env.setNow('2026-11-12T12:10'); env.ctx.poll();
  assert.strictEqual(env.mails.length, 2);
  assert.ok(env.mails[1].subject.includes('期限切れ'));
  env.setNow('2026-11-12T12:40'); env.ctx.poll();
  assert.strictEqual(env.mails.length, 2);
  env.setNow('2026-11-12T13:11'); env.ctx.poll();
  assert.strictEqual(env.mails.length, 3);
  assert.ok(env.mails[2].subject.includes('2回目'));

  // 画面で入力 → 下書き
  c = caseOf(env, 'NGT-0001');
  env.setNow('2026-11-12T13:20');
  const r = env.ctx.apiSave('NGT-0001', c['トークン'], { tour: '秘境神社 Ninja Walk', date: '2026-11-20', time: '19:00', adults: '2', children: '1', guest: 'Test Guest', contact: 'guest@example.com', memo: '' });
  assert.ok(r.msg.includes('下書き'));
  c = caseOf(env, 'NGT-0001');
  assert.strictEqual(c['状態'], '発注待ち');
  const drafts = Object.values(env.gmail.drafts);
  assert.strictEqual(drafts.length, 1);
  assert.strictEqual(drafts[0].subject, '【ご依頼】11月20日(金) 19:00「秘境神社 Ninja Walk」ガイドご手配のお願い［NGT-0001］');
  assert.ok(drafts[0].body.includes('集合場所：新宿東宝ビル1F'));
  assert.ok(drafts[0].body.includes('大人2名（12歳以下 1名）'));
  assert.strictEqual(drafts[0].to, 'reelu-ops@example.com');

  // 下書きを送るまで「発注待ち」。期限（30分）を過ぎたら催促
  env.setNow('2026-11-12T13:55'); env.ctx.poll();
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], '発注待ち');
  assert.ok(env.mails[env.mails.length - 1].subject.includes('発注待ち'));

  // 送信 → 返信待ち
  env.setNow('2026-11-12T14:00'); const sent = drafts[0].send();
  env.setNow('2026-11-12T14:05'); env.ctx.poll();
  c = caseOf(env, 'NGT-0001');
  assert.strictEqual(c['状態'], '返信待ち（発注済み）');
  assert.strictEqual(c['発注日時'].toISOString(), J('2026-11-12T14:00').toISOString());

  // リールの返信 → 手配済み
  env.gmail.replyTo(sent.thread, { from: 'Reelu <ops@reelu.example>', subject: 'Re: ' + sent.subject, body: 'かしこまりました。ガイドの手配を進めます。', date: J('2026-11-12T15:00') });
  env.setNow('2026-11-12T15:05'); env.ctx.poll();
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], '手配済み');

  // キャンセルの通知 → キャンセルのメールの下書き → 送信 → 返信なしで催促 → 返信 → 完了
  const before = env.mails.length;
  env.gmail.deliver({ ...NGT_CANCEL(NO), date: J('2026-11-15T09:00') });
  env.setNow('2026-11-15T09:03'); env.ctx.poll();
  c = caseOf(env, 'NGT-0001');
  assert.strictEqual(c['状態'], 'キャンセル（リールへ連絡待ち）');
  assert.ok(env.mails[before].subject.startsWith('【至急】'));
  const cx = Object.values(env.gmail.drafts)[0];
  assert.ok(cx.subject.startsWith('【キャンセル】11月20日(金) 19:00'));
  env.setNow('2026-11-15T09:10'); const cxSent = cx.send();
  env.setNow('2026-11-15T09:15'); env.ctx.poll();
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], 'キャンセル（リールの返信待ち）');
  env.setNow('2026-11-16T09:20'); env.ctx.poll(); // 24時間たっても返信なし
  assert.ok(env.mails[env.mails.length - 1].subject.includes('キャンセル（リールの返信待ち）'));
  env.gmail.replyTo(cxSent.thread, { from: 'Reelu <ops@reelu.example>', subject: 'Re: ' + cxSent.subject, body: '承知しました。', date: J('2026-11-16T10:00') });
  env.setNow('2026-11-16T10:05'); env.ctx.poll();
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], 'キャンセル（完了）');
});

test('詳細待ちのままキャンセル → 未発注で閉じ、下書きも消す', () => {
  const env = ready();
  const NO = 'ARS_NINJAGORIDE-20261112-TST3';
  env.gmail.deliver({ ...NGT_NEW(NO), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  env.gmail.deliver({ ...NGT_CANCEL(NO), date: J('2026-11-12T10:30') });
  env.setNow('2026-11-12T10:31'); env.ctx.poll();
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], 'キャンセル（未発注）');
  env.setNow('2026-11-12T13:00'); const n = env.mails.length; env.ctx.poll();
  assert.strictEqual(env.mails.length, n, 'キャンセル後に催促しない');
});

test('台帳にない予約のキャンセル → 至急で知らせ、すぐに二重には知らせない', () => {
  const env = ready();
  env.gmail.deliver({ ...NGT_CANCEL('ARS_TRIPLABO_WEB-20261023-TST2'), date: J('2026-11-12T10:10') });
  env.setNow('2026-11-12T10:11'); env.ctx.poll();
  const c = caseOf(env, 'NGT-0001');
  assert.strictEqual(c['状態'], 'キャンセル（台帳になし・要確認）');
  assert.strictEqual(env.mails.length, 1);
  assert.ok(env.mails[0].subject.startsWith('【至急】'));
  env.setNow('2026-11-12T10:16'); env.ctx.poll();
  assert.strictEqual(env.mails.length, 1);
  env.setNow('2026-11-12T11:12'); env.ctx.poll();
  assert.strictEqual(env.mails.length, 2);
  const r = env.ctx.apiAction('NGT-0001', c['トークン'], 'cx_acked');
  assert.ok(r.msg.includes('完了'));
});

test('NKT：セットは取り込み、セット以外は対象外', () => {
  const env = ready();
  env.gmail.deliver({ ...NKT_NEW('ARS_TRYHARD-20261112-TST4', '新宿を遊び尽くす！SHINJUKU NINJA -LIVE- SHOW チケット＆ローカルツアーセット'), date: J('2026-11-12T10:20') });
  env.gmail.deliver({ ...NKT_NEW('ARS_TRYHARD-20261112-TST5', 'Ninja+Kabuki Tokyo 一般席'), date: J('2026-11-12T10:21') });
  env.setNow('2026-11-12T10:25'); env.ctx.poll();
  assert.strictEqual(cases(env).length, 1);
  const c = caseOf(env, 'NGT-0001');
  assert.strictEqual(c['ツアー'], 'NKTセット（秘境神社 Ninja Walk）');
  assert.strictEqual(c['経路'], 'NKT直販');
});

test('読み取れない通知・取り込み開始より前のメール', () => {
  const env = ready();
  env.gmail.deliver({ from: 'LINKTIVITY Inc. <no-reply@linktivity.co.jp>', subject: 'お知らせ', body: 'メンテナンスのお知らせ', date: J('2026-11-12T10:30') });
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261111-TST6'), date: J('2026-11-11T07:43') });
  env.setNow('2026-11-12T10:31'); env.ctx.poll();
  assert.strictEqual(cases(env).length, 0);
  assert.strictEqual(env.mails.length, 1);
  assert.ok(env.mails[0].subject.includes('読み取れない'));
  env.setNow('2026-11-12T10:36'); env.ctx.poll();
  assert.strictEqual(env.mails.length, 1, '同じメールで二度知らせない');
});

test('夜に届いた予約は、朝まで催促しない', () => {
  const env = ready();
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TST7'), date: J('2026-11-12T23:30') });
  env.setNow('2026-11-12T23:31'); env.ctx.poll();
  const n = env.mails.length;
  env.setNow('2026-11-13T07:55'); env.ctx.poll();
  assert.strictEqual(env.mails.length, n);
  env.setNow('2026-11-13T10:01'); env.ctx.poll();
  assert.strictEqual(env.mails.length, n + 1);
});

test('台帳のシートに直接入力しても、発注に進む', () => {
  const env = ready();
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TST8'), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  const sh = env.ss.getSheetByName('台帳');
  const H = env.ctx.LEDGER_HEADERS;
  sh.set(2, H.indexOf('催行日') + 1, J('2026-11-21T00:00'));
  sh.set(2, H.indexOf('開始時刻') + 1, '18:30');
  sh.set(2, H.indexOf('大人') + 1, 3);
  env.setNow('2026-11-12T10:20'); env.ctx.poll();
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], '発注待ち');
  assert.strictEqual(Object.keys(env.gmail.drafts).length, 1);
});

test('自動送信：入力と同時に送り、変更は【変更】で送る', () => {
  const env = ready();
  setSetting(env, '発注のしかた', '自動送信');
  setSetting(env, '発注メールの件名の先頭', '【試運用】');
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TS10'), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  let c = caseOf(env, 'NGT-0001');
  env.setNow('2026-11-12T10:30');
  env.ctx.apiSave('NGT-0001', c['トークン'], { tour: '秘境神社 Ninja Walk', date: '2026-11-13', time: '17:30', adults: '1', children: '0', guest: 'Test', contact: 'x', memo: '' });
  c = caseOf(env, 'NGT-0001');
  assert.strictEqual(c['状態'], '返信待ち（発注済み）');
  const sentSubjects = env.gmail.threads.flatMap((t) => t.messages).filter((m) => m.sent).map((m) => m.subject);
  assert.ok(sentSubjects[0].startsWith('【試運用】【ご依頼】11月13日(金) 17:30'));
  // 催行まで48時間を切っているので、返信の期限は2時間
  env.setNow('2026-11-12T12:31'); const n = env.mails.length; env.ctx.poll();
  assert.strictEqual(env.mails.length, n + 1);
  assert.ok(env.mails[env.mails.length - 1].body.includes('電話'));
  // 時刻の変更 → 【変更】を送り、ふたたび返信待ち
  env.setNow('2026-11-12T12:40');
  const r = env.ctx.apiSave('NGT-0001', c['トークン'], { tour: '秘境神社 Ninja Walk', date: '2026-11-13', time: '19:00', adults: '1', children: '0', guest: 'Test', contact: 'x', memo: '' });
  assert.ok(r.msg.includes('変更'));
  const last = env.gmail.threads.flatMap((t) => t.messages).filter((m) => m.sent).pop();
  assert.ok(last.subject.startsWith('【試運用】【変更】11月13日(金) 19:00'));
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], '返信待ち（発注済み）');
});

test('テスト予約として閉じる・トークン違いは拒否', () => {
  const env = ready();
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TS11'), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  const c = caseOf(env, 'NGT-0001');
  assert.throws(() => env.ctx.apiAction('NGT-0001', 'wrong', 'test'));
  env.ctx.apiAction('NGT-0001', c['トークン'], 'test');
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], 'テスト予約');
});

test('ウェブ画面：正しいリンクだけ開ける', () => {
  const env = ready();
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TS12'), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  const c = caseOf(env, 'NGT-0001');
  const ok = JSON.parse(env.ctx.doGet({ parameter: { id: 'NGT-0001', k: c['トークン'] } }).view.replace(/\\u003c/g, '<'));
  assert.strictEqual(ok.page, 'case');
  assert.strictEqual(ok.data.bookingNo, 'ARS_NINJAGORIDE-20261112-TS12');
  const ng = JSON.parse(env.ctx.doGet({ parameter: { id: 'NGT-0001', k: 'x' } }).view);
  assert.strictEqual(ng.page, 'error');
  const list = JSON.parse(env.ctx.doGet({ parameter: { k: env.props.LIST_TOKEN } }).view);
  assert.strictEqual(list.page, 'list');
  assert.strictEqual(list.data.items.length, 1);
});

test('LINE：グループを登録し、至急の通知を送る（名前は載せない）', () => {
  const env = ready();
  env.props.LINE_TOKEN = 'dummy-token';
  setSetting(env, 'LINE通知', 'ON');
  env.ctx.doPost({ postData: { contents: JSON.stringify({ events: [{ type: 'join', source: { type: 'group', groupId: 'Cgroup1' } }] }) } });
  assert.strictEqual(env.props.LINE_TO, 'Cgroup1');
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TS13'), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  assert.strictEqual(env.fetches.length, 1);
  const payload = JSON.parse(env.fetches[0].o.payload);
  assert.strictEqual(payload.to, 'Cgroup1');
  assert.ok(payload.messages[0].text.includes('NGT-0001'));
});

test('毎朝のまとめ', () => {
  const env = ready();
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TS14'), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  env.setNow('2026-11-13T09:00'); env.ctx.dailyDigest();
  const m = env.mails[env.mails.length - 1];
  assert.ok(m.subject.includes('今日のまとめ'));
  assert.ok(m.body.includes('■ 詳細待ち（1件）'));
});

test('1ファイル版：画面の HTML が入り、設定の初期値が入る', () => {
  const { execFileSync } = require('child_process');
  const tmp = path.join(require('os').tmpdir(), 'ngt-overrides-' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify({ '通知先メール': 'me@example.com', 'リールの宛先': 'reelu@example.com' }));
  const bundle = execFileSync(process.execPath, [path.join(__dirname, '..', 'build.cjs'), tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  const env = load(bundle);
  env.ctx.setup();
  const cfg = env.ctx.settings_();
  assert.deepStrictEqual(Array.from(cfg.notifyTo), ['me@example.com']);
  assert.deepStrictEqual(Array.from(cfg.reeluTo), ['reelu@example.com']);
  assert.strictEqual(cfg.orderMode, 'draft');
  const out = env.ctx.doGet({ parameter: { k: env.props.LIST_TOKEN } });
  assert.strictEqual(out.from, 'inline');
  assert.strictEqual(JSON.parse(out.view).page, 'list');
});

test('台帳に直接書いた日付・時刻（区切りなし・日本語）も読む', () => {
  const env = load();
  const y = env.ctx.toYmd_, h = env.ctx.toHm_;
  assert.strictEqual(y('20261112'), '2026-11-12');
  assert.strictEqual(y(20261112), '2026-11-12');
  assert.strictEqual(y('2026/11/2'), '2026-11-02');
  assert.strictEqual(y('2026年11月12日'), '2026-11-12');
  assert.strictEqual(y('20261399'), '');
  assert.strictEqual(h('1700'), '17:00');
  assert.strictEqual(h(1700), '17:00');
  assert.strictEqual(h('930'), '09:30');
  assert.strictEqual(h('17時'), '17:00');
  assert.strictEqual(h('17時30分'), '17:30');
  assert.strictEqual(h('１７：３０'), '17:30');
  assert.strictEqual(h('17'), '17:00');
  assert.strictEqual(h(0.75), '18:00');
  assert.strictEqual(h('2500'), '');
});

test('台帳に「20261121」「1830」と直接書いても発注に進む', () => {
  const env = ready();
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TS15'), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  const sh = env.ss.getSheetByName('台帳');
  const H = env.ctx.LEDGER_HEADERS;
  sh.set(2, H.indexOf('催行日') + 1, 20261121);
  sh.set(2, H.indexOf('開始時刻') + 1, '1830');
  sh.set(2, H.indexOf('大人') + 1, 2);
  env.setNow('2026-11-12T10:20'); env.ctx.poll();
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], '発注待ち');
  assert.ok(Object.values(env.gmail.drafts)[0].subject.includes('11月21日(土) 18:30'));
});

test('日時なしで手配済みにした案件に初めて日時を入れても【変更】は作らない', () => {
  const env = ready();
  env.gmail.deliver({ ...NGT_NEW('ARS_NINJAGORIDE-20261112-TS16'), date: J('2026-11-12T10:05') });
  env.setNow('2026-11-12T10:06'); env.ctx.poll();
  const sh = env.ss.getSheetByName('台帳');
  const H = env.ctx.LEDGER_HEADERS;
  sh.set(2, H.indexOf('状態') + 1, '手配済み');
  const c = caseOf(env, 'NGT-0001');
  env.setNow('2026-11-12T10:30');
  env.ctx.apiSave('NGT-0001', c['トークン'], { tour: '秘境神社 Ninja Walk', date: '2026-11-20', time: '19:00', adults: '2', children: '0', guest: 'T', contact: 'x', memo: '' });
  assert.strictEqual(caseOf(env, 'NGT-0001')['状態'], '手配済み');
  assert.strictEqual(Object.keys(env.gmail.drafts).length, 0);
});

let ng = 0;
results.forEach((r) => { if (r[0] === 'NG') { ng++; console.log('NG  ' + r[1] + '\n    ' + (r[2] && r[2].stack ? r[2].stack.split('\n').slice(0, 3).join('\n    ') : r[2])); } else console.log('ok  ' + r[1]); });
console.log('\n' + (results.length - ng) + '/' + results.length + ' ok');
process.exit(ng ? 1 : 0);
