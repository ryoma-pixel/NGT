/**
 * NGT 手配ボード（台帳）
 *
 * 共有アカウント（info_ninja-go-ride@ninja-kabukitokyo.com）の Google スプレッドシートに入れて使う
 * Google Apps Script。手順は同じフォルダの README.md を参照。
 *
 * やること
 *  1. LINKTIVITY の予約・キャンセルの通知メールを5分おきに取り込み、台帳に1件1行で載せる
 *     （通知メールには日時・人数がないため、新しい予約は「詳細待ち」で入る）
 *  2. 詳細の入力が遅れたら、担当者にメール（と LINE）で催促する
 *  3. 入力されたら、リールへの発注メールを用意する（下書き／自動送信）
 *  4. 発注メールが送られたか、リールから返信があったかを確認し、なければ催促する
 *  5. キャンセルは予約番号で台帳と照合し、発注済みならリールへのキャンセル連絡まで追いかける
 *
 * お客様の情報はこのスプレッドシートの中だけに置く（コードやリポジトリには入れない）。
 */

// ===== 定数 =====

var SHEETS = { LEDGER: '台帳', TOURS: 'ツアー', SETTINGS: '設定', LOG: 'ログ' };

var ST = {
  WAIT_DETAIL: '詳細待ち',
  WAIT_ORDER: '発注待ち',
  WAIT_REPLY: '返信待ち（発注済み）',
  ARRANGED: '手配済み',
  DONE: '催行済み',
  TEST: 'テスト予約',
  CX_NO_ORDER: 'キャンセル（未発注）',
  CX_WAIT_SEND: 'キャンセル（リールへ連絡待ち）',
  CX_WAIT_REPLY: 'キャンセル（リールの返信待ち）',
  CX_DONE: 'キャンセル（完了）',
  CX_UNKNOWN: 'キャンセル（台帳になし・要確認）'
};

var LEDGER_HEADERS = [
  '案件ID', '状態', '予約番号', '代理店予約番号', '経路', 'アカウント', 'PLAN名', 'ツアー',
  '催行日', '開始時刻', '大人', '子ども', '代表者名', '連絡先', 'メモ',
  '受信日時', '入力の期限', '入力日時', '発注日時', 'リール返信日時',
  'キャンセル受信日時', 'キャンセル連絡日時', '最終催促', '催促回数',
  '元メールID', '発注スレッドID', '下書きID', 'トークン'
];

var TOUR_HEADERS = ['キーワード', 'ツアー名', '集合場所', '開始時刻の候補', '注意'];

// キーワードは「PLAN名・商品名に含まれる文字」。| で区切ると、どれか1つ。上の行から順に照合する。
var TOUR_DEFAULTS = [
  ['秘密の神社', '秘境神社 Ninja Walk', '新宿東宝ビル1F（マルハン入口の横）', '17:00-21:30/30', ''],
  ['ローカルツアーセット', 'NKTセット（秘境神社 Ninja Walk）', '新宿東宝ビル1F（NKT会場を出てすぐ）', '16:30,19:30', 'NKT 15:00の部→16:30開始、18:00の部→19:30開始'],
  ['ゴールデン街', 'ゴールデン街ナイト', '新宿駅 東口交番前', '17:00-22:00/30', ''],
  ['二丁目|LGBTQ', '新宿二丁目 LGBTQ+', '京王新宿3丁目ビル スターバックス前', '17:00-22:00/30', 'ガイドは忍者の衣装を着ない'],
  ['ハンコ|印鑑', 'ハンコ作り', 'バスタ新宿（大看板の下）', '11:00-18:00/30', '平日のみ'],
  ['合羽橋|包丁', '合羽橋', '田原町駅3番出口', '10:00-16:00/30', 'ガイドは忍者の衣装を着ない'],
  ['アメ横|上野', '上野アメ横', 'JR上野駅 上野の森さくらテラス1F（タリーズ前）', '11:00-17:00/30', 'ガイドは忍者の衣装を着ない'],
  ['御苑', '新宿御苑', '京王新宿3丁目ビル スターバックス前', '10:30-16:00/30', '春のみ'],
  ['浅草', '浅草ナイト', '浅草文化観光センター1F', '17:00-21:00/30', 'ガイドは忍者の衣装を着ない'],
  ['スクーター|RIDE', 'Eスクーター（NINJA GO RIDE）', '新宿東宝ビル1F', '15:05,18:05', '']
];

var SETTING_DEFAULTS = [
  ['通知先メール', '', '催促・お知らせを受け取るアドレス。複数はカンマ区切り'],
  ['LINE通知', 'OFF', 'ON にすると至急の通知を LINE にも送る（README の「LINE の設定」が必要）'],
  ['取り込み開始', '', 'この日時より前に届いた通知メールは取り込まない（初期設定のときに自動で入る）'],
  ['入力の期限（分）', '120', '予約の通知を受けてから、詳細を入力するまでの期限'],
  ['発注の期限（分）', '30', '詳細を入力してから、リールへ発注メールを送るまでの期限'],
  ['催促の間隔（分）', '60', '期限を過ぎたあと、催促を繰り返す間隔'],
  ['夜間の開始', '22:00', 'この時刻から「夜間の終了」までは催促を送らない'],
  ['夜間の終了', '08:00', ''],
  ['発注のしかた', '下書き', '下書き＝この Gmail に発注メールの下書きを作る／自動送信＝入力と同時に送る／しない＝催促だけ'],
  ['リールの宛先', '', '発注メールの宛先。複数はカンマ区切り'],
  ['リールのCC', '', ''],
  ['リールのドメイン', 'reelu.jp', 'このドメインからの返信を「手配済み」とみなす'],
  ['発注メールの宛名', '株式会社Reelu\nご担当者様', ''],
  ['発注メールの件名の先頭', '', '試運用中は【試運用】など'],
  ['発注メールのCC', '', 'キラナ担当など'],
  ['発注メールの署名', 'NINJA GO TOURS（株式会社Kiranah Resort）', ''],
  ['返信の期限（時間）', '24', '発注してからリールの返信を待つ時間'],
  ['直前の返信の期限（時間）', '2', '催行まで「直前とみなす時間」を切っているときの返信の期限'],
  ['直前とみなす時間', '48', '']
];

var LOG_HEADERS = ['日時', '種類', '案件ID', '予約番号', '内容', 'メールID'];

// 1ファイル版（build.cjs で作る）では、画面の HTML と設定の初期値がこのファイルの最後で入る
var INDEX_HTML = '';
var SETTING_OVERRIDES = {};

var LABEL_DONE = 'NGT台帳/取込済';
var LABEL_ERROR = 'NGT台帳/取込不可';
var MAIL_QUERY = '(from:no-reply@linktivity.co.jp OR subject:"予約が入りました" OR subject:"予約がキャンセル")';

var H_MS = 3600000;
var MIN_MS = 60000;
var WD = '日月火水木金土';

// テストで差し替えられるように、現在時刻は必ずここから取る
function now_() { return new Date(); }

// ===== 日時（日本時間）=====

function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function jst_(d) {
  var t = new Date(d.getTime() + 9 * H_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), wd: t.getUTCDay() };
}

function jstDate_(y, mo, d, h, mi) { return new Date(Date.UTC(y, mo - 1, d, (h || 0) - 9, mi || 0)); }

function fmtDT_(d) {
  if (!isDate_(d) || isNaN(d)) return '';
  var p = jst_(d);
  return p.mo + '/' + p.d + '(' + WD[p.wd] + ') ' + pad2_(p.h) + ':' + pad2_(p.mi);
}

function fmtDayJa_(d) {
  var p = jst_(d);
  return p.mo + '月' + p.d + '日(' + WD[p.wd] + ')';
}

function ymd_(d) {
  var p = jst_(d);
  return p.y + '-' + pad2_(p.mo) + '-' + pad2_(p.d);
}

function hmToMin_(s) {
  var m = String(s == null ? '' : s).match(/^\s*(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

function minOfDay_(d) { var p = jst_(d); return p.h * 60 + p.mi; }

function toDate_(v) {
  if (isDate_(v)) return isNaN(v) ? null : v;
  if (v === '' || v == null) return null;
  // 「2026-11-12 10:00」のような文字は日本時間として読む（スクリプトのタイムゾーンに左右されないように）
  var m = String(v).match(/^\s*(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/);
  if (m) return jstDate_(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  var d = new Date(v);
  return isNaN(d) ? null : d;
}

function toYmd_(v) {
  if (!v) return '';
  if (isDate_(v)) return isNaN(v) ? '' : ymd_(v);
  var m = String(v).match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  return m ? m[1] + '-' + pad2_(+m[2]) + '-' + pad2_(+m[3]) : '';
}

function toHm_(v) {
  if (v === '' || v == null) return '';
  if (isDate_(v)) { var p = jst_(v); return pad2_(p.h) + ':' + pad2_(p.mi); }
  var m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? pad2_(+m[1]) + ':' + m[2] : '';
}

function tourStart_(c) {
  var day = toYmd_(c['催行日']), hm = toHm_(c['開始時刻']);
  if (!day || !hm) return null;
  var a = day.split('-'), b = hm.split(':');
  return jstDate_(+a[0], +a[1], +a[2], +b[0], +b[1]);
}

function inQuiet_(d, qs, qe) {
  var a = hmToMin_(qs), b = hmToMin_(qe), m = minOfDay_(d);
  if (a === null || b === null || a === b) return false;
  return a < b ? (m >= a && m < b) : (m >= a || m < b);
}

// d 以降で最初に来る「夜間の終了」時刻
function quietEndAfter_(d, qe) {
  var p = jst_(d), e = hmToMin_(qe);
  var t = jstDate_(p.y, p.mo, p.d, Math.floor(e / 60), e % 60);
  if (t.getTime() <= d.getTime()) t = new Date(t.getTime() + 24 * H_MS);
  return t;
}

// 予約の通知を受けてから、詳細を入力するまでの期限（夜間は朝に回す）
function detailDue_(received, cfg) {
  var base = inQuiet_(received, cfg.quietStart, cfg.quietEnd) ? quietEndAfter_(received, cfg.quietEnd) : received;
  var due = new Date(base.getTime() + cfg.inputMin * MIN_MS);
  if (inQuiet_(due, cfg.quietStart, cfg.quietEnd)) due = new Date(quietEndAfter_(due, cfg.quietEnd).getTime() + cfg.inputMin * MIN_MS);
  return due;
}

// リールの返信の期限（催行が近いときは短くする）
function replyDue_(from, tourStart, cfg) {
  if (!from) return null;
  var near = tourStart && (tourStart.getTime() - from.getTime()) < cfg.shortWindowHours * H_MS;
  return new Date(from.getTime() + (near ? cfg.shortReplyHours : cfg.replyHours) * H_MS);
}

function needsReminder_(now, due, last, cfg) {
  if (!due || now.getTime() < due.getTime()) return false;
  if (inQuiet_(now, cfg.quietStart, cfg.quietEnd)) return false;
  return !last || (now.getTime() - last.getTime()) >= cfg.remindMin * MIN_MS;
}

// ===== 通知メールの読み取り =====

var BOOKING_NO_RE = /[A-Z][A-Z0-9_]*-\d{8}-[A-Z0-9]{3,}/;

function parseLinktivityMail(subject, body) {
  var text = String(body || '').replace(/\r/g, '');
  var subj = String(subject || '');
  var event = null;
  if (/この予約はキャンセルされました|予約がキャンセルされ/.test(text) || /予約がキャンセル/.test(subj)) event = 'cancel';
  else if (/新規予約が入りました|予約が入りました/.test(text) || /予約が入りました/.test(subj)) event = 'new';

  var bookingNo = '';
  var m = text.match(new RegExp('(?:^|\\n)\\s*予約番号[\\s:：]*(' + BOOKING_NO_RE.source + ')'));
  if (m) bookingNo = m[1];
  if (!bookingNo) { m = subj.match(BOOKING_NO_RE); if (m) bookingNo = m[0]; }

  m = text.match(/代理店予約番号[\s:：]*([^\s]+)/);
  var agentNo = m ? m[1] : '';
  m = text.match(/PLAN名[ \t:：]*\n?[ \t]*([^\n]+)/);
  var plan = m ? m[1].trim() : '';
  m = text.match(/(?:^|\n)\s*(株式会社[^\n]+)/);
  var account = m ? m[1].trim() : '';
  m = text.match(/site=([A-Za-z_]+)/);
  var site = m ? m[1] : '';

  // 「予約番号」の直前の行が商品名
  var product = '';
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (/^\s*予約番号/.test(lines[i])) {
      for (var j = i - 1; j >= 0; j--) {
        var s = lines[j].trim();
        if (s) { product = s; break; }
      }
      break;
    }
  }
  return { event: event, bookingNo: bookingNo, agentNo: agentNo, plan: plan, product: product, account: account, site: site };
}

function channelOf_(bookingNo) {
  var prefix = String(bookingNo || '').split('-')[0];
  var map = {
    ARS_NINJAGORIDE: '公式直販', ARS_TRYHARD: 'NKT直販', ARS_TRIPLABO_WEB: 'TRIPLABO_WEB',
    VIATOR: 'Viator', KLOOK: 'Klook', GETYOURGUIDE: 'GetYourGuide', GYG: 'GetYourGuide'
  };
  return map[prefix] || prefix || '不明';
}

function timeOptions_(spec) {
  spec = String(spec || '').trim();
  var m = spec.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*\/\s*(\d+)$/);
  if (m) {
    var out = [], a = hmToMin_(m[1]), b = hmToMin_(m[2]), step = +m[3];
    for (var t = a; t <= b && step > 0; t += step) out.push(pad2_(Math.floor(t / 60)) + ':' + pad2_(t % 60));
    return out;
  }
  return spec ? spec.split(/[,、\s]+/).map(toHm_).filter(function (x) { return x; }) : [];
}

function toursFromRows_(rows) {
  return rows.filter(function (r) { return r[1]; }).map(function (r) {
    return {
      keywords: String(r[0] || '').split('|').map(function (s) { return s.trim(); }).filter(function (s) { return s; }),
      name: String(r[1]), meet: String(r[2] || ''), times: timeOptions_(r[3]), note: String(r[4] || '')
    };
  });
}

function matchTour_(text, tours) {
  text = String(text || '');
  for (var i = 0; i < tours.length; i++) {
    for (var k = 0; k < tours[i].keywords.length; k++) {
      if (text.indexOf(tours[i].keywords[k]) >= 0) return tours[i];
    }
  }
  return null;
}

function tourByName_(name, tours) {
  for (var i = 0; i < tours.length; i++) if (tours[i].name === name) return tours[i];
  return null;
}

function nextCaseId_(rows) {
  var max = 0;
  rows.forEach(function (c) {
    var m = String(c['案件ID']).match(/(\d+)$/);
    if (m) max = Math.max(max, +m[1]);
  });
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return 'NGT-' + n;
}

// ===== リールへのメール =====

function caseTag_(id) { return '［' + id + '］'; }

function mailSubject_(kind, c, cfg) {
  var label = kind === 'cancel' ? '【キャンセル】' : kind === 'change' ? '【変更】' : '【ご依頼】';
  var t = tourStart_(c);
  var when = t ? fmtDayJa_(t) + ' ' + toHm_(c['開始時刻']) : '日時未定';
  var tail = kind === 'order' ? 'ガイドご手配のお願い' : kind === 'change' ? 'ご予約内容の変更' : 'ご予約のキャンセル';
  return (cfg.subjectPrefix || '') + label + when + '「' + c['ツアー'] + '」' + tail + caseTag_(c['案件ID']);
}

function mailBody_(kind, c, tour, cfg) {
  var t = tourStart_(c);
  var lead = {
    order: '下記のとおり、ガイドのご手配をお願いいたします。',
    change: '下記のご予約の内容が変更になりました。最新の内容は下記のとおりです。ガイドのご手配の変更をお願いいたします。',
    cancel: '下記のご予約がキャンセルになりました。ガイドのご手配の取り消しをお願いいたします。\n担当ガイドが決まっている場合は、ガイドへのご連絡もお願いいたします。'
  }[kind];
  var lines = [
    cfg.salutation, '', 'いつも大変お世話になっております。NINJA GO TOURS です。', lead, '',
    '【ご予約の内容】',
    '・日時：' + (t ? fmtDayJa_(t) + ' ' + toHm_(c['開始時刻']) + ' 開始' : '未定'),
    '・ツアー：' + c['ツアー'],
    '・集合場所：' + (tour ? tour.meet : ''),
    '・予約番号：' + (c['予約番号'] || '（なし）') + '（台帳 ' + c['案件ID'] + '）',
    '・予約経路：' + (c['経路'] || ''),
    '',
    '＜お客様情報＞',
    '・代表者名：' + (c['代表者名'] || '') + ' 様',
    '・参加人数：大人' + (c['大人'] || 0) + '名（12歳以下 ' + (c['子ども'] || 0) + '名）',
    '・連絡先：' + (c['連絡先'] || '')
  ];
  if (c['メモ']) lines.push('・備考：' + c['メモ']);
  if (tour && tour.note) lines.push('・注意：' + tour.note);
  lines.push('');
  lines.push(kind === 'cancel'
    ? 'ご確認いただけましたら、このメールにご返信ください。'
    : 'ご手配いただけましたら、このメールにご返信ください（担当ガイドのお名前もお知らせいただけますと幸いです）。');
  lines.push('');
  lines.push(cfg.signature);
  return lines.join('\n');
}

// ===== 設定 =====

function splitList_(v) {
  return String(v || '').split(/[,、\s]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}

function num_(v, d) { var n = Number(v); return isFinite(n) && String(v).trim() !== '' ? n : d; }

function normalizeSettings_(raw) {
  var mode = String(raw['発注のしかた'] || '').trim();
  return {
    notifyTo: splitList_(raw['通知先メール']),
    line: /^on$/i.test(String(raw['LINE通知'] || '').trim()),
    since: toDate_(raw['取り込み開始']),
    inputMin: num_(raw['入力の期限（分）'], 120),
    orderMin: num_(raw['発注の期限（分）'], 30),
    remindMin: num_(raw['催促の間隔（分）'], 60),
    quietStart: toHm_(raw['夜間の開始']) || '22:00',
    quietEnd: toHm_(raw['夜間の終了']) || '08:00',
    orderMode: mode === '自動送信' ? 'send' : mode === 'しない' ? 'none' : 'draft',
    reeluTo: splitList_(raw['リールの宛先']),
    reeluCc: splitList_(raw['リールのCC']),
    reeluDomain: String(raw['リールのドメイン'] || 'reelu.jp').trim(),
    salutation: String(raw['発注メールの宛名'] || '株式会社Reelu\nご担当者様'),
    subjectPrefix: String(raw['発注メールの件名の先頭'] || ''),
    orderCc: splitList_(raw['発注メールのCC']),
    signature: String(raw['発注メールの署名'] || 'NINJA GO TOURS'),
    replyHours: num_(raw['返信の期限（時間）'], 24),
    shortReplyHours: num_(raw['直前の返信の期限（時間）'], 2),
    shortWindowHours: num_(raw['直前とみなす時間'], 48)
  };
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function settings_() {
  var raw = {};
  SETTING_DEFAULTS.forEach(function (r) { raw[r[0]] = r[1]; });
  var sh = ss_().getSheetByName(SHEETS.SETTINGS);
  if (sh) {
    sh.getDataRange().getValues().slice(1).forEach(function (r) {
      if (r[0] !== '' && r[0] != null) raw[String(r[0])] = r[1];
    });
  }
  return normalizeSettings_(raw);
}

function tours_() {
  var sh = ss_().getSheetByName(SHEETS.TOURS);
  return sh ? toursFromRows_(sh.getDataRange().getValues().slice(1)) : toursFromRows_(TOUR_DEFAULTS);
}

// ===== 台帳の読み書き =====

function ledger_() {
  var sh = ss_().getSheetByName(SHEETS.LEDGER);
  var values = sh.getDataRange().getValues();
  var head = values[0];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 };
    for (var i = 0; i < head.length; i++) o[head[i]] = values[r][i];
    if (o['案件ID']) rows.push(o);
  }
  return { sh: sh, head: head, rows: rows };
}

function saveCase_(L, c) {
  var arr = L.head.map(function (h) { var v = c[h]; return v === undefined || v === null ? '' : v; });
  L.sh.getRange(c._row, 1, 1, arr.length).setValues([arr]);
}

function appendCase_(L, c) {
  c._row = L.sh.getLastRow() + 1;
  saveCase_(L, c);
  L.rows.push(c);
  return c;
}

function findByBooking_(L, bookingNo) {
  var hit = null;
  L.rows.forEach(function (c) { if (bookingNo && c['予約番号'] === bookingNo) hit = c; });
  return hit;
}

function findCase_(L, id) {
  for (var i = 0; i < L.rows.length; i++) if (L.rows[i]['案件ID'] === id) return L.rows[i];
  return null;
}

function setStatus_(c, st) {
  if (c['状態'] !== st) { c['状態'] = st; c['最終催促'] = ''; c['催促回数'] = 0; }
}

function log_(kind, c, text, msgId) {
  var sh = ss_().getSheetByName(SHEETS.LOG);
  if (!sh) return;
  sh.appendRow([now_(), kind, c ? c['案件ID'] : '', c ? c['予約番号'] : '', text, msgId || '']);
}

function processedIds_() {
  var set = {};
  var sh = ss_().getSheetByName(SHEETS.LOG);
  if (!sh) return set;
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][5]) set[String(v[i][5])] = true;
  return set;
}

// ===== 通知（メール・LINE）=====

function appUrl_() {
  try { var u = ScriptApp.getService().getUrl(); if (u) return u; } catch (e) { /* 未デプロイ */ }
  return '';
}

function caseUrl_(c) {
  var u = appUrl_();
  return u ? u + '?id=' + encodeURIComponent(c['案件ID']) + '&k=' + encodeURIComponent(c['トークン']) : '';
}

function listUrl_() {
  var u = appUrl_();
  var k = PropertiesService.getScriptProperties().getProperty('LIST_TOKEN');
  return u && k ? u + '?k=' + encodeURIComponent(k) : '';
}

function gmailUrl_(msgId) { return msgId ? 'https://mail.google.com/mail/u/0/#all/' + msgId : ''; }

// opts: { line: true/false, urgent: true/false }
function notify_(cfg, subject, lines, opts) {
  opts = opts || {};
  var title = (opts.urgent ? '【至急】' : '') + '【NGT 手配】' + subject;
  var body = lines.filter(function (s) { return s !== null && s !== undefined; }).join('\n');
  var list = listUrl_();
  if (list) body += '\n\n台帳の一覧：' + list;
  if (cfg.notifyTo.length) {
    MailApp.sendEmail({ to: cfg.notifyTo.join(','), subject: title, body: body, name: 'NGT 手配ボード' });
  }
  if (opts.line && cfg.line) sendLine_(title + '\n' + (opts.lineText || ''));
}

function sendLine_(text) {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('LINE_TOKEN');
  var to = p.getProperty('LINE_TO');
  if (!token || !to) return false;
  var broadcast = to === 'broadcast';
  var url = 'https://api.line.me/v2/bot/message/' + (broadcast ? 'broadcast' : 'push');
  var payload = { messages: [{ type: 'text', text: String(text).slice(0, 4900) }] };
  if (!broadcast) payload.to = to;
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(payload)
  });
  if (res.getResponseCode() !== 200) log_('LINE送信エラー', null, res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  return res.getResponseCode() === 200;
}

// LINE には、お客様の名前を載せない
function lineText_(c, extra) {
  var t = tourStart_(c);
  return [c['案件ID'] + '（' + (c['ツアー'] || c['PLAN名'] || '') + '）', t ? '催行 ' + fmtDT_(t) : null, extra || null, caseUrl_(c) || null]
    .filter(function (s) { return s; }).join('\n');
}

function caseLines_(c) {
  var t = tourStart_(c);
  return [
    '案件：' + c['案件ID'] + '（' + c['状態'] + '）',
    '予約番号：' + (c['予約番号'] || '') + '（' + (c['経路'] || '') + '）',
    'ツアー：' + (c['ツアー'] || '未判定') + (c['PLAN名'] ? '\nPLAN名：' + c['PLAN名'] : ''),
    '催行：' + (t ? fmtDT_(t) : '未入力') + (c['大人'] ? '　大人' + c['大人'] + '名' : ''),
    caseUrl_(c) ? '入力・確認：' + caseUrl_(c) : '（ウェブアプリが未デプロイのため、台帳のシートで直接入力してください）'
  ];
}

// ===== メールの送信・下書き・検出 =====

function epochSec_(d) { return Math.floor(d.getTime() / 1000); }

// リールへのメールを用意する。戻り値：'sent' | 'draft' | 'skip'
function prepareMail_(kind, c, tours, cfg) {
  if (cfg.orderMode === 'none') return 'skip';
  if (!cfg.reeluTo.length) {
    log_('設定不足', c, '設定シートの「リールの宛先」が空のため、発注メールを用意できません');
    return 'skip';
  }
  var tour = tourByName_(c['ツアー'], tours);
  var subject = mailSubject_(kind, c, cfg);
  var body = mailBody_(kind, c, tour, cfg);
  var cc = cfg.reeluCc.concat(cfg.orderCc).join(',');
  var opts = { name: 'NINJA GO TOURS' };
  if (cc) opts.cc = cc;
  var draft = GmailApp.createDraft(cfg.reeluTo.join(','), subject, body, opts);
  if (cfg.orderMode === 'send') {
    var msg = draft.send();
    c['発注スレッドID'] = msg.getThread().getId();
    c['下書きID'] = '';
    return 'sent';
  }
  c['下書きID'] = draft.getId();
  return 'draft';
}

function deleteDraft_(c) {
  if (!c['下書きID']) return;
  try { GmailApp.getDraft(c['下書きID']).deleteDraft(); } catch (e) { /* 送信済み・削除済み */ }
  c['下書きID'] = '';
}

// 自分が送った、この案件のメール（件名に案件IDと見出しを含む）を探す
function findSent_(c, label, since) {
  var q = 'in:sent "' + c['案件ID'] + '" after:' + epochSec_(since);
  var threads = GmailApp.search(q, 0, 10);
  var hit = null;
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (m.getDate().getTime() >= since.getTime() && m.getSubject().indexOf(c['案件ID']) >= 0 && m.getSubject().indexOf(label) >= 0) {
        if (!hit || m.getDate() < hit.getDate()) hit = m;
      }
    });
  });
  return hit;
}

// リールのドメインから届いた、この案件についてのメールを探す
function findReply_(c, since, cfg) {
  var q = 'from:' + cfg.reeluDomain + ' "' + c['案件ID'] + '" after:' + epochSec_(since);
  var threads = GmailApp.search(q, 0, 10);
  var hit = null;
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (m.getDate().getTime() > since.getTime() && String(m.getFrom()).toLowerCase().indexOf(cfg.reeluDomain.toLowerCase()) >= 0) {
        if (!hit || m.getDate() < hit.getDate()) hit = m;
      }
    });
  });
  return hit;
}

// ===== 取り込み（5分おきのトリガーで実行）=====

function poll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var cfg = settings_(), tours = tours_(), L = ledger_();
    intake_(cfg, tours, L);
    advance_(cfg, tours, L);
    remind_(cfg, L);
  } finally {
    lock.releaseLock();
  }
}

function label_(name) { return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name); }

function intake_(cfg, tours, L) {
  var done = processedIds_();
  var threads = GmailApp.search(MAIL_QUERY + ' -label:' + LABEL_DONE.replace('/', '-') + ' -label:' + LABEL_ERROR.replace('/', '-') + ' newer_than:30d', 0, 50);
  var lDone = label_(LABEL_DONE), lErr = label_(LABEL_ERROR);
  threads.forEach(function (th) {
    var bad = false;
    th.getMessages().forEach(function (m) {
      var id = m.getId();
      if (done[id]) return;
      if (cfg.since && m.getDate().getTime() < cfg.since.getTime()) { log_('対象外（取り込み開始より前）', null, m.getSubject(), id); return; }
      var p = parseLinktivityMail(m.getSubject(), m.getPlainBody());
      if (!p.event || !p.bookingNo) {
        bad = true;
        log_('読み取れない通知', null, m.getSubject(), id);
        notify_(cfg, '読み取れない通知メールがあります', [
          '件名：' + m.getSubject(), '受信：' + fmtDT_(m.getDate()),
          'メール：' + gmailUrl_(id),
          '予約か、キャンセルか、どの予約かを確認し、必要なら台帳に手で追加してください。'
        ], { line: true, urgent: true, lineText: '件名：' + m.getSubject() });
        return;
      }
      if (p.event === 'new') onNew_(p, m, cfg, tours, L);
      else onCancel_(p, m, cfg, tours, L);
    });
    th.addLabel(bad ? lErr : lDone);
  });
}

function onNew_(p, m, cfg, tours, L) {
  var id = m.getId();
  var exist = findByBooking_(L, p.bookingNo);
  if (exist && exist['状態'] !== ST.CX_UNKNOWN) { log_('重複（取り込み済みの予約）', exist, m.getSubject(), id); return; }
  var tour = matchTour_(p.plan + '\n' + p.product, tours);
  if (!tour && /TryHard/i.test(p.account + p.bookingNo)) { log_('対象外（NGT以外の NKT 予約）', null, p.plan, id); return; }
  var received = m.getDate();
  var c = {
    '案件ID': nextCaseId_(L.rows), '状態': ST.WAIT_DETAIL, '予約番号': p.bookingNo, '代理店予約番号': p.agentNo,
    '経路': channelOf_(p.bookingNo), 'アカウント': p.account, 'PLAN名': p.plan || p.product, 'ツアー': tour ? tour.name : '',
    '催行日': '', '開始時刻': '', '大人': '', '子ども': '', '代表者名': '', '連絡先': '', 'メモ': '',
    '受信日時': received, '入力の期限': detailDue_(received, cfg), '入力日時': '', '発注日時': '', 'リール返信日時': '',
    'キャンセル受信日時': '', 'キャンセル連絡日時': '', '最終催促': '', '催促回数': 0,
    '元メールID': id, '発注スレッドID': '', '下書きID': '', 'トークン': Utilities.getUuid()
  };
  appendCase_(L, c);
  log_('新しい予約', c, p.plan, id);
  notify_(cfg, '新しい予約：詳細を入力してください（' + c['案件ID'] + '）', [
    'LINKTIVITY の管理画面で予約番号 ' + c['予約番号'] + ' を検索し、日時・人数・代表者名・連絡先を入力してください。',
    '入力の期限：' + fmtDT_(c['入力の期限']),
    ''
  ].concat(caseLines_(c)).concat(['通知メール：' + gmailUrl_(id)]), { line: true, lineText: lineText_(c, '詳細を入力してください（期限 ' + fmtDT_(c['入力の期限']) + '）') });
}

function onCancel_(p, m, cfg, tours, L) {
  var id = m.getId();
  var c = findByBooking_(L, p.bookingNo);
  var at = m.getDate();
  if (!c) {
    var tour = matchTour_(p.plan + '\n' + p.product, tours);
    if (!tour && /TryHard/i.test(p.account + p.bookingNo)) { log_('対象外（NGT以外の NKT キャンセル）', null, p.plan, id); return; }
    c = {
      '案件ID': nextCaseId_(L.rows), '状態': ST.CX_UNKNOWN, '予約番号': p.bookingNo, '代理店予約番号': p.agentNo,
      '経路': channelOf_(p.bookingNo), 'アカウント': p.account, 'PLAN名': p.plan || p.product, 'ツアー': tour ? tour.name : '',
      '受信日時': '', 'キャンセル受信日時': at, '最終催促': now_(), '催促回数': 1, '元メールID': id, 'トークン': Utilities.getUuid()
    };
    appendCase_(L, c);
    log_('台帳にない予約のキャンセル', c, p.plan, id);
    notify_(cfg, '台帳にない予約のキャンセルです（' + p.bookingNo + '）', [
      'この仕組みを入れる前の予約か、取り込めなかった予約のキャンセルです。',
      'リールにガイドを手配していないか、今までの発注メールを確認してください。手配していたら、リールにキャンセルを連絡してください。',
      ''
    ].concat(caseLines_(c)).concat(['通知メール：' + gmailUrl_(id)]), { line: true, urgent: true, lineText: lineText_(c, '台帳にない予約のキャンセル。リールへの手配の有無を確認してください') });
    return;
  }
  if (c['キャンセル受信日時']) { log_('重複（取り込み済みのキャンセル）', c, '', id); return; }
  c['キャンセル受信日時'] = at;
  var st = c['状態'];
  if (st === ST.WAIT_DETAIL || (st === ST.WAIT_ORDER && !c['発注日時'])) {
    deleteDraft_(c);
    setStatus_(c, ST.CX_NO_ORDER);
    saveCase_(L, c);
    log_('キャンセル（未発注）', c, '', id);
    notify_(cfg, 'キャンセル（まだ発注していない予約）：' + c['案件ID'], ['リールへの連絡は不要です。'].concat(caseLines_(c)), { line: false });
    return;
  }
  if (st === ST.WAIT_ORDER || st === ST.WAIT_REPLY || st === ST.ARRANGED) {
    deleteDraft_(c);
    setStatus_(c, ST.CX_WAIT_SEND);
    var r = prepareMail_('cancel', c, tours, cfg);
    if (r === 'sent') { c['キャンセル連絡日時'] = now_(); setStatus_(c, ST.CX_WAIT_REPLY); }
    saveCase_(L, c);
    log_('キャンセル（発注済み）', c, r, id);
    notify_(cfg, 'キャンセル：リールへの連絡が必要です（' + c['案件ID'] + '）', [
      r === 'sent' ? 'リールにキャンセルのメールを送りました。リールの返信を待ちます。'
        : r === 'draft' ? 'この Gmail の下書きに、リールへのキャンセルのメールを作りました。内容を確認して送ってください。'
          : 'リールにキャンセルを連絡してください。',
      ''
    ].concat(caseLines_(c)), { line: true, urgent: true, lineText: lineText_(c, 'キャンセル。リールへの連絡が必要です') });
    return;
  }
  saveCase_(L, c);
  log_('キャンセル（対応不要）', c, '状態：' + st, id);
}

// ===== 状態を進める =====

function advance_(cfg, tours, L) {
  var now = now_();
  L.rows.forEach(function (c) {
    var st = c['状態'];
    var changed = false;

    // 台帳のシートに直接入力された場合も、入力済みとして扱う
    if (st === ST.WAIT_DETAIL && toYmd_(c['催行日']) && toHm_(c['開始時刻']) && Number(c['大人']) > 0) {
      c['入力日時'] = c['入力日時'] || now;
      setStatus_(c, ST.WAIT_ORDER);
      st = c['状態'];
      changed = true;
    }

    if (st === ST.WAIT_ORDER) {
      if (!c['下書きID'] && cfg.orderMode !== 'none' && cfg.reeluTo.length) {
        var r = prepareMail_(c['発注日時'] ? 'change' : 'order', c, tours, cfg);
        if (r === 'sent') { c['発注日時'] = now; setStatus_(c, ST.WAIT_REPLY); }
        changed = changed || r !== 'skip';
      } else {
        var since = toDate_(c['入力日時']) || toDate_(c['受信日時']) || now;
        var sent = findSent_(c, c['発注日時'] ? '【変更】' : '【ご依頼】', since);
        if (sent) {
          c['発注日時'] = sent.getDate();
          c['発注スレッドID'] = sent.getThread().getId();
          c['下書きID'] = '';
          setStatus_(c, ST.WAIT_REPLY);
          log_('発注メールの送信を確認', c, sent.getSubject());
          changed = true;
        }
      }
    }

    if (c['状態'] === ST.WAIT_REPLY) {
      var reply = findReply_(c, toDate_(c['発注日時']) || now, cfg);
      if (reply) {
        c['リール返信日時'] = reply.getDate();
        setStatus_(c, ST.ARRANGED);
        log_('リールの返信を確認', c, reply.getSubject());
        changed = true;
      }
    }

    if (c['状態'] === ST.CX_WAIT_SEND) {
      var since2 = toDate_(c['キャンセル受信日時']) || now;
      var sentCx = findSent_(c, '【キャンセル】', since2);
      if (sentCx) {
        c['キャンセル連絡日時'] = sentCx.getDate();
        c['下書きID'] = '';
        setStatus_(c, ST.CX_WAIT_REPLY);
        log_('キャンセルの連絡を確認', c, sentCx.getSubject());
        changed = true;
      }
    }

    if (c['状態'] === ST.CX_WAIT_REPLY) {
      var replyCx = findReply_(c, toDate_(c['キャンセル連絡日時']) || now, cfg);
      if (replyCx) {
        c['リール返信日時'] = replyCx.getDate();
        setStatus_(c, ST.CX_DONE);
        log_('リールのキャンセル確認を確認', c, replyCx.getSubject());
        changed = true;
      }
    }

    if (c['状態'] === ST.ARRANGED) {
      var t = tourStart_(c);
      if (t && now.getTime() > t.getTime() + 3 * H_MS) { setStatus_(c, ST.DONE); changed = true; }
    }

    if (changed) saveCase_(L, c);
  });
}

// ===== 催促 =====

function dueOf_(c, cfg) {
  var t = tourStart_(c);
  switch (c['状態']) {
    case ST.WAIT_DETAIL: return { due: toDate_(c['入力の期限']), msg: '詳細の入力が遅れています。LINKTIVITY の管理画面で予約番号を検索し、入力してください。' };
    case ST.WAIT_ORDER: {
      var base = toDate_(c['入力日時']);
      return { due: base ? new Date(base.getTime() + cfg.orderMin * MIN_MS) : null, msg: 'リールへの発注メールがまだ送られていません。' + (cfg.orderMode === 'draft' ? 'この Gmail の下書きを確認して送ってください。' : '') };
    }
    case ST.WAIT_REPLY: return { due: replyDue_(toDate_(c['発注日時']), t, cfg), msg: 'リールから返信がありません。電話で手配の状況を確認してください。返信を確認したら「リールの返信を確認した」を押してください。' };
    case ST.CX_WAIT_SEND: {
      var b2 = toDate_(c['キャンセル受信日時']);
      return { due: b2 ? new Date(b2.getTime() + cfg.orderMin * MIN_MS) : null, msg: 'リールへのキャンセルの連絡がまだです。' };
    }
    case ST.CX_WAIT_REPLY: return { due: replyDue_(toDate_(c['キャンセル連絡日時']), t, cfg), msg: 'リールからキャンセルの返信がありません。ガイドが集合場所に向かわないよう、電話で確認してください。' };
    case ST.CX_UNKNOWN: return { due: toDate_(c['キャンセル受信日時']), msg: '台帳にない予約のキャンセルです。リールに手配していないか確認し、済んだら「確認した」を押してください。' };
    default: return { due: null, msg: '' };
  }
}

function remind_(cfg, L) {
  var now = now_();
  L.rows.forEach(function (c) {
    var d = dueOf_(c, cfg);
    if (!needsReminder_(now, d.due, toDate_(c['最終催促']), cfg)) return;
    var count = Number(c['催促回数']) || 0;
    var t = tourStart_(c);
    var urgent = !!(t && t.getTime() - now.getTime() < 24 * H_MS);
    var useLine = count === 0 || count % 3 === 0 || urgent;
    notify_(cfg, (count ? '催促（' + (count + 1) + '回目）：' : '期限切れ：') + c['案件ID'] + ' ' + c['状態'],
      [d.msg, '期限：' + fmtDT_(d.due), ''].concat(caseLines_(c)),
      { line: useLine, urgent: urgent, lineText: lineText_(c, c['状態'] + '：' + d.msg) });
    c['最終催促'] = now;
    c['催促回数'] = count + 1;
    saveCase_(L, c);
  });
}

// ===== 毎朝のまとめ =====

function dailyDigest() {
  var cfg = settings_(), L = ledger_(), now = now_();
  var open = [ST.WAIT_DETAIL, ST.WAIT_ORDER, ST.WAIT_REPLY, ST.CX_WAIT_SEND, ST.CX_WAIT_REPLY, ST.CX_UNKNOWN];
  var lines = [];
  open.forEach(function (st) {
    var cs = L.rows.filter(function (c) { return c['状態'] === st; });
    if (!cs.length) return;
    lines.push('■ ' + st + '（' + cs.length + '件）');
    cs.forEach(function (c) {
      var t = tourStart_(c);
      lines.push('・' + c['案件ID'] + '　' + (c['ツアー'] || c['PLAN名']) + '　' + (t ? fmtDT_(t) : '日時未入力') + '　' + (caseUrl_(c) || ''));
    });
    lines.push('');
  });
  var soon = L.rows.filter(function (c) {
    var t = tourStart_(c);
    return t && (c['状態'] === ST.ARRANGED || c['状態'] === ST.WAIT_REPLY) && t.getTime() > now.getTime() && t.getTime() - now.getTime() < 3 * 24 * H_MS;
  }).sort(function (a, b) { return tourStart_(a) - tourStart_(b); });
  if (soon.length) {
    lines.push('■ 3日以内のツアー');
    soon.forEach(function (c) { lines.push('・' + fmtDT_(tourStart_(c)) + '　' + c['ツアー'] + '　大人' + c['大人'] + '名　' + c['状態']); });
  }
  if (!lines.length) lines.push('対応が必要な案件はありません。');
  notify_(cfg, '今日のまとめ（' + fmtDayJa_(now) + '）', lines, { line: false });
}

// ===== ウェブ画面 =====

function doGet(e) {
  var p = (e && e.parameter) || {};
  var view = { page: 'error', msg: 'リンクが正しくありません。通知メールのリンクから開いてください。' };
  var L = ledger_();
  if (p.id) {
    var c = findCase_(L, p.id);
    if (c && p.k && p.k === c['トークン']) view = { page: 'case', data: caseView_(c, settings_(), tours_()) };
  } else if (p.k && p.k === PropertiesService.getScriptProperties().getProperty('LIST_TOKEN')) {
    view = { page: 'list', data: listView_(L, settings_()) };
  }
  var t = INDEX_HTML ? HtmlService.createTemplate(INDEX_HTML) : HtmlService.createTemplateFromFile('Index');
  t.view = JSON.stringify(view).replace(/</g, '\\u003c');
  return t.evaluate().setTitle('NGT 手配ボード').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// LINE の Webhook（グループに招待したときにグループIDを覚える）
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    (body.events || []).forEach(function (ev) {
      var gid = ev.source && (ev.source.groupId || ev.source.roomId);
      if (gid && !props.getProperty('LINE_TO')) {
        props.setProperty('LINE_TO', gid);
        log_('LINE', null, 'LINE のグループを通知先に登録しました');
      }
    });
  } catch (err) { /* LINE 以外の POST は無視 */ }
  return ContentService.createTextOutput('OK');
}

function caseView_(c, cfg, tours) {
  var d = dueOf_(c, cfg);
  return {
    id: c['案件ID'], token: c['トークン'], status: c['状態'], bookingNo: c['予約番号'], channel: c['経路'],
    plan: c['PLAN名'], tour: c['ツアー'], date: toYmd_(c['催行日']), time: toHm_(c['開始時刻']),
    adults: c['大人'] === '' ? '' : Number(c['大人']), children: c['子ども'] === '' ? 0 : Number(c['子ども']),
    guest: c['代表者名'], contact: c['連絡先'], memo: c['メモ'],
    received: fmtDT_(toDate_(c['受信日時'])), due: d.due ? fmtDT_(d.due) : '', dueMsg: d.msg,
    overdue: !!(d.due && now_().getTime() >= d.due.getTime()),
    orderedAt: fmtDT_(toDate_(c['発注日時'])), repliedAt: fmtDT_(toDate_(c['リール返信日時'])),
    cancelAt: fmtDT_(toDate_(c['キャンセル受信日時'])), mode: cfg.orderMode,
    tours: tours.map(function (t) { return { name: t.name, times: t.times, meet: t.meet, note: t.note }; }),
    listUrl: listUrl_(), ST: ST
  };
}

function listView_(L, cfg) {
  var now = now_();
  var items = L.rows.map(function (c) {
    var d = dueOf_(c, cfg), t = tourStart_(c);
    return {
      id: c['案件ID'], url: caseUrl_(c), status: c['状態'], tour: c['ツアー'] || c['PLAN名'], when: t ? fmtDT_(t) : '',
      ts: t ? t.getTime() : 0, adults: c['大人'], due: d.due ? fmtDT_(d.due) : '',
      overdue: !!(d.due && now.getTime() >= d.due.getTime()), channel: c['経路']
    };
  });
  return { items: items, now: fmtDT_(now), ST: ST };
}

function checkCase_(L, id, token) {
  var c = findCase_(L, id);
  if (!c || !token || token !== c['トークン']) throw new Error('リンクが正しくありません。');
  return c;
}

// 画面の「保存」
function apiSave(id, token, data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cfg = settings_(), tours = tours_(), L = ledger_();
    var c = checkCase_(L, id, token);
    var day = toYmd_(data.date), hm = toHm_(data.time), adults = Number(data.adults), kids = Number(data.children || 0);
    if (!tourByName_(data.tour, tours)) throw new Error('ツアーを選んでください。');
    if (!day) throw new Error('催行日を入れてください。');
    if (!hm) throw new Error('開始時刻を入れてください。');
    if (!(adults >= 1)) throw new Error('大人の人数を1以上で入れてください。');
    if (!(kids >= 0)) throw new Error('子どもの人数を0以上で入れてください。');
    var key = function (o) { return [o['ツアー'], toYmd_(o['催行日']), toHm_(o['開始時刻']), Number(o['大人']), Number(o['子ども'] || 0)].join('|'); };
    var before = key(c);
    var a = day.split('-');
    c['ツアー'] = data.tour;
    c['催行日'] = jstDate_(+a[0], +a[1], +a[2], 0, 0);
    c['開始時刻'] = hm;
    c['大人'] = adults;
    c['子ども'] = kids;
    c['代表者名'] = String(data.guest || '').trim();
    c['連絡先'] = String(data.contact || '').trim();
    c['メモ'] = String(data.memo || '').trim();
    var st = c['状態'], msg = '保存しました。';
    var ordered = st === ST.WAIT_REPLY || st === ST.ARRANGED;
    if (st === ST.WAIT_DETAIL || (ordered && before !== key(c)) || st === ST.WAIT_ORDER) {
      if (ordered || (st === ST.WAIT_ORDER && c['発注日時'])) msg = '変更を保存しました。';
      if (st !== ST.WAIT_ORDER || !c['下書きID']) {
        c['入力日時'] = now_();
        deleteDraft_(c);
        setStatus_(c, ST.WAIT_ORDER);
        var r = prepareMail_(c['発注日時'] ? 'change' : 'order', c, tours, cfg);
        if (r === 'sent') { c['発注日時'] = now_(); setStatus_(c, ST.WAIT_REPLY); msg += 'リールにメールを送りました。'; }
        else if (r === 'draft') msg += 'この Gmail の下書きに、リールへのメールを作りました。内容を確認して送ってください。';
        else msg += 'リールへの発注を、いつもの方法で行ってください。';
      } else {
        // 下書きがある状態で直したときは、下書きを作り直す
        deleteDraft_(c);
        var r2 = prepareMail_(c['発注日時'] ? 'change' : 'order', c, tours, cfg);
        if (r2 === 'draft') msg += '下書きを作り直しました。';
      }
    }
    saveCase_(L, c);
    log_('画面で保存', c, msg);
    return { msg: msg, view: caseView_(c, cfg, tours) };
  } finally {
    lock.releaseLock();
  }
}

// 画面のボタン
function apiAction(id, token, action) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cfg = settings_(), tours = tours_(), L = ledger_();
    var c = checkCase_(L, id, token);
    var now = now_(), st = c['状態'], msg = '';
    if (action === 'test' && (st === ST.WAIT_DETAIL || st === ST.WAIT_ORDER) && !c['発注日時']) {
      deleteDraft_(c); setStatus_(c, ST.TEST); msg = 'テスト予約として閉じました。';
    } else if (action === 'ordered' && st === ST.WAIT_ORDER) {
      deleteDraft_(c); c['発注日時'] = now; setStatus_(c, ST.WAIT_REPLY); msg = '発注済みにしました。リールの返信を待ちます。';
    } else if (action === 'acked' && st === ST.WAIT_REPLY) {
      c['リール返信日時'] = now; setStatus_(c, ST.ARRANGED); msg = '手配済みにしました。';
    } else if (action === 'cx_sent' && st === ST.CX_WAIT_SEND) {
      deleteDraft_(c); c['キャンセル連絡日時'] = now; setStatus_(c, ST.CX_WAIT_REPLY); msg = 'キャンセルを連絡済みにしました。リールの返信を待ちます。';
    } else if (action === 'cx_acked' && (st === ST.CX_WAIT_REPLY || st === ST.CX_UNKNOWN || st === ST.CX_WAIT_SEND)) {
      deleteDraft_(c); c['リール返信日時'] = now; setStatus_(c, ST.CX_DONE); msg = 'キャンセルの対応を完了にしました。';
    } else {
      throw new Error('この状態ではその操作はできません（いまの状態：' + st + '）。');
    }
    saveCase_(L, c);
    log_('画面の操作', c, msg);
    return { msg: msg, view: caseView_(c, cfg, tours) };
  } finally {
    lock.releaseLock();
  }
}

// ===== 初期設定 =====

function onOpen() {
  SpreadsheetApp.getUi().createMenu('NGT 手配ボード')
    .addItem('今すぐ通知メールを取り込む', 'poll')
    .addItem('一覧ページのリンクを表示', 'showListLink')
    .addItem('今日のまとめを送る', 'dailyDigest')
    .addSeparator()
    .addItem('初期設定（最初に1回）', 'setup')
    .addToUi();
}

function showListLink() {
  var u = listUrl_();
  SpreadsheetApp.getUi().alert(u ? '一覧ページ：\n' + u : 'ウェブアプリをデプロイすると、一覧ページのリンクが表示されます（README の手順4）。');
}

function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone('Asia/Tokyo');

  var led = ss.getSheetByName(SHEETS.LEDGER) || ss.insertSheet(SHEETS.LEDGER);
  if (led.getLastRow() === 0) led.appendRow(LEDGER_HEADERS);
  led.setFrozenRows(1);
  var col = function (name) { return LEDGER_HEADERS.indexOf(name) + 1; };
  var rows = led.getMaxRows();
  led.getRange(2, col('催行日'), rows - 1, 1).setNumberFormat('yyyy-mm-dd');
  ['開始時刻', '予約番号', '代理店予約番号', 'トークン', '元メールID', '発注スレッドID', '下書きID'].forEach(function (n) {
    led.getRange(2, col(n), rows - 1, 1).setNumberFormat('@');
  });
  ['受信日時', '入力の期限', '入力日時', '発注日時', 'リール返信日時', 'キャンセル受信日時', 'キャンセル連絡日時', '最終催促'].forEach(function (n) {
    led.getRange(2, col(n), rows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  });

  var tours = ss.getSheetByName(SHEETS.TOURS) || ss.insertSheet(SHEETS.TOURS);
  if (tours.getLastRow() === 0) {
    tours.appendRow(TOUR_HEADERS);
    tours.getRange(2, 1, TOUR_DEFAULTS.length, TOUR_HEADERS.length).setNumberFormat('@').setValues(TOUR_DEFAULTS);
    tours.getRange(1, 1).setNote('PLAN名・商品名に含まれる文字。| で区切ると、どれか1つ。上の行から順に照合します。');
    tours.getRange(1, 4).setNote('「17:00-21:30/30」＝17:00から21:30まで30分おき。「16:30,19:30」のように並べても可。');
  }
  tours.setFrozenRows(1);

  var set = ss.getSheetByName(SHEETS.SETTINGS) || ss.insertSheet(SHEETS.SETTINGS);
  if (set.getLastRow() === 0) {
    set.appendRow(['項目', '値', '説明']);
    var seed = SETTING_DEFAULTS.map(function (r) {
      return [r[0], Object.prototype.hasOwnProperty.call(SETTING_OVERRIDES, r[0]) ? String(SETTING_OVERRIDES[r[0]]) : r[1], r[2]];
    });
    set.getRange(2, 1, seed.length, 3).setNumberFormat('@').setValues(seed);
  }
  set.setFrozenRows(1);
  // 取り込み開始が空なら、いまを入れる（過去の通知メールをまとめて取り込まないため）
  var sv = set.getDataRange().getValues();
  for (var i = 1; i < sv.length; i++) {
    if (sv[i][0] === '取り込み開始' && !sv[i][1]) set.getRange(i + 1, 2).setValue(Utilities.formatDate(now_(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm'));
  }

  var log = ss.getSheetByName(SHEETS.LOG) || ss.insertSheet(SHEETS.LOG);
  if (log.getLastRow() === 0) log.appendRow(LOG_HEADERS);
  log.setFrozenRows(1);

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('LIST_TOKEN')) props.setProperty('LIST_TOKEN', Utilities.getUuid());

  label_(LABEL_DONE);
  label_(LABEL_ERROR);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['poll', 'dailyDigest'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('poll').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('dailyDigest').timeBased().atHour(9).everyDays(1).inTimezone('Asia/Tokyo').create();

  log_('初期設定', null, 'シート・トリガー・ラベルを用意しました');
}
