/**
 * NGT 手配ボード（台帳）第2版
 *
 * 共有アカウント（info_ninja-go-ride@ninja-kabukitokyo.com）の Google スプレッドシートに入れて使う
 * Google Apps Script。手順は同じフォルダの README.md を参照。追加の費用はかからない。
 *
 * 1日の流れ（2026-11-16 Kiranah Resort 加藤様と合意した仕様）
 *  12:00 キラナが LINKTIVITY から「本日以降の確定予約」の CSV を2つ書き出し、置き場フォルダに入れる
 *        ・kiranah-resort-…csv（NGT）… すべて取り込む
 *        ・tryhard-…csv（NKT）… セット商品（ローカルツアーセット）だけ取り込む
 *        → 新しい予約は「新規（リールの受注待ち）」、CSV から消えた予約は「キャンセル」として台帳に出る
 *  13:00 リールが「対応一覧」を見て、新規に ①受注 ✓ → ガイドを手配して ②手配完了 ✓
 *        → ガイドがゲストと連絡できたら ③ゲスト連絡 ✓
 *  前日20:00 までに翌日分の手配を終える。過ぎたら、キラナとリールに通知（キャンセルの手続きは手配ボードの外で行う）
 *  ツアー後 ガイドが ④完了報告フォーム（チェック項目・アンケート）を送る → キラナが ⑤受領 ✓ で完了
 *  メール・インフルエンサーの予約は、台帳の空いている行にキラナが手で書く（経路を選ぶ）
 *
 * お客様の情報はこのスプレッドシートの中だけに置く（コードやリポジトリには入れない）。
 */

// ===== 定数 =====

var SHEETS = { TODO: '対応一覧', OLD_TODO: '今やること', LEDGER: '台帳', TOURS: 'ツアー', SETTINGS: '設定', LOG: 'ログ', REPORT: '完了報告' };

// 台帳の列（見出しの文字がそのままキーになる）
var H = {
  ID: '案件ID', WHO: '次にやる人', TODO: '次にやること', DUE: '期限', ST: '状態',
  DATE: '催行日', TIME: '開始', TOUR: 'ツアー', ADULT: '大人', CHILD: '子ども', NAME: '代表者名', CONTACT: '連絡先',
  ROUTE: '経路', MEMO: 'メモ', GUIDE: 'ガイド名',
  ACCEPT: '①受注（リール）', ARRANGE: '②手配完了（リール）', GUEST: '③ゲスト連絡（リール・ガイド）',
  REPORT: '④完了報告（ガイド）', RECEIVE: '⑤受領（キラナ）',
  CXOK: 'キャンセル確認（リール）', CXKIRA: 'キャンセル対応（キラナ）',   // CXKIRA は第2版の途中で廃止（初期設定で列を消す）
  NOTE: '変更・注意',
  BOOKING: '予約番号', AGENT: '代理店予約番号', PLAN: 'PLAN名', SRC: '取込元',
  T_CREATED: '登録日時', T_ACCEPT: '受注日時', T_ARRANGE: '手配日時', T_GUEST: '連絡日時', T_REPORT: '報告日時',
  T_RECEIVE: '受領日時', T_CX: 'キャンセル日時', CX_REASON: 'キャンセルの理由', T_CXOK: 'キャンセル確認日時',
  ALERTED: '通知済み', REPORT_SUM: '報告の要約'
};

var LEDGER_HEADERS = [
  H.ID, H.WHO, H.TODO, H.DUE, H.ST,
  H.DATE, H.TIME, H.TOUR, H.ADULT, H.CHILD, H.NAME, H.CONTACT, H.ROUTE, H.MEMO, H.GUIDE,
  H.ACCEPT, H.ARRANGE, H.GUEST, H.REPORT, H.RECEIVE, H.CXOK, H.NOTE,
  H.BOOKING, H.AGENT, H.PLAN, H.SRC,
  H.T_CREATED, H.T_ACCEPT, H.T_ARRANGE, H.T_GUEST, H.T_REPORT, H.T_RECEIVE, H.T_CX, H.CX_REASON, H.T_CXOK,
  H.ALERTED, H.REPORT_SUM
];

// チェック欄と、✓ を付けたときに時刻を入れる列
var CHECKS = [
  { col: H.ACCEPT, stamp: H.T_ACCEPT, implies: [] },
  { col: H.ARRANGE, stamp: H.T_ARRANGE, implies: [H.ACCEPT] },
  { col: H.GUEST, stamp: H.T_GUEST, implies: [H.ACCEPT, H.ARRANGE] },
  { col: H.RECEIVE, stamp: H.T_RECEIVE, implies: [] },
  { col: H.CXOK, stamp: H.T_CXOK, implies: [] }
];
// スクリプトが書く列（人は触らない）
var AUTO_COLS = [H.ID, H.WHO, H.TODO, H.DUE, H.ST, H.NOTE, H.SRC, H.T_CREATED, H.T_ACCEPT, H.T_ARRANGE, H.T_GUEST,
  H.T_REPORT, H.T_RECEIVE, H.T_CX, H.CX_REASON, H.T_CXOK, H.ALERTED, H.REPORT_SUM];
// 数式（リンク）を入れる列。行をまとめて書き戻すときは飛ばす
var FORMULA_COLS = [H.REPORT];

// 見出しの表示（チェック欄は「だれが」を2行目に。読むときは改行を外してキーにする）
function dispHeader_(h) {
  return [H.ACCEPT, H.ARRANGE, H.GUEST, H.REPORT, H.RECEIVE, H.CXOK].indexOf(h) >= 0 ? h.replace('（', '\n（') : h;
}

var WHO = { REELU: 'リール', KIRA: 'キラナ', GUIDE: 'ガイド' };
var ROUTES_MANUAL = ['メール', 'インフルエンサー'];
var ROUTE_CHOICES = ['メール', 'インフルエンサー', '公式直販', 'Klook', 'Viator', 'GetYourGuide', 'NKTセット', 'その他'];

var TOUR_HEADERS = ['キーワード', 'ツアー名', '集合場所', '時刻の読み替え', '行程（完了報告の選択肢）', '注意'];

// キーワードは PLAN名 に含まれる文字。| で区切ると、どれか1つ。上の行から順に照合する。
var TOUR_DEFAULTS = [
  ['ローカルツアーセット', 'NKTセット（秘境神社）', '新宿東宝ビル1F（NKT会場を出てすぐ）', '15:00=16:30, 18:00=19:30',
    '集合・あいさつ／歌舞伎町一番街・さくら通り／秘境の神社／ゴールデン街・花園神社／解散', 'CSVの時刻はNKT公演の開始。ウォークは公演の1時間30分後'],
  ['秘密の神社', '秘境神社 Ninja Walk', '新宿東宝ビル1F（マルハン入口の横）', '',
    '集合・あいさつ／歌舞伎町一番街・さくら通り／秘境の神社／ゴールデン街・花園神社／解散', ''],
  ['ゴールデン街', 'ゴールデン街ナイト', '新宿駅 東口交番前', '',
    '集合・アイスブレイク／花園神社／ゴールデン街／歌舞伎町／まとめ', ''],
  ['二丁目|LGBTQ', '新宿二丁目 LGBTQ+', '京王新宿3丁目ビル スターバックス前', '',
    '集合・二丁目の大通り／ゴールデン街／歌舞伎町タワー／まとめ', 'ガイドは忍者の衣装を着ない'],
  ['ハンコ|印鑑', 'ハンコ作り', 'バスタ新宿（新宿3-38-1）', '',
    '集合・漢字ワークショップ／印章店で注文／お土産さんぽ／まとめ', '平日のみ'],
  ['合羽橋|包丁', '合羽橋', '田原町駅3番出口', '',
    '集合・あいさつ／器の宝探し／切子ガラス／商店の紹介／包丁と名入れ／解散', 'ガイドは忍者の衣装を着ない'],
  ['アメ横|上野', '上野アメ横', 'JR上野駅 上野の森さくらテラス1F', '',
    '集合・あいさつ／アメ横・赤ちょうちん横丁／上野公園・神社の作法／まとめ', 'ガイドは忍者の衣装を着ない'],
  ['御苑', '新宿御苑', '京王新宿3丁目ビル スターバックス前', '',
    '集合・スイーツ／入園・侍の話／桜の写真・フードクイズ／庭園のしかけ／まとめ', '春のみ'],
  ['浅草', '浅草ナイト', '浅草文化観光センター1F', '',
    '集合・屋上から浅草寺とスカイツリー／雷門・仲見世のシャッターアート／浅草寺・五重塔・おみくじ／浅草神社／伝法院通り・最後の1枚／解散', 'ガイドは忍者の衣装を着ない。浅草神社の本殿は撮影しない'],
  ['スクーター|RIDE', 'Eスクーター（NINJA GO RIDE）', '新宿東宝ビル1F', '',
    '集合・安全説明／都庁へ走行／展望室・プロジェクションマッピング／歌舞伎町へ走行／徒歩ツアー', '16歳以上']
];

var SETTING_DEFAULTS = [
  ['メール通知', 'ON', 'OFF にすると、通知メールをすべて止める（台帳と対応一覧の更新は続く）。見本（TEST-…）はONでもメールを送らない'],
  ['キラナの通知先', '', 'キラナの担当者のアドレス。複数はカンマ区切り'],
  ['リールの通知先', '', 'リールの担当者・共有アドレス。複数はカンマ区切り'],
  ['リールの確認時刻', '13:00', 'リールが毎日台帳を見る時刻'],
  ['受注の猶予（分）', '60', '確認時刻からこの時間までに ①受注 がなければ通知'],
  ['手配の期限（前日の時刻）', '20:00', 'この時刻までに翌日分の ②手配完了 がなければ、キラナとリールに通知'],
  ['手配の目安（何日前）', '3', 'これより前に入った予約は、催行のこの日数前の手配の期限の時刻を「目安」にする（過ぎると黄色・19時のお知らせに入る）。0で使わない'],
  ['手配の事前確認（時刻）', '19:00', '翌日分に未手配があれば、この時刻にキラナとリールへ知らせる'],
  ['ゲスト連絡の期限（開始の何時間前）', '3', '仮置き。打ち合わせで決まったら直す'],
  ['完了報告の期限（翌日の時刻）', '12:00', '催行日の翌日のこの時刻までに ④完了報告 がなければ通知'],
  ['受領の期限（日）', '3', '完了報告からこの日数のうちに ⑤受領'],
  ['キャンセル確認の期限（時間）', '3', 'キャンセルが台帳に出てから、リールが確認するまで'],
  ['夜間の開始', '22:00', 'この時刻から「夜間の終了」までは通知を送らない（朝にまとめて送る）'],
  ['夜間の終了', '08:00', ''],
  ['NKTセットのキーワード', 'ローカルツアーセット', 'tryhard- の CSV から、PLAN名にこの文字を含む行だけを取り込む'],
  ['自動キャンセルの上限（件）', '5', '1つのCSVで「消えた予約」がこれより多いときは、キャンセルにせず確認を求める（書き出しの誤りに備える）'],
  ['CSVの置き場（フォルダID）', '', '初期設定で自動で入る'],
  ['完了報告フォーム', '', '初期設定で自動で入る（ガイドに渡すリンクは台帳の ④ 列に案件ごとに出る）']
];

var LOG_HEADERS = ['日時', '種類', '案件ID', '予約番号', '内容'];

// 完了報告フォームの質問（見出しの文字で回答を読む）
var Q = {
  ID: '案件ID',
  GUIDE: 'ガイド名',
  TOUR: 'ツアー',
  MEET: '【必須】ゲストと合流できましたか',
  ROUTE: '【必須】予定の行程をすべて回りましたか',
  END: '【必須】終了時刻',
  NOTICE: '【必須】注意事項（撮影できない場所・マナーなど）を説明しましたか',
  TROUBLE: '【必須】ケガ・トラブル・苦情はありましたか',
  REACTION: '【必須】ゲストの反応（5段階）',
  REVIEW: '【必須】レビュー（口コミ）のお願い',
  DETAIL: '【必須（あった場合）】合流できなかった・省いた行程・トラブルの内容',
  BEST: '【任意】いちばん盛り上がった場所',
  LATE: '【任意】時間が押した・困った場所',
  PHOTO: '【任意】写真をお渡ししましたか',
  IMPROVE: '【任意】マニュアルと違った点・改善の提案',
  OTHER: '【任意】ゲストからの質問・その他'
};
var A = {
  MEET: ['予定どおり合流した', '遅れて合流した（10分以上）', '合流できなかった'],
  ROUTE: ['すべて回った', '一部を省いた'],
  END: ['予定どおり', '押した（10分以上）', '早く終わった'],
  NOTICE: ['説明した', '説明できなかった'],
  TROUBLE: ['なかった', 'あった'],
  REVIEW: ['その場で書いてもらった', 'お願いした（後で書くと）', 'お願いできなかった'],
  PHOTO: ['お渡しした', 'お渡ししていない', '希望されなかった']
};

var H_MS = 3600000;
var MIN_MS = 60000;
var DAY_MS = 24 * H_MS;
var WD = '日月火水木金土';

// 1ファイル版（build.cjs で作る）では、設定の初期値がこのファイルの最後で入る
var SETTING_OVERRIDES = {};

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
function fmtMD_(ymd) {
  if (!ymd) return '';
  var a = ymd.split('-');
  var d = jstDate_(+a[0], +a[1], +a[2], 12, 0);
  return (+a[1]) + '/' + (+a[2]) + '(' + WD[jst_(d).wd] + ')';
}
function ymd_(d) { var p = jst_(d); return p.y + '-' + pad2_(p.mo) + '-' + pad2_(p.d); }
function hmToMin_(s) {
  var m = String(s == null ? '' : s).match(/^\s*(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}
function minOfDay_(d) { var p = jst_(d); return p.h * 60 + p.mi; }

function toDate_(v) {
  if (isDate_(v)) return isNaN(v) ? null : v;
  if (v === '' || v == null) return null;
  var m = String(v).match(/^\s*(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?\s*$/);
  if (m) return jstDate_(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  var d = new Date(v);
  return isNaN(d) ? null : d;
}

// 2026-11-12／2026/11/12／20261112／2026年11月12日 を読む
function toYmd_(v) {
  if (!v) return '';
  if (isDate_(v)) return isNaN(v) ? '' : ymd_(v);
  var s = String(v).trim();
  var m = s.match(/(\d{4})\s*[-\/.年]\s*(\d{1,2})\s*[-\/.月]\s*(\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return '';
  var mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return m[1] + '-' + pad2_(mo) + '-' + pad2_(d);
}

// 17:00／1700／17時／17時30分／17 を読む
function toHm_(v) {
  if (v === '' || v == null) return '';
  if (isDate_(v)) { var p = jst_(v); return pad2_(p.h) + ':' + pad2_(p.mi); }
  if (typeof v === 'number' && v > 0 && v < 1) { var t = Math.round(v * 1440); return pad2_(Math.floor(t / 60) % 24) + ':' + pad2_(t % 60); }
  var s = String(v).trim().replace(/[０-９：]/g, function (c) { return c === '：' ? ':' : String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
  var m = s.match(/(\d{1,2})\s*[:時]\s*(\d{1,2})?/) || s.match(/^(\d{1,2})(\d{2})$/) || s.match(/^(\d{1,2})$/);
  if (!m) return '';
  var h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 23 || mi > 59) return '';
  return pad2_(h) + ':' + pad2_(mi);
}

function startOf_(c) {
  var day = toYmd_(c[H.DATE]), hm = toHm_(c[H.TIME]);
  if (!day || !hm) return null;
  var a = day.split('-'), b = hm.split(':');
  return jstDate_(+a[0], +a[1], +a[2], +b[0], +b[1]);
}

// 催行日の off 日後の hh:mm（日本時間）
function dayAt_(ymd, off, hm) {
  var a = ymd.split('-'), m = hmToMin_(hm) || 0;
  return jstDate_(+a[0], +a[1], +a[2] + off, Math.floor(m / 60), m % 60);
}

function inQuiet_(d, qs, qe) {
  var a = hmToMin_(qs), b = hmToMin_(qe), m = minOfDay_(d);
  if (a === null || b === null || a === b) return false;
  return a < b ? (m >= a && m < b) : (m >= a || m < b);
}

function truthy_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function splitList_(v) {
  return String(v || '').split(/[,、\s]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}
function num_(v, d) { var n = Number(v); return isFinite(n) && String(v).trim() !== '' ? n : d; }

// ===== 設定・ツアー =====

function normalizeSettings_(raw) {
  return {
    mailOn: !/^(off|オフ|停止|止める|false|0)$/i.test(String(raw['メール通知'] == null ? 'ON' : raw['メール通知']).trim()),
    kiraTo: splitList_(raw['キラナの通知先']),
    reeluTo: splitList_(raw['リールの通知先']),
    checkTime: toHm_(raw['リールの確認時刻']) || '13:00',
    acceptGraceMin: num_(raw['受注の猶予（分）'], 60),
    arrangeDeadline: toHm_(raw['手配の期限（前日の時刻）']) || '20:00',
    precheckTime: toHm_(raw['手配の事前確認（時刻）']) || '19:00',
    softDays: num_(raw['手配の目安（何日前）'], 3),
    guestHours: num_(raw['ゲスト連絡の期限（開始の何時間前）'], 3),
    reportTime: toHm_(raw['完了報告の期限（翌日の時刻）']) || '12:00',
    receiveDays: num_(raw['受領の期限（日）'], 3),
    cxHours: num_(raw['キャンセル確認の期限（時間）'], 3),
    quietStart: toHm_(raw['夜間の開始']) || '22:00',
    quietEnd: toHm_(raw['夜間の終了']) || '08:00',
    nktKeyword: String(raw['NKTセットのキーワード'] || 'ローカルツアーセット').trim(),
    maxAutoCancel: num_(raw['自動キャンセルの上限（件）'], 5),
    folderId: String(raw['CSVの置き場（フォルダID）'] || '').trim()
  };
}

function parseTimeMap_(s) {
  var map = {};
  String(s || '').split(/[,、]/).forEach(function (pair) {
    var p = pair.split(/[=＝→>]/);
    if (p.length === 2 && toHm_(p[0]) && toHm_(p[1])) map[toHm_(p[0])] = toHm_(p[1]);
  });
  return map;
}

function toursFromRows_(rows) {
  return rows.filter(function (r) { return r[1]; }).map(function (r) {
    return {
      keywords: String(r[0] || '').split('|').map(function (s) { return s.trim(); }).filter(function (s) { return s; }),
      name: String(r[1]).trim(), meet: String(r[2] || ''), timeMap: parseTimeMap_(r[3]),
      stops: String(r[4] || '').split(/[／\/]/).map(function (s) { return s.trim(); }).filter(function (s) { return s; }),
      note: String(r[5] || '')
    };
  });
}

function matchTour_(text, tours) {
  text = String(text || '');
  for (var i = 0; i < tours.length; i++) {
    for (var k = 0; k < tours[i].keywords.length; k++) if (text.indexOf(tours[i].keywords[k]) >= 0) return tours[i];
  }
  return null;
}
function tourByName_(name, tours) {
  for (var i = 0; i < tours.length; i++) if (tours[i].name === String(name || '').trim()) return tours[i];
  return null;
}

// ===== 状態と期限（この関数が「次に誰が何をするか」を決める）=====

// 受注の期限：登録後の最初の「確認時刻」＋猶予。ただし手配の期限（前日20時）より後にはしない
function acceptDue_(created, arrangeDue, cfg) {
  var p = jst_(created), m = hmToMin_(cfg.checkTime);
  var t = jstDate_(p.y, p.mo, p.d, Math.floor(m / 60), m % 60);
  if (created.getTime() > t.getTime()) t = new Date(t.getTime() + DAY_MS);
  var due = new Date(t.getTime() + cfg.acceptGraceMin * MIN_MS);
  if (arrangeDue && due.getTime() > arrangeDue.getTime()) {
    due = arrangeDue.getTime() > created.getTime() ? arrangeDue : new Date(created.getTime() + H_MS);
  }
  return due;
}

function derive_(c, cfg, now) {
  var ymd = toYmd_(c[H.DATE]);
  var start = startOf_(c);
  var created = toDate_(c[H.T_CREATED]) || now;
  var accepted = truthy_(c[H.ACCEPT]), arranged = truthy_(c[H.ARRANGE]), guested = truthy_(c[H.GUEST]);
  var r = { st: '', who: '', todo: '', due: null, step: '' };

  if (c[H.T_CX]) {
    if ((accepted || arranged) && !truthy_(c[H.CXOK])) {
      var cx = toDate_(c[H.T_CX]) || now;
      return { st: 'キャンセル（リール確認待ち）', who: WHO.REELU, step: 'cxok',
        todo: 'キャンセルが発生しました',
        due: new Date(cx.getTime() + cfg.cxHours * H_MS) };
    }
    return { st: 'キャンセル済み', who: '', todo: '', due: null, step: 'cxdone' };
  }
  if (!ymd || !start || !String(c[H.TOUR] || '').trim()) {
    return { st: '入力待ち', who: WHO.KIRA, step: 'input', todo: '催行日・開始・ツアー・人数を入れてください', due: new Date(created.getTime() + H_MS) };
  }
  if (truthy_(c[H.RECEIVE])) return { st: '完了', who: '', todo: '', due: null, step: 'done' };
  var reported = toDate_(c[H.T_REPORT]);
  if (reported) {
    return { st: '完了報告済み（受領待ち）', who: WHO.KIRA, step: 'receive', todo: '完了報告を読んで、受領してください',
      due: new Date(reported.getTime() + cfg.receiveDays * DAY_MS) };
  }
  if (guested) {
    var before = now.getTime() < start.getTime();
    return { st: 'ゲスト連絡済み', who: WHO.GUIDE, step: 'report',
      todo: before ? 'ツアーを実施し、終わったら完了報告を送ってください' : '完了報告を送ってください',
      due: dayAt_(ymd, 1, cfg.reportTime) };
  }
  if (arranged) {
    var noGuide = !String(c[H.GUIDE] || '').trim();
    return { st: '手配済み（ゲスト連絡待ち）', who: WHO.REELU, step: 'guest',
      todo: noGuide ? 'ガイド名を入れて、ゲストに連絡してください' : 'ゲストに連絡してください',
      due: new Date(start.getTime() - cfg.guestHours * H_MS) };
  }
  var arrangeDue = dayAt_(ymd, -1, cfg.arrangeDeadline);
  if (now.getTime() >= arrangeDue.getTime()) {
    return { st: '未手配（期限切れ）', who: WHO.REELU, step: 'unarranged', due: arrangeDue,
      todo: 'ガイドを手配してください（期限切れ）' };
  }
  // 手配の目安：余裕のある予約は「催行の◯日前」を目安にする（期限ではないので、キャンセルにはしない）
  var soft = cfg.softDays > 0 ? dayAt_(ymd, -cfg.softDays, cfg.arrangeDeadline) : null;
  if (soft && soft.getTime() <= created.getTime()) soft = null;
  if (accepted) {
    return { st: '受注済み（手配中）', who: WHO.REELU, step: 'arrange', due: arrangeDue, soft: soft,
      todo: 'ガイドを手配してください' };
  }
  return { st: '新規（受注待ち）', who: WHO.REELU, step: 'accept', due: acceptDue_(created, arrangeDue, cfg), soft: soft,
    todo: '受注してください' };
}

function isOverdue_(d, now) { return !!(d.due && now.getTime() > d.due.getTime()); }

// ===== CSV =====

function parseCsv_(text) {
  text = String(text || '').replace(/^﻿/, '');
  var rows = [], row = [], f = '', q = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(f); f = '';
      rows.push(row); row = [];
    } else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
}

// ファイル名で NGT／NKT を見分ける。分からなければ中身で見分ける
function sourceOf_(fileName, rows) {
  var n = String(fileName || '').toLowerCase().replace(/^.*[\\\/]/, '');
  if (/(^|[^a-z])tryhard[-_]/.test(n)) return 'NKT';
  if (/kiranah[-_]?resort/.test(n)) return 'NGT';
  var text = rows && rows.length > 1 ? rows.slice(1, 6).map(function (r) { return r.join(','); }).join('\n') : '';
  if (/ARS_TRYHARD|Ninja\+Kabuki/i.test(text)) return 'NKT';
  if (/ARS_NINJAGORIDE|NINJA GO TOURS/i.test(text)) return 'NGT';
  return null;
}

var OTA_NAMES = {
  ARS_NINJAGORIDE: '公式直販', ARS_TRYHARD: 'NKT直販', KLOOK: 'Klook', GYG: 'GetYourGuide', GETYOURGUIDE: 'GetYourGuide',
  VIATOR: 'Viator', VIATOR_TRYHARD: 'Viator', CTRIP: 'Trip.com', PELAGO: 'Pelago', HEADOUT: 'Headout', YAPAN_TOURS: 'Yapan Tours',
  ARS_TRIPLABO_WEB: 'TRIPLABO'
};
function otaName_(ota, bookingNo) {
  var k = String(ota || '').trim().toUpperCase() || String(bookingNo || '').split('-')[0].toUpperCase();
  return OTA_NAMES[k] || (k ? k : '不明');
}

// CSV の1行を予約にする。取り込まない行は { skip: 理由 }
function rowToBooking_(o, src, tours, cfg) {
  var bookingNo = String(o.booking_id || '').trim();
  if (!bookingNo) return { skip: '予約番号なし' };
  var status = String(o.status || '').trim().toUpperCase();
  var cancelled = /CANCEL/.test(status) || !!String(o.cancelled_date || '').trim();
  if (status && !cancelled && status !== 'CONFIRMED') return { skip: '確定していない（' + status + '）' };
  var plan = String(o.plan_name || '').trim();
  if (src === 'NKT' && plan.indexOf(cfg.nktKeyword) < 0) return { skip: 'NKTのセット商品ではない' };
  var tour = matchTour_(plan + ' ' + String(o.activity_name || ''), tours);
  var hm = toHm_(o.activity_time);
  if (tour && tour.timeMap[hm]) hm = tour.timeMap[hm];
  var adult = 0, child = 0;
  for (var i = 1; i <= 10; i++) {
    var t = String(o['unit_type' + i] || ''), q = num_(o['unit_quantity' + i], 0);
    if (!t || !q) continue;
    if (/子供|子ども|こども|小人|child/i.test(t) && !/大人|共通|adult/i.test(t)) child += q; else adult += q;
  }
  var ota = otaName_(o.ota, bookingNo);
  return {
    bookingNo: bookingNo, agentNo: String(o.agent_booking_id || '').trim(), plan: plan,
    tour: tour ? tour.name : '', ymd: toYmd_(o.activity_date), hm: hm, adult: adult, child: child,
    name: String(o.participant_name || '').trim(), contact: String(o.contact_info || '').trim(),
    route: src === 'NKT' ? 'NKTセット（' + ota + '）' : ota, cancelled: cancelled
  };
}

function csvObjects_(rows) {
  var head = rows[0].map(function (h) { return String(h).replace(/^﻿/, '').trim(); });
  return rows.slice(1).map(function (r) {
    var o = {};
    head.forEach(function (h, i) { o[h] = r[i] === undefined ? '' : r[i]; });
    return o;
  });
}

// CSV を台帳に反映する。L は台帳（ledger_ の戻り値）。返り値は結果の要約
function importCsv_(fileName, text, L, cfg, tours, now) {
  var rows = parseCsv_(text);
  var res = { file: fileName, src: '', added: [], cancelled: [], changed: [], restored: [], skipped: 0, held: [], error: '' };
  if (!rows.length) { res.error = '中身が空です'; return res; }
  if (rows[0].map(function (h) { return String(h).replace(/^﻿/, '').trim(); }).indexOf('booking_id') < 0) {
    res.error = 'LINKTIVITY の予約CSVの形ではありません（booking_id の列がない）'; return res;
  }
  var src = sourceOf_(fileName, rows);
  if (!src) { res.error = 'NGT（kiranah-resort-）か NKT（tryhard-）か、ファイル名から分かりません'; return res; }
  res.src = src;
  var srcTag = src + ' CSV';
  var stamp = fmtDT_(now);
  var today = ymd_(now);
  var seen = {};
  var valid = 0, nTest = 0;

  csvObjects_(rows).forEach(function (o) {
    var b = rowToBooking_(o, src, tours, cfg);
    if (b.skip) { res.skipped++; return; }
    if (b.ymd && b.ymd < today) { res.skipped++; return; } // 過去の催行日（古いCSVを入れたとき）は取り込まない
    valid++;
    if (/^TEST-/.test(b.bookingNo)) nTest++;
    var c = findByBooking_(L, b.bookingNo);
    if (b.cancelled) {
      if (c && !c[H.T_CX]) { cancelCase_(c, now, 'CSVでキャンセル'); saveCase_(L, c); res.cancelled.push(c); }
      return;
    }
    seen[b.bookingNo] = true;
    if (!c) {
      c = {};
      c[H.ID] = nextCaseId_(L.rows);
      c[H.DATE] = b.ymd; c[H.TIME] = b.hm; c[H.TOUR] = b.tour; c[H.ADULT] = b.adult; c[H.CHILD] = b.child || '';
      c[H.NAME] = b.name; c[H.CONTACT] = b.contact; c[H.ROUTE] = b.route;
      c[H.BOOKING] = b.bookingNo; c[H.AGENT] = b.agentNo; c[H.PLAN] = b.plan; c[H.SRC] = srcTag;
      c[H.T_CREATED] = now;
      if (!b.tour) c[H.NOTE] = 'ツアーを判定できません。ツアー列を選んでください';
      appendCase_(L, c);
      res.added.push(c);
      return;
    }
    // CSV から一度消えてキャンセル扱いにした予約が、また載っていたら戻す
    if (c[H.T_CX] && /^CSVに載っていない/.test(String(c[H.CX_REASON]))) {
      c[H.T_CX] = ''; c[H.CX_REASON] = '';
      addNote_(c, stamp + ' CSVに再び載ったため、キャンセルを取り消しました');
      saveCase_(L, c); res.restored.push(c);
    }
    if (c[H.T_CX]) return;
    var diffs = [];
    var timeChanged = false;
    if (b.ymd && b.ymd !== toYmd_(c[H.DATE])) { diffs.push('催行日 ' + fmtMD_(toYmd_(c[H.DATE])) + '→' + fmtMD_(b.ymd)); c[H.DATE] = b.ymd; timeChanged = true; }
    if (b.hm && b.hm !== toHm_(c[H.TIME])) { diffs.push('開始 ' + toHm_(c[H.TIME]) + '→' + b.hm); c[H.TIME] = b.hm; timeChanged = true; }
    if (b.adult !== num_(c[H.ADULT], 0)) { diffs.push('大人 ' + num_(c[H.ADULT], 0) + '→' + b.adult); c[H.ADULT] = b.adult; }
    if ((b.child || 0) !== num_(c[H.CHILD], 0)) { diffs.push('子ども ' + num_(c[H.CHILD], 0) + '→' + b.child); c[H.CHILD] = b.child || ''; }
    if (b.name && b.name !== String(c[H.NAME])) { c[H.NAME] = b.name; }
    if (b.contact && b.contact !== String(c[H.CONTACT])) { c[H.CONTACT] = b.contact; }
    if (diffs.length) {
      var note = stamp + ' 変更：' + diffs.join('、');
      if (timeChanged && truthy_(c[H.ARRANGE])) {
        c[H.ARRANGE] = false; c[H.T_ARRANGE] = ''; c[H.GUEST] = false; c[H.T_GUEST] = '';
        note += '（日時が変わったため、手配からやり直し）';
      }
      addNote_(c, note);
      c[H.ALERTED] = '';
      saveCase_(L, c);
      res.changed.push(c);
    }
  });

  // 今日以降の予約で、このCSVに載っていないもの＝キャンセルされた予約
  // テスト用のCSV（予約番号がすべて TEST-）は見本だけを、本物のCSVは本物だけを照らし合わせる
  var testCsv = nTest > 0 && nTest === valid;
  var gone = L.rows.filter(function (c) {
    return (testCsv ? isTest_(c) : !isTest_(c)) && c[H.SRC] === srcTag && c[H.BOOKING] && !seen[c[H.BOOKING]] && !c[H.T_CX] &&
      toYmd_(c[H.DATE]) >= today && !truthy_(c[H.RECEIVE]) && !c[H.T_REPORT];
  });
  if (gone.length && (valid === 0 || gone.length > cfg.maxAutoCancel)) {
    gone.forEach(function (c) {
      if (String(c[H.NOTE]).indexOf('要確認：最新のCSVに載っていません') < 0) {
        addNote_(c, stamp + ' 要確認：最新のCSVに載っていません（件数が多いため、自動ではキャンセルにしていません）');
        saveCase_(L, c);
      }
    });
    res.held = gone;
  } else {
    gone.forEach(function (c) { cancelCase_(c, now, 'CSVに載っていない（キャンセルとみなす）'); saveCase_(L, c); res.cancelled.push(c); });
  }
  return res;
}

function cancelCase_(c, now, reason) {
  c[H.T_CX] = now; c[H.CX_REASON] = reason; c[H.ALERTED] = '';
  addNote_(c, fmtDT_(now) + ' ' + reason);
}

function addNote_(c, text) {
  var cur = String(c[H.NOTE] || '').trim();
  c[H.NOTE] = cur ? cur + '\n' + text : text;
}

function nextCaseId_(rows) {
  var max = 0;
  rows.forEach(function (c) { var m = String(c[H.ID] || '').match(/^NGT-(\d+)$/); if (m) max = Math.max(max, +m[1]); });
  var n = String(max + 1);
  while (n.length < 4) n = '0' + n;
  return 'NGT-' + n;
}

// ===== スプレッドシートの読み書き =====

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function settings_() {
  var raw = {};
  SETTING_DEFAULTS.forEach(function (r) { raw[r[0]] = r[1]; });
  var sh = ss_().getSheetByName(SHEETS.SETTINGS);
  if (sh) sh.getDataRange().getValues().slice(1).forEach(function (r) { if (r[0] !== '' && r[0] != null) raw[String(r[0])] = r[1]; });
  return normalizeSettings_(raw);
}

// 新しく増えた設定の項目を足す（値は初期値。「メール通知」は見つけやすいようにいちばん上）
function ensureSettingRows_(set) {
  set = set || ss_().getSheetByName(SHEETS.SETTINGS);
  if (!set || set.getLastRow() === 0) return;
  var haveKeys = set.getDataRange().getValues().map(function (r) { return String(r[0]); });
  SETTING_DEFAULTS.forEach(function (r) {
    if (haveKeys.indexOf(r[0]) >= 0) return;
    if (r[0] === 'メール通知') { set.insertRowBefore(2); set.getRange(2, 1, 1, 3).setValues([[r[0], r[1], r[2]]]); }
    else set.appendRow([r[0], r[1], r[2]]);
  });
  var keys = set.getDataRange().getValues().map(function (r) { return String(r[0]); });
  var i = keys.indexOf('メール通知');
  if (i > 0) set.getRange(i + 1, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['ON', 'OFF'], true).setAllowInvalid(true).build());
}

function tours_() {
  var sh = ss_().getSheetByName(SHEETS.TOURS);
  return toursFromRows_(sh ? sh.getDataRange().getValues().slice(1) : TOUR_DEFAULTS);
}

// 台帳を読む。案件IDがなくても、人が書きかけた行（手入力の予約）は拾う
function ledger_() {
  var sh = ss_().getSheetByName(SHEETS.LEDGER);
  if (!sh) throw new Error('「台帳」のシートがありません。先に関数「setup」を実行してください。');
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).replace(/\n/g, ''); });
  if (head.indexOf(H.WHO) < 0) throw new Error('台帳が第2版の形になっていません。先に関数「setup」を実行してください。');
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 };
    for (var i = 0; i < head.length; i++) o[head[i]] = values[r][i];
    if (o[H.ID] || o[H.DATE] || o[H.TOUR] || o[H.NAME] || o[H.BOOKING]) rows.push(o);
  }
  // チェック欄は空でも「使われている行」に数えられるため、最後の行は中身のある行で決める
  var last = rows.reduce(function (m, c) { return Math.max(m, c._row); }, 1);
  return { sh: sh, head: head, rows: rows, last: last, used: values.length };
}

function saveCase_(L, c) {
  var arr = L.head.map(function (h) { var v = c[h]; return v === undefined || v === null ? '' : v; });
  // 数式の列（④のリンク）は飛ばして書く
  var start = 0;
  for (var i = 0; i <= arr.length; i++) {
    if (i === arr.length || FORMULA_COLS.indexOf(L.head[i]) >= 0) {
      if (i > start) L.sh.getRange(c._row, start + 1, 1, i - start).setValues([arr.slice(start, i)]);
      start = i + 1;
    }
  }
}

function appendCase_(L, c) {
  c._row = L.rows.reduce(function (m, x) { return Math.max(m, x._row); }, 1) + 1;
  L.last = c._row;
  saveCase_(L, c);
  L.rows.push(c);
  return c;
}

function findByBooking_(L, no) {
  for (var i = 0; i < L.rows.length; i++) if (no && String(L.rows[i][H.BOOKING]).trim() === no) return L.rows[i];
  return null;
}
function findCase_(L, id) {
  for (var i = 0; i < L.rows.length; i++) if (String(L.rows[i][H.ID]).trim() === id) return L.rows[i];
  return null;
}
function colOf_(L, name) { return L.head.indexOf(name) + 1; }

function log_(kind, c, text) {
  var sh = ss_().getSheetByName(SHEETS.LOG);
  if (sh) sh.appendRow([now_(), kind, c ? c[H.ID] : '', c ? c[H.BOOKING] : '', text]);
}

// 手で書いた行に案件IDを付ける
function initManual_(L, now) {
  var n = 0;
  L.rows.forEach(function (c) {
    if (c[H.ID]) return;
    c[H.ID] = nextCaseId_(L.rows);
    c[H.T_CREATED] = now;
    c[H.SRC] = '手入力';
    if (!c[H.ROUTE]) c[H.ROUTE] = 'メール';
    saveCase_(L, c);
    log_('手入力', c, '手で書いた予約に案件IDを付けました（経路：' + c[H.ROUTE] + '）');
    n++;
  });
  return n;
}

// ✓ を付けた・外したときの記録（onEdit から呼ぶ）
function applyCheck_(c, colName, now, user) {
  var def = null;
  CHECKS.forEach(function (d) { if (d.col === colName) def = d; });
  if (!def) return false;
  var on = truthy_(c[colName]);
  if (on) {
    if (!c[def.stamp]) c[def.stamp] = now;
    def.implies.forEach(function (k) {
      if (!truthy_(c[k])) {
        c[k] = true;
        CHECKS.forEach(function (d) { if (d.col === k && !c[d.stamp]) c[d.stamp] = now; });
      }
    });
  } else {
    c[def.stamp] = '';
  }
  c[H.ALERTED] = '';
  log_(on ? '✓' : '✓を外す', c, colName + (user ? '（' + user + '）' : ''));
  return true;
}

// ===== 画面（台帳の色・対応一覧）=====

var COLORS = {
  REELU: '#fde7d4', KIRA: '#dbe8fb', GUIDE: '#e2f2e0', LATE: '#f8c9c4', SOON: '#fff2cc', DONE: '#f1f1f1', HEAD: '#1f2d52',
  REELU_HI: '#f6b26b', KIRA_HI: '#9fc0f5', GUIDE_HI: '#93c47d', LATE_HI: '#e06666', MUTED: '#8a8a8a', WHITE: '#ffffff',
  BOTH: '#d0e8ea', BOTH_HI: '#76b5bd'   // ③ゲスト連絡（リールでもガイドでもよい）
};

function whoColor_(d, now) {
  if (!d.who) return COLORS.DONE;
  if (isOverdue_(d, now)) return COLORS.LATE;
  return d.who === WHO.REELU ? COLORS.REELU : d.who === WHO.KIRA ? COLORS.KIRA : COLORS.GUIDE;
}
function whoHi_(who, late) {
  if (late) return COLORS.LATE_HI;
  return who === WHO.KIRA ? COLORS.KIRA_HI : who === WHO.GUIDE ? COLORS.GUIDE_HI : COLORS.REELU_HI;
}

// 段階ごとに「次に押すチェック欄」（台帳ではこの欄に色を付ける）
var STEP_COLS = {
  accept: [H.ACCEPT], arrange: [H.ARRANGE, H.GUIDE], guest: [H.GUEST], report: [H.REPORT], receive: [H.RECEIVE],
  cxok: [H.CXOK], unarranged: [H.ARRANGE, H.GUIDE]
};

// 「あと1時間20分」「45分 過ぎ」
function dur_(ms) {
  var m = Math.round(ms / MIN_MS);
  if (m < 60) return m + '分';
  var h = Math.floor(m / 60);
  if (h < 24) return h + '時間' + (m % 60 ? (m % 60) + '分' : '');
  var d = Math.floor(h / 24);
  return d + '日' + (h % 24 ? (h % 24) + '時間' : '');
}
function rel_(due, now) {
  if (!due) return '';
  var diff = due.getTime() - now.getTime();
  return diff < 0 ? '⚠ ' + dur_(-diff) + ' 過ぎ' : 'あと' + dur_(diff);
}

// 全行の「次にやる人・次にやること・期限・状態」を書き直し、色を付ける
function refreshAll_(L, cfg, now) {
  var last = Math.max(L.last, 1);
  if (last < 2) return [];
  var byRow = {};
  L.rows.forEach(function (c) { byRow[c._row] = c; });
  var span = colOf_(L, H.CXOK);              // A列〜「キャンセル確認（リール）」まで色を付ける
  var vals = [], bgs = [], fcs = [], fls = [], list = [];
  for (var r = 2; r <= last; r++) {
    var c = byRow[r];
    var bg = [], fc = [], fl = [];
    for (var k = 0; k < span; k++) { bg.push(COLORS.WHITE); fc.push('#000000'); fl.push('none'); }
    if (!c || !c[H.ID]) { vals.push(['', '', '', '']); bgs.push(bg); fcs.push(fc); fls.push(fl); continue; }
    var d = derive_(c, cfg, now);
    c._d = d;
    list.push(c);
    var late = isOverdue_(d, now);
    vals.push([d.who ? (late ? '⚠ ' : '') + d.who : '—', d.todo, d.due || '', d.st]);
    var col = whoColor_(d, now);
    for (k = 0; k < 5; k++) bg[k] = col;
    var cancelled = d.step === 'cxok' || d.step === 'cxdone';
    if (cancelled) {                          // キャンセル：日付〜経路に取り消し線
      for (k = colOf_(L, H.DATE) - 1; k < colOf_(L, H.ROUTE); k++) fl[k] = 'line-through';
    }
    if (d.step === 'cxok') for (k = 0; k < 5; k++) bg[k] = isOverdue_(d, now) ? COLORS.LATE : '#f4cccc';
    if (!d.who) {                             // 完了・キャンセル済みは薄く
      for (k = 0; k < span; k++) { bg[k] = COLORS.DONE; fc[k] = COLORS.MUTED; }
    } else {
      (STEP_COLS[d.step] || []).forEach(function (name, i) {
        var idx = colOf_(L, name) - 1;
        if (idx < 0 || idx >= span) return;
        if (name === H.GUIDE && String(c[H.GUIDE] || '').trim()) return;
        var who = d.step === 'unarranged' && i > 0 ? WHO.REELU : d.who;
        bg[idx] = i === 0 ? (d.step === 'guest' && !late ? COLORS.BOTH_HI : whoHi_(who, late)) : (who === WHO.REELU ? COLORS.REELU : COLORS.KIRA);
      });
    }
    bgs.push(bg); fcs.push(fc); fls.push(fl);
  }
  L.sh.getRange(2, colOf_(L, H.WHO), vals.length, 4).setValues(vals);
  L.sh.getRange(2, 1, bgs.length, span).setBackgrounds(bgs).setFontColors(fcs).setFontLines(fls);
  return list;
}

function todoUrl_() {
  var ss = ss_(), sh = ss.getSheetByName(SHEETS.TODO);
  return ss.getUrl() + (sh ? '#gid=' + sh.getSheetId() : '');
}

function paxText_(c) {
  var a = num_(c[H.ADULT], 0), k = num_(c[H.CHILD], 0);
  return (a ? '大人' + a : '') + (k ? (a ? '・' : '') + '子' + k : '');
}

// 「対応一覧」でのやることの言い方（段階ごと）
var TODO_TEXT = {
  accept: '受注してください',
  arrange: 'ガイドを手配してください',
  unarranged: 'ガイドを手配してください（期限切れ）',
  guest: 'ゲストに連絡してください（ガイドでも可）',
  report: 'ガイドに完了報告を送ってもらってください',
  cxok: 'キャンセルが発生しました',
  receive: '完了報告を読んで、受領してください',
  input: '足りない項目（催行日・開始・ツアー・人数）を入れてください',
  held: 'CSVに載っていない予約を確認してください'
};
function todoText_(c) {
  var st = c._d.step;
  if (st === 'guest' && !String(c[H.GUIDE] || '').trim()) return 'ガイド名を入れて、ゲストに連絡してください';
  return TODO_TEXT[st] || c._d.todo;
}

function todoSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(SHEETS.TODO);
  if (!sh) { var old = ss.getSheetByName(SHEETS.OLD_TODO); if (old) { old.setName(SHEETS.TODO); sh = old; } }
  return sh;
}

// 「対応一覧」のシートを作り直す。リール様・キラナそれぞれ1つの表に、期限の近い順で並べる
function renderTodo_(L, cfg, now, list) {
  var sh = todoSheet_();
  if (!sh) return;
  list = list || L.rows.filter(function (c) { return c[H.ID]; }).map(function (c) { c._d = derive_(c, cfg, now); return c; });
  var gid = L.sh.getSheetId();
  var W = 9;
  var out = [], bg = [], fw = [], fc = [], fs = [], tables = [];
  var push = function (row, style) {
    style = style || {};
    while (row.length < W) row.push('');
    out.push(row);
    var b = [], w = [], f = [], z = [];
    for (var i = 0; i < W; i++) { b.push(style.bg || COLORS.WHITE); w.push(style.bold ? 'bold' : 'normal'); f.push(style.fc || '#1b2440'); z.push(style.size || 11); }
    if (style.cells) Object.keys(style.cells).forEach(function (i) { var x = style.cells[i]; if (x.bg) b[i] = x.bg; if (x.bold) w[i] = 'bold'; if (x.fc) f[i] = x.fc; if (x.size) z[i] = x.size; });
    bg.push(b); fw.push(w); fc.push(f); fs.push(z);
  };
  var link = function (c) { return '=HYPERLINK("#gid=' + gid + '&range=A' + c._row + '","' + c[H.ID] + ' を開く")'; };
  var when = function (c) { return fmtMD_(toYmd_(c[H.DATE])) + ' ' + toHm_(c[H.TIME]); };
  var byDue = function (a, b) { return (a._d.due ? a._d.due.getTime() : 9e15) - (b._d.due ? b._d.due.getTime() : 9e15); };
  var started = function (c) { var t = startOf_(c); return t && now.getTime() >= t.getTime(); };

  // だれの作業か（ツアー前の「完了報告待ち」は、まだやることがないので出さない）
  var reelu = [], kira = [];
  list.forEach(function (c) {
    var d = c._d;
    if (!d.who) return;
    if (d.step === 'report' && !started(c)) return;
    if (d.step === 'cxok') return;                      // キャンセルは別の欄に出す
    if (d.who === WHO.KIRA) kira.push(c); else reelu.push(c);
  });
  list.forEach(function (c) {
    if (String(c[H.NOTE]).indexOf('要確認：最新のCSVに載っていません') >= 0 && !c[H.T_CX]) kira.push({ _held: true, _row: c._row, _d: { step: 'held', due: null, who: WHO.KIRA }, src: c });
  });
  reelu.sort(byDue); kira.sort(byDue);
  var t = todayImport_(now);
  var noonPassed = minOfDay_(now) >= hmToMin_(cfg.checkTime) - 30;   // 12:30 を過ぎても取り込みがなければ知らせる

  push(['NGT 手配ボード　対応一覧', '', '', '', '', '', '', '', '更新 ' + fmtDT_(now)], { bold: true, size: 18, fc: COLORS.HEAD, cells: { 8: { size: 10, fc: '#666666' } } });
  if (!cfg.mailOn) push(['メール通知は停止中です（設定シートの「メール通知」を ON に戻すと再開します）'], { bg: COLORS.LATE, bold: true, fc: '#b42318' });

  // 本日の取り込み：件数は台帳から数える（取り込みの記録ではなく、いま台帳にある予約で数えるので食い違わない）
  var today = ymd_(now), md = fmtMD_(today);
  var dayOf = function (v) { var d = toDate_(v); return d ? ymd_(d) : ''; };
  // 新規＝今日台帳に入った予約（CSV・手入力・見本のどれでも）
  var added = list.filter(function (c) { return dayOf(c[H.T_CREATED]) === today; });
  var changed = list.filter(function (c) { return String(c[H.NOTE] || '').split('\n').some(function (l) { return l.indexOf(md) === 0 && l.indexOf('変更：') >= 0; }); });
  var cancelled = list.filter(function (c) { return c[H.T_CX] && (dayOf(c[H.T_CX]) === today || c._d.step === 'cxok'); });
  var held = list.filter(function (c) { return String(c[H.NOTE]).indexOf(md) >= 0 && String(c[H.NOTE]).indexOf('要確認：最新のCSVに載っていません') >= 0 && !c[H.T_CX]; });
  var nCxToday = cancelled.filter(function (c) { return dayOf(c[H.T_CX]) === today; }).length;
  // CSVの取り込み時刻は、種類ごとに最後の1回だけ出す
  var lastBySrc = {};
  (t ? t.files : []).forEach(function (f) { var p = String(f).split(' '); lastBySrc[p[0]] = p[1]; });
  var imp = Object.keys(lastBySrc).sort().map(function (k) { return k + ' ' + lastBySrc[k]; }).join('・');
  push(['本日の予約　（CSVの取り込み：' + (imp || (noonPassed ? 'まだ取り込まれていません' : '12:00 にキラナが取り込みます')) + '）'],
    { bold: true, size: 11, fc: !t && noonPassed ? '#b42318' : '#555555' });
  push(['新規 ' + added.length + '件', '', 'キャンセル ' + nCxToday + '件', '変更 ' + changed.length + '件', held.length ? '要確認 ' + held.length + '件' : ''], {
    bold: true, size: 14, cells: { 0: { bg: '#d9ead3' }, 1: { bg: '#d9ead3' }, 2: { bg: nCxToday ? COLORS.LATE : '#eeeeee' }, 3: { bg: changed.length ? COLORS.SOON : '#eeeeee' }, 4: { bg: held.length ? COLORS.LATE : COLORS.WHITE } }
  });
  // 本日のお知らせ（新規・変更）
  var news = changed.map(function (c) { return { k: '変更', c: c }; }).concat(held.map(function (c) { return { k: '要確認', c: c }; }), added.map(function (c) { return { k: '新規', c: c }; }));
  if (news.length) {
    var se = out.length + 1;
    push(['本日のお知らせ', '', 'いまの状態', 'ツアー', '催行日・開始', '人数', '経路', 'ガイド', '台帳'], { bold: true, bg: '#f3f3f3', size: 10 });
    news.forEach(function (e) {
      var c = e.c, kc = e.k === '新規' ? '#d9ead3' : e.k === '要確認' ? COLORS.LATE : COLORS.SOON;
      push([e.k, '', c._d.st, String(c[H.TOUR] || ''), when(c), paxText_(c), String(c[H.ROUTE] || ''), String(c[H.GUIDE] || ''), link(c)],
        { cells: { 0: { bg: kc, bold: true }, 2: { bg: whoColor_(c._d, now) } } });
    });
    tables.push([se, out.length]);
  }
  push([''], {});

  // キャンセル（別の欄）：リール様の確認待ちと、今日キャンセルになったもの
  cancelled.sort(function (a, b) { return (toDate_(b[H.T_CX]) || 0) - (toDate_(a[H.T_CX]) || 0); });
  var waitCx = cancelled.filter(function (c) { return c._d.step === 'cxok'; }).length;
  push(['■ キャンセルが発生しました　' + cancelled.length + '件' + (waitCx ? '（リール様の確認待ち ' + waitCx + '件）' : '')],
    { bold: true, size: 14, bg: cancelled.length ? '#e06666' : '#d9d9d9', fc: cancelled.length ? '#ffffff' : '#1b2440' });
  if (cancelled.length) {
    var sc = out.length + 1;
    push(['キャンセル日時', '', 'いまの状態', 'ツアー', '催行日・開始', '人数', '経路', 'ガイド', '台帳'], { bold: true, bg: '#f4cccc', size: 10 });
    cancelled.forEach(function (c) {
      var wait = c._d.step === 'cxok';
      var st = wait ? 'リール様の確認待ち（台帳の「キャンセル確認」に✓）' : truthy_(c[H.ACCEPT]) ? '確認済み' : '受注前のため対応不要';
      push([fmtDT_(toDate_(c[H.T_CX])), '', st, String(c[H.TOUR] || ''), when(c), paxText_(c), String(c[H.ROUTE] || ''), String(c[H.GUIDE] || ''), link(c)],
        { bg: wait ? '#fdecea' : COLORS.WHITE, cells: { 2: { bold: wait, fc: wait ? '#b42318' : '#555555' } } });
    });
    tables.push([sc, out.length]);
  } else push(['いまはありません'], { fc: COLORS.MUTED });
  push([''], {});

  // リール様・キラナ それぞれ1つの表
  var table = function (title, items, color, hi, extra) {
    var late = items.filter(function (c) { return c._d.due && isOverdue_(c._d, now); }).length;
    var n = items.length + (extra ? 1 : 0);
    push([title + '　' + n + '件' + (late ? '（うち期限切れ ' + late + '件）' : '')], { bold: true, size: 14, bg: hi });
    if (!n) { push(['いまはありません'], { fc: COLORS.MUTED }); push([''], {}); return; }
    var st0 = out.length + 1;
    push(['期限', '残り', 'やること', 'ツアー', '催行日・開始', '人数', '経路', 'ガイド', '台帳'], { bold: true, bg: color, size: 10 });
    if (extra) push(['', '', extra, '', '', '', '', '', ''], { bg: COLORS.LATE, cells: { 2: { bold: true, fc: '#b42318' } } });
    items.forEach(function (x) {
      var c = x._held ? x.src : x, d = x._d;
      var isLate = d.due && isOverdue_(d, now);
      var softOver = !isLate && d.soft && now.getTime() > d.soft.getTime();
      var soonDue = !isLate && (softOver || (d.due && d.due.getTime() - now.getTime() < 2 * H_MS));
      var text = x._held ? TODO_TEXT.held : todoText_(c);
      var cx = d.step === 'cxok';
      push([d.due ? fmtDT_(d.due) : '', d.due ? rel_(d.due, now) + (softOver ? '（目安超え）' : '') : '', text, String(c[H.TOUR] || ''), when(c),
        paxText_(c), String(c[H.ROUTE] || ''), String(c[H.GUIDE] || ''), link(c)],
        { bg: isLate ? COLORS.LATE : soonDue ? COLORS.SOON : COLORS.WHITE,
          cells: { 1: { bold: true, fc: isLate ? '#b42318' : '#1b2440' }, 2: { bold: true, fc: cx ? '#b42318' : '#1b2440', bg: cx && !isLate ? '#f4cccc' : undefined } } });
    });
    tables.push([st0, out.length]);
    push([''], {});
  };
  table('■ リール様がやること', reelu, COLORS.REELU, COLORS.REELU_HI);
  table('■ キラナがやること', kira, COLORS.KIRA, COLORS.KIRA_HI, !t && noonPassed ? '今日のCSVを取り込んでください（メニュー「CSVを取り込む」）' : '');

  // 直近3日のツアー（今日・明日・明後日）を1つの表に。日ごとに色を交互に変え、手配の状況を色で見せる
  var days = [0, 1, 2].map(function (n) { return ymd_(new Date(now.getTime() + n * DAY_MS)); });
  var near = list.filter(function (c) { return days.indexOf(toYmd_(c[H.DATE])) >= 0 && c._d.step !== 'cxdone'; });
  var arrangedSteps = ['guest', 'report', 'receive', 'done'];
  push(['■ 直近3日のツアー　' + near.length + '件'], { bold: true, size: 14, bg: '#d9d9d9' });
  var summary = days.map(function (day, n) {
    var tm = near.filter(function (c) { return toYmd_(c[H.DATE]) === day; });
    var rd = tm.filter(function (c) { return arrangedSteps.indexOf(c._d.step) >= 0; }).length;
    return { label: ['今日', '明日', '明後日'][n] + ' ' + fmtMD_(day) + '　' + tm.length + '件' + (tm.length ? '（手配済み ' + rd + '）' : ''), short: tm.length > rd };
  });
  push([summary[0].label, '', summary[1].label, '', summary[2].label], {
    bold: true, size: 12, cells: {
      0: { bg: summary[0].short ? COLORS.LATE : '#d9ead3' }, 1: { bg: summary[0].short ? COLORS.LATE : '#d9ead3' },
      2: { bg: summary[1].short ? COLORS.SOON : '#d9ead3', fc: summary[1].short ? '#b42318' : '#1b2440' }, 3: { bg: summary[1].short ? COLORS.SOON : '#d9ead3' },
      4: { bg: summary[2].short ? '#fff8e1' : '#d9ead3' }, 5: { bg: summary[2].short ? '#fff8e1' : '#d9ead3' } }
  });
  if (summary[1].short) push(['※ 明日のツアーは、今日' + cfg.arrangeDeadline + 'までに全件「手配済み」にしてください'], { fc: '#b42318', bold: true });
  if (near.length) {
    var s2 = out.length + 1;
    push(['日付', '開始', '手配の状況', 'ツアー', '次にやる人', '人数', '経路', 'ガイド', '台帳'], { bold: true, bg: '#f3f3f3', size: 10 });
    days.forEach(function (day, n) {
      var tm = near.filter(function (c) { return toYmd_(c[H.DATE]) === day; }).sort(function (a, b) { return (startOf_(a) || 0) - (startOf_(b) || 0); });
      var band = n % 2 ? '#f7f9fc' : COLORS.WHITE;
      tm.forEach(function (c, i) {
        var d = c._d, ok = arrangedSteps.indexOf(d.step) >= 0;
        var label = ok ? '手配済み' + (d.step === 'guest' ? '（ゲスト連絡まだ）' : '') :
          d.step === 'unarranged' ? '未手配・期限切れ' : d.step === 'cxok' ? 'キャンセルが発生しました' :
          d.step === 'accept' ? '未手配（受注待ち）' : d.step === 'input' ? '入力待ち' : '未手配（手配中）';
        var col = ok ? '#d9ead3' : (d.step === 'unarranged' || d.step === 'cxok') ? COLORS.LATE : COLORS.REELU;
        push([i === 0 ? ['今日', '明日', '明後日'][n] + ' ' + fmtMD_(day) : '', toHm_(c[H.TIME]), label, String(c[H.TOUR] || ''), d.who || '—',
          paxText_(c), String(c[H.ROUTE] || ''), String(c[H.GUIDE] || ''), link(c)],
          { bg: band, cells: { 0: { bold: true }, 2: { bg: col, bold: !ok } } });
      });
    });
    tables.push([s2, out.length]);
  }

  sh.clear();
  var rg = sh.getRange(1, 1, out.length, W);
  rg.setValues(out).setBackgrounds(bg).setFontWeights(fw).setFontColors(fc).setFontSizes(fs).setVerticalAlignment('middle').setHorizontalAlignment('left');
  tables.forEach(function (x) {
    sh.getRange(x[0], 1, x[1] - x[0] + 1, W).setBorder(true, true, true, true, true, true, '#d0d0d0', SpreadsheetApp.BorderStyle.SOLID);
  });
  [140, 130, 300, 190, 130, 80, 170, 120, 130].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.setRowHeights(1, out.length, 28);
  sh.setRowHeight(1, 40);
  sh.setFrozenRows(1);
}

// ===== 台帳の並べ替え（作業が必要な行を上に）=====

function sortKey_(c, now) {
  var d = c._d;
  if (!c[H.ID]) return [3, 0];
  if (d.who) return [isOverdue_(d, now) ? 0 : 1, d.due ? d.due.getTime() : 9e15];
  return [2, -(startOf_(c) || new Date(0)).getTime()];      // 完了・キャンセル済みは、新しいツアーを上に
}

// 並べ替えて上に詰める。変わったら true（呼んだ側で台帳を読み直す）
function sortLedger_(L, cfg, now) {
  if (!L.rows.length) return false;
  var list = L.rows.map(function (c) { if (!c._d) c._d = derive_(c, cfg, now); return c; });
  var sorted = list.slice().sort(function (a, b) {
    var x = sortKey_(a, now), y = sortKey_(b, now);
    return x[0] - y[0] || x[1] - y[1] || a._row - b._row;
  });
  var same = sorted.every(function (c, i) { return c._row === i + 2; });
  if (same) return false;
  var n = L.head.length, last = L.last;
  var rg = L.sh.getRange(2, 1, last - 1, n);
  var vals = rg.getValues(), fx = rg.getFormulas();
  var rowsOut = sorted.map(function (c) {
    var i = c._row - 2;
    return vals[i].map(function (v, j) { return fx[i][j] ? fx[i][j] : v; });
  });
  while (rowsOut.length < last - 1) { var blank = []; for (var k = 0; k < n; k++) blank.push(''); rowsOut.push(blank); }
  rg.setValues(rowsOut);
  if (last - 1 > sorted.length) L.sh.getRange(sorted.length + 2, 1, last - 1 - sorted.length, n).setBackground(null).setFontColor(null);
  return true;
}

function sortLedger() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cfg = settings_(), now = now_(), L = ledger_();
    if (sortLedger_(L, cfg, now)) L = ledger_();
    var list = refreshAll_(L, cfg, now);
    renderTodo_(L, cfg, now, list);
  } finally { lock.releaseLock(); }
}

// ===== 通知 =====

function sheetLink_() { return todoUrl_(); }

function mail_(to, subject, lines) {
  if (!settings_().mailOn) { log_('メール停止中', null, subject); return; }
  to = (to || []).filter(function (x) { return x; });
  if (!to.length) { log_('通知先なし', null, subject); return; }
  MailApp.sendEmail({ to: to.join(','), subject: '【NGT 手配】' + subject, body: lines.concat(['', '対応一覧：' + sheetLink_()]).join('\n'), name: 'NGT 手配ボード' });
}
function both_(cfg) { return cfg.kiraTo.concat(cfg.reeluTo); }

function caseLine_(c) {
  return '［' + c[H.ID] + '］' + fmtMD_(toYmd_(c[H.DATE])) + ' ' + toHm_(c[H.TIME]) + '　' + (c[H.TOUR] || '（ツアー未設定）') +
    '　大人' + num_(c[H.ADULT], 0) + (num_(c[H.CHILD], 0) ? '・子ども' + num_(c[H.CHILD], 0) : '') + '　' + (c[H.ROUTE] || '');
}

// 期限を過ぎた案件を、段階ごとに1回だけ知らせる（夜間は朝に回す）
function alertOverdue_(L, cfg, now, list) {
  // メール停止中は「通知済み」の印を付けない（ON に戻したとき、まだ期限切れのものを知らせる）
  if (!cfg.mailOn || inQuiet_(now, cfg.quietStart, cfg.quietEnd)) return 0;
  var hits = (list || []).filter(function (c) {
    var d = c._d;
    return d && d.who && !isTest_(c) && isOverdue_(d, now) && String(c[H.ALERTED]) !== d.step;
  });
  if (!hits.length) return 0;
  var unarranged = hits.filter(function (c) { return c._d.step === 'unarranged'; });
  var lines = ['期限を過ぎた案件があります。台帳の「対応一覧」で確認してください。', ''];
  if (unarranged.length) {
    lines.push('▼ 前日' + cfg.arrangeDeadline + 'を過ぎても手配できていない');
    unarranged.forEach(function (c) { lines.push(caseLine_(c)); });
    lines.push('');
  }
  var others = hits.filter(function (c) { return c._d.step !== 'unarranged'; });
  if (others.length) {
    lines.push('▼ そのほか');
    others.forEach(function (c) { lines.push(caseLine_(c) + '\n　→ ' + c._d.who + '：' + c._d.todo + '（期限 ' + fmtDT_(c._d.due) + '）'); });
  }
  mail_(both_(cfg), (unarranged.length ? '【至急】未手配 ' + unarranged.length + '件／' : '') + '期限切れ ' + hits.length + '件', lines);
  hits.forEach(function (c) {
    c[H.ALERTED] = c._d.step;
    L.sh.getRange(c._row, colOf_(L, H.ALERTED)).setValue(c._d.step);
  });
  return hits.length;
}

function importSummaryMail_(cfg, results) {
  var lines = ['LINKTIVITY の CSV を台帳に取り込みました。', ''];
  var any = false;
  var real = function (a) { return (a || []).filter(function (c) { return !isTest_(c); }); };
  results = results.map(function (r) {
    if (r.error) return r;
    return { src: r.src, file: r.file, added: real(r.added), cancelled: real(r.cancelled), changed: real(r.changed), restored: real(r.restored), held: real(r.held) };
  });
  results.forEach(function (r) {
    if (r.error) { lines.push('× ' + r.file + '：' + r.error); any = true; return; }
    lines.push('■ ' + r.src + '（' + r.file + '）　新規 ' + r.added.length + '件・キャンセル ' + r.cancelled.length + '件・変更 ' + r.changed.length + '件');
    if (r.added.length) { lines.push('　新規（リールは ①受注 に✓）'); r.added.forEach(function (c) { lines.push('　' + caseLine_(c)); }); }
    if (r.cancelled.length) { lines.push('　キャンセル'); r.cancelled.forEach(function (c) { lines.push('　' + caseLine_(c)); }); }
    if (r.changed.length) { lines.push('　変更'); r.changed.forEach(function (c) { lines.push('　' + caseLine_(c)); }); }
    if (r.restored.length) { lines.push('　キャンセルの取り消し（CSVに再び載った）'); r.restored.forEach(function (c) { lines.push('　' + caseLine_(c)); }); }
    if (r.held.length) { lines.push('　要確認：CSVに載っていない予約が ' + r.held.length + '件（多いため自動ではキャンセルにしていません。書き出しの条件を確かめてください）'); r.held.forEach(function (c) { lines.push('　' + caseLine_(c)); }); }
    if (r.added.length || r.cancelled.length || r.changed.length || r.held.length || r.restored.length) any = true;
  });
  if (!any) return;
  lines.push('', 'リールは' + cfg.checkTime + 'に「対応一覧」を確認してください。');
  mail_(both_(cfg), 'CSVを取り込みました', lines);
}

// ===== CSV の取り込み（置き場フォルダ・ファイルを選ぶ画面）=====

function decodeBlob_(blob) {
  var s = blob.getDataAsString('UTF-8');
  if (s.indexOf('�') >= 0) s = blob.getDataAsString('Shift_JIS');
  return s.replace(/^﻿/, '');
}

function subFolder_(folder, name) {
  var it = folder.getFoldersByName(name);
  return it.hasNext() ? it.next() : folder.createFolder(name);
}

function importFromFolder_(cfg, L, tours, now) {
  if (!cfg.folderId) return [];
  var folder;
  try { folder = DriveApp.getFolderById(cfg.folderId); } catch (err) { log_('エラー', null, 'CSVの置き場フォルダを開けません：' + err); return []; }
  var files = [], it = folder.getFiles();
  while (it.hasNext()) { var f = it.next(); if (/\.csv$/i.test(f.getName())) files.push(f); }
  files.sort(function (a, b) { return a.getDateCreated() - b.getDateCreated(); });
  return files.map(function (f) {
    var r = importCsv_(f.getName(), decodeBlob_(f.getBlob()), L, cfg, tours, now);
    f.moveTo(subFolder_(folder, r.error ? 'エラー' : '取込済み'));
    log_(r.error ? '取込エラー' : '取込', null, describe_(r));
    return r;
  });
}

function describe_(r) {
  if (r.error) return r.file + '：' + r.error;
  return r.src + ' ' + r.file + '：新規' + r.added.length + '・キャンセル' + r.cancelled.length + '・変更' + r.changed.length +
    (r.restored.length ? '・キャンセル取り消し' + r.restored.length : '') + (r.held.length ? '・要確認' + r.held.length : '') + '（対象外 ' + r.skipped + '行）';
}

function rememberImport_(results, now) {
  var ok = results.filter(function (r) { return !r.error; });
  if (!ok.length) return;
  var props = PropertiesService.getScriptProperties();
  var prev = {};
  try { prev = JSON.parse(props.getProperty('LAST_IMPORT_BY_SRC') || '{}'); } catch (e) { prev = {}; }
  ok.forEach(function (r) { prev[r.src] = fmtDT_(now) + '（新規' + r.added.length + '・キャンセル' + r.cancelled.length + '・変更' + r.changed.length + '）'; });
  props.setProperty('LAST_IMPORT_BY_SRC', JSON.stringify(prev));
  props.setProperty('LAST_IMPORT', '最終取込：' + Object.keys(prev).sort().map(function (k) { return k + ' ' + prev[k]; }).join('　／　'));
  // 今日の合計（「対応一覧」のいちばん上に出す）
  var today = ymd_(now), t = {};
  try { t = JSON.parse(props.getProperty('TODAY_IMPORT') || '{}'); } catch (e) { t = {}; }
  if (t.day !== today) t = { day: today, added: 0, cancelled: 0, changed: 0, held: 0, files: [], events: [] };
  t.events = t.events || [];
  var ev = function (kind, list) { list.forEach(function (c) { t.events.push({ k: kind, id: String(c[H.ID]), at: fmtDT_(now).slice(-5) }); }); };
  ok.forEach(function (r) {
    t.added += r.added.length; t.cancelled += r.cancelled.length; t.changed += r.changed.length; t.held += r.held.length;
    t.files.push(r.src + ' ' + fmtDT_(now).slice(-5));
    ev('キャンセル', r.cancelled); ev('変更', r.changed); ev('キャンセル取り消し', r.restored); ev('要確認', r.held); ev('新規', r.added);
  });
  if (t.events.length > 80) t.events = t.events.slice(-80);
  props.setProperty('TODAY_IMPORT', JSON.stringify(t));
}

function todayImport_(now) {
  var t = {};
  try { t = JSON.parse(PropertiesService.getScriptProperties().getProperty('TODAY_IMPORT') || '{}'); } catch (e) { t = {}; }
  return t.day === ymd_(now) ? t : null;
}

// 「CSVを取り込む」画面から呼ばれる。files = [{ name, b64 }]
function importUploaded(files) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cfg = settings_(), tours = tours_(), now = now_(), L = ledger_();
    initManual_(L, now);
    var folder = null;
    try { folder = cfg.folderId ? DriveApp.getFolderById(cfg.folderId) : null; } catch (e) { folder = null; }
    // 同じ種類（NGT／NKT）のCSVを一度に2つ入れると、後のCSVで前のCSVの結果が打ち消されるため、1つずつにしてもらう
    var kinds = {};
    (files || []).forEach(function (f) { var k = sourceOf_(f.name, null) || f.name; kinds[k] = (kinds[k] || 0) + 1; });
    var dup = Object.keys(kinds).filter(function (k) { return kinds[k] > 1 && (k === 'NGT' || k === 'NKT'); });
    if (dup.length) return { ok: false, message: dup.join('・') + ' のCSVが2つ以上選ばれています。種類ごとに1つずつ選んでください（NGT＝kiranah-resort-、NKT＝tryhard-）。' };
    var results = (files || []).map(function (f) {
      var blob = Utilities.newBlob(Utilities.base64Decode(f.b64), 'text/csv', f.name);
      var r = importCsv_(f.name, decodeBlob_(blob), L, cfg, tours, now);
      if (folder) subFolder_(folder, r.error ? 'エラー' : '取込済み').createFile(blob);
      log_(r.error ? '取込エラー' : '取込', null, describe_(r));
      return r;
    });
    rememberImport_(results, now);
    var list = refreshAll_(L, cfg, now);
    if (sortLedger_(L, cfg, now)) { L = ledger_(); list = refreshAll_(L, cfg, now); }
    ensureReportLinks_(L, list);
    renderTodo_(L, cfg, now, list);
    importSummaryMail_(cfg, results);
    var lines = function (list) { return list.map(caseLine_); };
    return { ok: true, files: results.map(function (r) {
      return { src: r.src, file: r.file, error: r.error, skipped: r.skipped, added: lines(r.added), cancelled: lines(r.cancelled),
        changed: lines(r.changed), restored: lines(r.restored), held: lines(r.held) };
    }) };
  } finally { lock.releaseLock(); }
}

var UPLOAD_HTML = '<!doctype html><html><head><base target="_top"><style>' +
  'body{font-family:sans-serif;font-size:14px;margin:0;padding:6px;color:#1b2440}' +
  'button{background:#1f2d52;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:14px;margin-top:10px;cursor:pointer}' +
  '#done{display:none;margin-top:12px}.ok{background:#e6f4ea;border:2px solid #34a853;border-radius:10px;padding:12px 14px;font-size:18px;font-weight:bold;color:#137333}' +
  '.ng{background:#fce8e6;border:2px solid #d93025;border-radius:10px;padding:12px 14px;font-size:15px;font-weight:bold;color:#b42318}' +
  '.file{border:1px solid #ddd;border-radius:8px;padding:10px 12px;margin-top:10px}.file b{font-size:15px}' +
  '.nums{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap}.nums span{border-radius:6px;padding:4px 10px;font-weight:bold}' +
  '.n1{background:#d9ead3}.n2{background:#f8c9c4}.n3{background:#fff2cc}.n0{background:#eee;color:#777}' +
  '.lst{margin:4px 0 0 0;padding-left:18px;font-size:13px}.lst li{margin:2px 0}.cap{font-weight:bold;font-size:13px;margin-top:6px}' +
  '</style></head><body>' +
  '<p>LINKTIVITY から書き出した CSV を選んでください。<br><b>kiranah-resort-…（NGT）</b>と<b>tryhard-…（NKT）</b>を1つずつ、同時に選べます。</p>' +
  '<input type="file" id="f" accept=".csv" multiple><br><button id="b" onclick="go()">取り込む</button><div id="msg" style="margin-top:10px"></div><div id="done"></div>' +
  '<script>function b64(buf){var s="",a=new Uint8Array(buf);for(var i=0;i<a.length;i+=8192)s+=String.fromCharCode.apply(null,a.subarray(i,i+8192));return btoa(s)}' +
  'function esc(t){return String(t).replace(/[&<>]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}' +
  'function lst(cap,a){return a.length?"<div class=cap>"+cap+"</div><ul class=lst>"+a.map(function(x){return"<li>"+esc(x)+"</li>"}).join("")+"</ul>":""}' +
  'function show(r){var d=document.getElementById("done");d.style.display="block";document.getElementById("msg").textContent="";' +
  'if(!r.ok){d.innerHTML="<div class=ng>"+esc(r.message)+"</div>";document.getElementById("b").disabled=false;return}' +
  'var t={a:0,c:0,ch:0};r.files.forEach(function(f){if(!f.error){t.a+=f.added.length;t.c+=f.cancelled.length;t.ch+=f.changed.length}});' +
  'var err=r.files.some(function(f){return f.error});' +
  'var h=err?"<div class=ng>取り込めなかったファイルがあります（下をご覧ください）</div>":"<div class=ok>✓ 取り込みが終わりました　新規 "+t.a+"件・キャンセル "+t.c+"件・変更 "+t.ch+"件</div>";' +
  'r.files.forEach(function(f){h+="<div class=file><b>"+(f.src||"？")+"　"+esc(f.file)+"</b>";' +
  'if(f.error){h+="<div style=\'color:#b42318;margin-top:6px\'>× "+esc(f.error)+"</div></div>";return}' +
  'h+="<div class=nums><span class="+(f.added.length?"n1":"n0")+">新規 "+f.added.length+"件</span><span class="+(f.cancelled.length?"n2":"n0")+">キャンセル "+f.cancelled.length+"件</span><span class="+(f.changed.length?"n3":"n0")+">変更 "+f.changed.length+"件</span></div>";' +
  'h+=lst("キャンセルになった予約",f.cancelled)+lst("新しい予約",f.added)+lst("変更があった予約",f.changed)+lst("キャンセルを取り消した予約（CSVに再び載った）",f.restored)+lst("要確認（CSVに載っていない）",f.held)+"</div>"});' +
  'h+="<button onclick=google.script.host.close()>閉じる</button>";d.innerHTML=h}' +
  'function go(){var fs=[].slice.call(document.getElementById("f").files);var m=document.getElementById("msg");document.getElementById("done").style.display="none";if(!fs.length){m.textContent="ファイルを選んでください";return}' +
  'document.getElementById("b").disabled=true;m.textContent="取り込み中…（数十秒かかることがあります）";Promise.all(fs.map(function(f){return f.arrayBuffer().then(function(b){return{name:f.name,b64:b64(b)}})}))' +
  '.then(function(x){google.script.run.withSuccessHandler(show).withFailureHandler(function(e){show({ok:false,message:"エラー："+e.message})}).importUploaded(x)})}</script></body></html>';

function showUpload() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(UPLOAD_HTML).setWidth(520).setHeight(560), 'CSVを取り込む');
}

// ===== 完了報告フォーム =====

function form_() {
  var id = PropertiesService.getScriptProperties().getProperty('FORM_ID');
  if (!id) return null;
  try { return FormApp.openById(id); } catch (e) { return null; }
}

// フォームは手順ごとに作る。1回の実行（6分まで）で終わらなくても、次の実行で続きから作る
function formHeader_(form) {
  form.setTitle('NINJA GO TOURS 完了報告（ガイド用）')
    .setDescription('ツアーが終わったら、その日のうちに送ってください（2〜3分）。【必須】は必ず答えてください。【任意】は分かる範囲で。')
    .setConfirmationMessage('ありがとうございました。完了報告を受け付けました。')
    .setCollectEmail(false)
    .setAllowResponseEdits(false);
  try { form.setRequireLogin(false); } catch (e) { /* Workspace の設定で変えられない場合がある */ }
}
function formBase_(form) {
  form.addTextItem().setTitle(Q.ID).setHelpText('リンクから開くと自動で入ります').setRequired(true);
  form.addTextItem().setTitle(Q.GUIDE).setRequired(true);
  var mc = function (title, choices) { form.addMultipleChoiceItem().setTitle(title).setChoiceValues(choices).setRequired(true); };
  mc(Q.MEET, A.MEET);
  mc(Q.ROUTE, A.ROUTE);
  mc(Q.END, A.END);
  mc(Q.NOTICE, A.NOTICE);
  mc(Q.TROUBLE, A.TROUBLE);
  form.addScaleItem().setTitle(Q.REACTION).setBounds(1, 5).setLabels('盛り上がらなかった', 'とても盛り上がった').setRequired(true);
  mc(Q.REVIEW, A.REVIEW);
  form.addParagraphTextItem().setTitle(Q.DETAIL).setHelpText('「合流できなかった」「一部を省いた」「あった」を選んだときは必ず書いてください');
  form.addListItem().setTitle(Q.TOUR).setHelpText('リンクから開くと自動で入ります').setRequired(true).setChoiceValues(['（ツアー）']);
}
function tourPageTitle_(t) { return '【任意】' + t.name + ' の行程について'; }
function formTourPage_(form, t) {
  form.addPageBreakItem().setTitle(tourPageTitle_(t));
  if (t.stops.length) {
    form.addMultipleChoiceItem().setTitle(Q.BEST + '（' + t.name + '）').setChoiceValues(t.stops);
    form.addMultipleChoiceItem().setTitle(Q.LATE + '（' + t.name + '）').setChoiceValues(['なし'].concat(t.stops));
  }
}
function formFinal_(form) {
  form.addPageBreakItem().setTitle('【任意】そのほか');
  form.addMultipleChoiceItem().setTitle(Q.PHOTO).setChoiceValues(A.PHOTO);
  form.addParagraphTextItem().setTitle(Q.IMPROVE);
  form.addParagraphTextItem().setTitle(Q.OTHER);
}
// ツアーを選ぶと、そのツアーのページへ進み、最後に「そのほか」へ進むようにつなぐ
function formLink_(form, tours) {
  var byTitle = {}, list = null;
  form.getItems().forEach(function (it) {
    var t = it.getTitle();
    if (t === Q.TOUR) list = it.asListItem();
    else if (it.getType() === FormApp.ItemType.PAGE_BREAK) byTitle[t] = it.asPageBreakItem();
  });
  var finalPage = byTitle['【任意】そのほか'];
  var choices = [];
  tours.forEach(function (t) {
    var p = byTitle[tourPageTitle_(t)];
    if (!p) return;
    choices.push(list.createChoice(t.name, p));
    p.setGoToPage(finalPage);
  });
  list.setChoices(choices);
}

// 返り値：最後まで作れたら true、時間切れで途中なら false
function buildFormSteps_(form, tours, props, deadline) {
  var step = num_(props.getProperty('FORM_STEP'), 0);
  var count = num_(props.getProperty('FORM_COUNT'), 0);
  // 前回、途中で止まった手順の作りかけを消す
  var items = form.getItems();
  for (var i = items.length - 1; i >= count; i--) form.deleteItem(items[i]);
  var total = tours.length + 3;
  while (step < total) {
    if (Date.now() > deadline) return false;
    if (step === 0) { formHeader_(form); formBase_(form); }
    else if (step <= tours.length) formTourPage_(form, tours[step - 1]);
    else if (step === tours.length + 1) formFinal_(form);
    else formLink_(form, tours);
    step++;
    props.setProperty('FORM_STEP', String(step));
    props.setProperty('FORM_COUNT', String(form.getItems().length));
  }
  return true;
}

// 新しいフォームを作り直す準備（前のフォームはゴミ箱へ）
function newForm_(props) {
  var old = props.getProperty('FORM_ID');
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (e) { /* なければよい */ } }
  var form = FormApp.create('NINJA GO TOURS 完了報告（ガイド用）');
  props.setProperty('FORM_ID', form.getId());
  props.setProperty('FORM_STEP', '0');
  props.setProperty('FORM_COUNT', '0');
  props.deleteProperty('FORM_READY');
  return form;
}

// フォームを用意する。終わったら true
function ensureForm_(ss, props, deadline) {
  var form = form_();
  if (props.getProperty('FORM_READY') === '1' && form) return { form: form, done: true };
  if (!form || props.getProperty('FORM_STEP') === null) form = newForm_(props);
  if (!buildFormSteps_(form, tours_(), props, deadline)) return { form: form, done: false };
  if (Date.now() > deadline) return { form: form, done: false };
  var dest = '';
  try { dest = form.getDestinationId() || ''; } catch (e) { dest = ''; }
  if (dest !== ss.getId()) form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  var report = ss.getSheetByName(SHEETS.REPORT);
  ss.getSheets().forEach(function (s) {
    var u = '';
    try { u = s.getFormUrl() || ''; } catch (e) { u = ''; }
    if (!u || s.getName() === SHEETS.REPORT) return;
    if (u.indexOf(form.getId()) >= 0) {
      if (report) report.setName(SHEETS.REPORT + '（旧）');
      s.setName(SHEETS.REPORT);
      report = s;
    }
  });
  props.setProperty('FORM_READY', '1');
  return { form: form, done: true };
}

function reportLink_(form, items, id, tourName) {
  var resp = form.createResponse().withItemResponse(items.id.createResponse(id));
  if (tourName && items.tourNames.indexOf(tourName) >= 0) resp = resp.withItemResponse(items.tour.createResponse(tourName));
  return resp.toPrefilledUrl();
}

// まだリンクがない案件に、完了報告フォームのリンク（案件ID入り）を付ける
function ensureReportLinks_(L, list) {
  var need = (list || []).filter(function (c) {
    var st = c._d ? c._d.step : '';
    return !String(c[H.REPORT] || '').trim() && st && ['cxok', 'cxdone', 'done', 'input'].indexOf(st) < 0 && !c[H.T_REPORT];
  });
  if (!need.length) return 0;
  var form = form_();
  if (!form) return 0;
  var items = { id: null, tour: null, tourNames: [] };
  form.getItems().forEach(function (it) {
    if (it.getTitle() === Q.ID) items.id = it.asTextItem();
    if (it.getTitle() === Q.TOUR) { items.tour = it.asListItem(); items.tourNames = items.tour.getChoices().map(function (ch) { return ch.getValue(); }); }
  });
  if (!items.id) return 0;
  var col = colOf_(L, H.REPORT);
  need.forEach(function (c) {
    var url = reportLink_(form, items, String(c[H.ID]), String(c[H.TOUR] || ''));
    L.sh.getRange(c._row, col).setFormula('=HYPERLINK("' + url.replace(/"/g, '""') + '","報告フォーム")');
    c[H.REPORT] = '報告フォーム';
  });
  return need.length;
}

function first_(nv, title) {
  var v = nv[title];
  return v && v.length ? String(v[0]).trim() : '';
}
function startsWithKey_(nv, prefix) {
  var out = '';
  Object.keys(nv).forEach(function (k) { if (k.indexOf(prefix) === 0 && first_(nv, k)) out = first_(nv, k); });
  return out;
}

// フォームの回答（namedValues）を案件に書く。返り値は { case, urgent: [] }
function applyReport_(L, nv, now) {
  var id = first_(nv, Q.ID).toUpperCase().replace(/\s/g, '');
  var c = findCase_(L, id);
  if (!c) return { c: null, id: id, urgent: ['案件ID「' + id + '」が台帳にありません'] };
  var meet = first_(nv, Q.MEET), trouble = first_(nv, Q.TROUBLE), reaction = first_(nv, Q.REACTION), review = first_(nv, Q.REVIEW);
  var route = first_(nv, Q.ROUTE), detail = first_(nv, Q.DETAIL);
  c[H.T_REPORT] = now;
  if (!String(c[H.GUIDE] || '').trim()) c[H.GUIDE] = first_(nv, Q.GUIDE);
  var sum = ['反応 ' + reaction + '/5', '合流：' + meet, '行程：' + route, '終了：' + first_(nv, Q.END), 'レビュー：' + review, 'トラブル：' + trouble];
  var best = startsWithKey_(nv, Q.BEST), late = startsWithKey_(nv, Q.LATE);
  if (best) sum.push('盛り上がった：' + best);
  if (late && late !== 'なし') sum.push('押した：' + late);
  if (detail) sum.push('内容：' + detail);
  var imp = first_(nv, Q.IMPROVE);
  if (imp) sum.push('改善：' + imp);
  var urgent = [];
  if (meet === A.MEET[2]) urgent.push('ゲストと合流できなかった');
  if (trouble === A.TROUBLE[1]) urgent.push('ケガ・トラブル・苦情があった');
  if (num_(reaction, 5) <= 2) urgent.push('ゲストの反応が ' + reaction + '/5');
  c[H.REPORT_SUM] = (urgent.length ? '【至急】' : '') + sum.join('／');
  c[H.ALERTED] = '';
  return { c: c, id: id, urgent: urgent, detail: detail };
}

// フォームが送られたとき（インストール型トリガー）
function onReport(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cfg = settings_(), now = now_(), L = ledger_();
    var r = applyReport_(L, (e && e.namedValues) || {}, now);
    if (r.c) {
      saveCase_(L, r.c);
      L.sh.getRange(r.c._row, colOf_(L, H.REPORT)).setValue('報告済み ' + fmtDT_(now));
      log_('完了報告', r.c, r.c[H.REPORT_SUM]);
    } else log_('完了報告', null, r.urgent.join('、'));
    if (r.urgent.length && (r.c ? isTest_(r.c) : /^TEST-/.test(String(r.id || '')))) log_('見本のためメールなし', r.c, '【至急】完了報告：' + r.urgent.join('・'));
    else if (r.urgent.length) {
      mail_(both_(cfg), '【至急】完了報告：' + r.urgent.join('・'),
        [r.c ? caseLine_(r.c) : '案件ID：' + r.id].concat(r.urgent.map(function (x) { return '・' + x; }))
          .concat(r.detail ? ['', '内容：' + r.detail] : []));
    }
    var list = refreshAll_(L, cfg, now);
    renderTodo_(L, cfg, now, list);
  } finally { lock.releaseLock(); }
}

// ===== トリガー =====

// 台帳を人が書き換えたとき（インストール型トリガー）
function onBoardEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (sh.getName() !== SHEETS.LEDGER || e.range.getRow() < 2) return;
  PropertiesService.getScriptProperties().setProperty('LAST_EDIT', String(now_().getTime()));
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    var cfg = settings_(), now = now_(), L = ledger_();
    var r1 = e.range.getRow(), r2 = r1 + e.range.getNumRows() - 1;
    var c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
    var user = '';
    try { user = e.user && e.user.getEmail ? e.user.getEmail() : ''; } catch (x) { user = ''; }
    initManual_(L, now);
    L.rows.forEach(function (c) {
      if (c._row < r1 || c._row > r2) return;
      var touched = false;
      for (var col = c1; col <= c2; col++) if (applyCheck_(c, L.head[col - 1], now, user)) touched = true;
      if (touched) saveCase_(L, c);
    });
    var list = refreshAll_(L, cfg, now);
    ensureReportLinks_(L, list);
    renderTodo_(L, cfg, now, list);
  } finally { lock.releaseLock(); }
}

// 10分おき：置き場の CSV を取り込み、状態を更新し、期限切れを知らせる
function poll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    try { ensureSettingRows_(); } catch (err) { log_('設定の項目の追加に失敗', null, String(err)); }
    var cfg = settings_(), tours = tours_(), now = now_(), L = ledger_();
    initManual_(L, now);
    var results = importFromFolder_(cfg, L, tours, now);
    rememberImport_(results, now);
    var list = refreshAll_(L, cfg, now);
    // 並べ替えは、取り込んだときと、20分だれも台帳を触っていないときだけ（作業中に行が動かないように）
    var lastEdit = num_(PropertiesService.getScriptProperties().getProperty('LAST_EDIT'), 0);
    if ((results.length || now.getTime() - lastEdit > 20 * MIN_MS) && sortLedger_(L, cfg, now)) { L = ledger_(); list = refreshAll_(L, cfg, now); }
    ensureReportLinks_(L, list);
    alertOverdue_(L, cfg, now, list);
    renderTodo_(L, cfg, now, list);
    if (results.length) importSummaryMail_(cfg, results);
  } finally { lock.releaseLock(); }
}

// 毎日19時：翌日分に未手配があれば、20時の期限の前に知らせる
function eveningCheck() {
  var cfg = settings_(), now = now_(), L = ledger_();
  var tomorrow = ymd_(new Date(now.getTime() + DAY_MS));
  var open = L.rows.filter(function (c) { return c[H.ID] && !isTest_(c); }).map(function (c) { c._d = derive_(c, cfg, now); return c; })
    .filter(function (c) { return c._d.step === 'accept' || c._d.step === 'arrange'; });
  var hard = open.filter(function (c) { return toYmd_(c[H.DATE]) === tomorrow; });
  // 目安が今日の期限の時刻までに来るもの（今夜目安を迎える分も含めて、19時に先に知らせる）
  var tonight = dayAt_(ymd_(now), 0, cfg.arrangeDeadline).getTime();
  var soft = open.filter(function (c) { return toYmd_(c[H.DATE]) > tomorrow && c._d.soft && c._d.soft.getTime() <= tonight; });
  if (!hard.length && !soft.length) return;
  var lines = [];
  if (hard.length) {
    lines.push('▼ 明日（' + fmtMD_(tomorrow) + '）のツアーで未手配 ' + hard.length + '件。今日' + cfg.arrangeDeadline + 'が期限です');
    hard.forEach(function (c) { lines.push(caseLine_(c)); });
    lines.push('');
  }
  if (soft.length) {
    lines.push('▼ 手配の目安（催行の' + cfg.softDays + '日前）を過ぎた未手配 ' + soft.length + '件');
    soft.forEach(function (c) { lines.push(caseLine_(c) + '（期限 ' + fmtDT_(c._d.due) + '）'); });
  }
  mail_(both_(cfg), (hard.length ? '明日のツアーで未手配が ' + hard.length + '件' : '手配の目安を過ぎた予約が ' + soft.length + '件'), lines);
}

// ===== 手入力（メール・インフルエンサーの予約）=====

function esc_(v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function manualFormHtml_(tours) {
  var opts = tours.map(function (t) { return '<option>' + esc_(t.name) + '</option>'; }).join('');
  return '<!doctype html><html><head><base target="_top"><style>' +
    'body{font-family:sans-serif;font-size:14px;margin:0;padding:6px}label{display:block;margin:10px 0 4px;font-weight:bold}' +
    'input,select,textarea{width:100%;box-sizing:border-box;font-size:14px;padding:7px;border:1px solid #bbb;border-radius:6px}' +
    '.row{display:flex;gap:10px}.row>div{flex:1}.req{color:#c0392b}' +
    'button{margin-top:14px;background:#1f2d52;color:#fff;border:0;border-radius:6px;padding:10px 18px;font-size:14px}' +
    '#o{margin-top:10px;white-space:pre-wrap}</style></head><body>' +
    '<label>経路 <span class="req">*</span></label><select id="route"><option>メール</option><option>インフルエンサー</option><option>その他</option></select>' +
    '<div class="row"><div><label>催行日 <span class="req">*</span></label><input type="date" id="date"></div>' +
    '<div><label>開始 <span class="req">*</span></label><input type="time" id="time" step="300"></div></div>' +
    '<label>ツアー <span class="req">*</span></label><select id="tour">' + opts + '</select>' +
    '<div class="row"><div><label>大人 <span class="req">*</span></label><input type="number" id="adult" min="1" value="2"></div>' +
    '<div><label>子ども（12歳以下）</label><input type="number" id="child" min="0" value="0"></div></div>' +
    '<label>代表者名（インフルエンサーはアカウント名でも可） <span class="req">*</span></label><input id="name">' +
    '<label>連絡先（メール・電話・DMなど）</label><input id="contact">' +
    '<label>メモ（招待・投稿予定日など）</label><textarea id="memo" rows="2"></textarea>' +
    '<button id="b" onclick="go()">台帳に登録する</button><div id="o"></div>' +
    '<script>function v(i){return document.getElementById(i).value.trim()}' +
    'function go(){var o=document.getElementById("o");var d={route:v("route"),date:v("date"),time:v("time"),tour:v("tour"),adult:v("adult"),child:v("child"),name:v("name"),contact:v("contact"),memo:v("memo")};' +
    'if(!d.date||!d.time||!d.tour||!(+d.adult>0)||!d.name){o.textContent="＊の項目を入れてください";return}' +
    'document.getElementById("b").disabled=true;o.textContent="登録しています…";' +
    'google.script.run.withSuccessHandler(function(r){o.textContent=r;document.getElementById("b").disabled=false;["name","contact","memo"].forEach(function(i){document.getElementById(i).value=""})})' +
    '.withFailureHandler(function(e){o.textContent="エラー："+e.message;document.getElementById("b").disabled=false}).addManual(d)}</script></body></html>';
}

function showManual() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(manualFormHtml_(tours_())).setWidth(440).setHeight(600), '予約を手入力する（メール・インフルエンサー）');
}

// 手入力の画面から呼ばれる
function addManual(o) {
  var ymd = toYmd_(o && o.date), hm = toHm_(o && o.time), adult = num_(o && o.adult, 0);
  if (!ymd || !hm || !o.tour || adult < 1 || !String(o.name || '').trim()) throw new Error('＊の項目を入れてください');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cfg = settings_(), now = now_(), L = ledger_();
    var c = {};
    c[H.ID] = nextCaseId_(L.rows);
    c[H.DATE] = ymd; c[H.TIME] = hm; c[H.TOUR] = String(o.tour); c[H.ADULT] = adult; c[H.CHILD] = num_(o.child, 0) || '';
    c[H.NAME] = String(o.name).trim(); c[H.CONTACT] = String(o.contact || '').trim(); c[H.ROUTE] = String(o.route || 'メール');
    c[H.MEMO] = String(o.memo || '').trim(); c[H.SRC] = '手入力'; c[H.T_CREATED] = now;
    appendCase_(L, c);
    log_('手入力', c, '画面から登録（経路：' + c[H.ROUTE] + '）');
    L = ledger_();
    var list = refreshAll_(L, cfg, now);
    if (sortLedger_(L, cfg, now)) { L = ledger_(); list = refreshAll_(L, cfg, now); }
    ensureReportLinks_(L, list);
    renderTodo_(L, cfg, now, list);
    return '登録しました：' + c[H.ID] + '（' + fmtMD_(ymd) + ' ' + hm + ' ' + c[H.TOUR] + '）\n続けて登録できます。終わったら閉じてください。';
  } finally { lock.releaseLock(); }
}

// ===== テスト（見本の予約で流れを体験する）=====

var TEST_SHEET = 'テストの手順';

function isTest_(c) { return /^TEST-/.test(String(c[H.ID] || '')) || /^TEST-/.test(String(c[H.BOOKING] || '')); }

// 見本の予約を、それぞれ違う段階で台帳に入れる（名前・連絡先はすべて架空）
function seedTest() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cfg = settings_(), now = now_();
    removeTestRows_();
    var L = ledger_();
    var day = function (n) { return ymd_(new Date(now.getTime() + n * DAY_MS)); };
    var ago = function (h) { return new Date(now.getTime() - h * H_MS); };
    var samples = [
      { id: 'TEST-01', d: 1, t: '17:00', tour: '秘境神社 Ninja Walk', a: 2, route: '公式直販', name: '見本 A' },
      { id: 'TEST-02', d: 3, t: '19:30', tour: 'NKTセット（秘境神社）', a: 2, route: 'NKTセット（Klook）', name: '見本 B', accept: 2 },
      { id: 'TEST-03', d: 2, t: '18:00', tour: '浅草ナイト', a: 2, k: 1, route: 'Viator', name: '見本 C', accept: 20, arrange: 5, guide: 'ガイドA（見本）' },
      { id: 'TEST-04', d: -1, t: '17:00', tour: 'ゴールデン街ナイト', a: 3, route: '公式直販', name: '見本 D', accept: 50, arrange: 40, guest: 30, guide: 'ガイドB（見本）' },
      { id: 'TEST-05', d: -2, t: '11:00', tour: 'ハンコ作り', a: 1, route: 'Klook', name: '見本 E', accept: 80, arrange: 70, guest: 60, guide: 'ガイドC（見本）', report: 40 },
      { id: 'TEST-06', d: 0, t: '21:00', tour: '秘境神社 Ninja Walk', a: 2, route: 'GetYourGuide', name: '見本 F', created: 30 },
      { id: 'TEST-07', d: 4, t: '17:30', tour: '新宿二丁目 LGBTQ+', a: 2, route: '公式直販', name: '見本 G', accept: 3, cancel: 1 },
      { id: 'TEST-08', d: 5, t: '11:00', tour: '合羽橋', a: 2, route: 'Klook', name: '見本 H', cancel: 2, created: 3 }
    ];
    samples.forEach(function (x) {
      var c = {};
      c[H.ID] = x.id; c[H.DATE] = day(x.d); c[H.TIME] = x.t; c[H.TOUR] = x.tour; c[H.ADULT] = x.a; c[H.CHILD] = x.k || '';
      c[H.NAME] = x.name + '（見本）'; c[H.CONTACT] = 'sample@example.com'; c[H.ROUTE] = x.route; c[H.MEMO] = 'テスト用の見本です';
      c[H.BOOKING] = 'TEST-' + x.id.slice(5); c[H.SRC] = 'テスト'; c[H.T_CREATED] = x.created ? ago(x.created) : x.accept ? ago(x.accept + 1) : now;
      if (x.guide) c[H.GUIDE] = x.guide;
      if (x.accept) { c[H.ACCEPT] = true; c[H.T_ACCEPT] = ago(x.accept); }
      if (x.arrange) { c[H.ARRANGE] = true; c[H.T_ARRANGE] = ago(x.arrange); }
      if (x.guest) { c[H.GUEST] = true; c[H.T_GUEST] = ago(x.guest); }
      if (x.report) {
        c[H.T_REPORT] = ago(x.report);
        c[H.REPORT_SUM] = '反応 5/5／合流：予定どおり合流した／行程：すべて回った／終了：予定どおり／レビュー：その場で書いてもらった／トラブル：なかった／盛り上がった：印章店で注文（見本）';
      }
      if (x.cancel) { c[H.T_CX] = ago(x.cancel); c[H.CX_REASON] = 'CSVに載っていない（キャンセルとみなす）'; c[H.NOTE] = '見本：CSVから消えたためキャンセル'; }
      c[H.ALERTED] = 'test';   // 見本は入れた直後に通知を送らない（段階が進むと通常どおり通知する）
      appendCase_(L, c);
    });
    L = ledger_();
    var list = refreshAll_(L, cfg, now);
    if (sortLedger_(L, cfg, now)) { L = ledger_(); list = refreshAll_(L, cfg, now); }
    ensureReportLinks_(L, list);
    L.rows.filter(function (c) { return c[H.ID] === 'TEST-05'; }).forEach(function (c) {
      L.sh.getRange(c._row, colOf_(L, H.REPORT)).setValue('報告済み（見本）');
    });
    renderTodo_(L, cfg, now, list);
    writeTestGuide_();
    log_('テスト', null, '見本の予約を8件入れました');
    try { SpreadsheetApp.getUi().alert('見本の予約を8件入れました。\n「テストの手順」のシートの順に試してください。終わったら、メニュー「テスト：見本の予約を消す」で消せます。'); } catch (e) { /* エディタから実行 */ }
  } finally { lock.releaseLock(); }
}

function removeTestRows_() {
  var L = ledger_();
  var rows = L.rows.filter(isTest_).map(function (c) { return c._row; }).sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { L.sh.deleteRow(r); });
  return rows.length;
}

function clearTest() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var n = removeTestRows_();
    var g = ss_().getSheetByName(TEST_SHEET);
    if (g) ss_().deleteSheet(g);
    var cfg = settings_(), now = now_(), L = ledger_();
    renderTodo_(L, cfg, now, refreshAll_(L, cfg, now));
    log_('テスト', null, '見本の予約を' + n + '件消しました');
    try { SpreadsheetApp.getUi().alert('見本の予約を' + n + '件消しました。'); } catch (e) { /* エディタから実行 */ }
  } finally { lock.releaseLock(); }
}

function writeTestGuide_() {
  var ss = ss_();
  var sh = ss.getSheetByName(TEST_SHEET) || ss.insertSheet(TEST_SHEET, 0);
  var rows = [
    ['テストの手順（見本の予約で、受付からキャンセル・完了までを体験します）', '', '', ''],
    ['順', 'だれ', 'やること', 'こうなればOK'],
    ['1', 'みんな', '「対応一覧」を開く。いちばん上の取り込み件数と、リール様・キラナそれぞれのやることを見る', '見本（TEST-01〜08）が「受注してください」「ガイドを手配してください」などに分かれて並ぶ'],
    ['2', 'リール', 'TEST-01（受注してください）の「TEST-01 を開く」を押して台帳へ。色の付いた欄（①受注）に✓', 'TEST-01 が「ガイドを手配してください」に移る'],
    ['3', 'リール', 'TEST-02（ガイドを手配してください）のガイド名に「ガイドX」と入れ、色の付いた欄（②手配完了）に✓', '「ゲストに連絡してください」に移る'],
    ['4', 'リール・ガイド', 'TEST-03（ゲストに連絡してください）の色の付いた欄（③ゲスト連絡）に✓。ガイドが付けてもよい', '「ガイドに完了報告を送ってもらってください」に移る（ツアーの後に出る）'],
    ['5', 'ガイド', 'TEST-04（ツアー済み）の台帳④「報告フォーム」を開き、案件IDが入っているのを確かめて回答・送信', 'キラナの「完了報告を読んで、受領してください」に移る。「合流できなかった」を選ぶと台帳の「報告の要約」に【至急】と出る（本番ではメールも届く）'],
    ['6', 'キラナ', 'TEST-05 の「報告の要約」を読み、色の付いた欄（⑤受領）に✓', '行が灰色になり「完了」'],
    ['7', 'リール', 'TEST-06（今日のツアーで、前日20時を過ぎても未手配）を見る。赤い「期限切れ」で出ている。手配できたらガイド名を入れて ②手配完了 に✓', '「ゲストに連絡してください」に移る。※キャンセルの手続きは手配ボードの外で行い、CSVから消えると「キャンセルが発生しました」に出る'],
    ['8', 'リール', 'TEST-07（キャンセルが発生しました）を確認し、色の付いた欄（キャンセル確認）に✓', '対応一覧から消え、台帳は灰色＋取り消し線になる。TEST-08 は受注前のキャンセルなので、はじめから「キャンセル済み」（だれも何もしなくてよい）'],
    ['9', 'キラナ', 'メニュー「予約を手入力する」で、経路「インフルエンサー」・催行日・開始・ツアー・人数・代表者名を入れて登録', '案件ID（NGT-…）が付き、リール様の「受注してください」に出る。※見本ではないので、試した後は台帳の行ごと削除'],
    ['10', 'キラナ', 'メニュー「CSVを取り込む」で、テスト用のCSV（kiranah-resort-test.csv と tryhard-test.csv）を選ぶ', '本日の取り込みに「新規 3件」。NKTはセット商品の1件だけ、時刻は19:30で入る'],
    ['11', 'リール', '取り込まれた「見本 I（テスト）」（11/18 秘境神社）を受注する', '「ガイドを手配してください」に移る'],
    ['12', 'キラナ', 'メニュー「CSVを取り込む」で、kiranah-resort-test-cancel.csv だけを選ぶ（見本 I が載っていないCSV＝キャンセルされた想定）', '取り込み画面に「キャンセルになった予約」として見本 I が出る。対応一覧の「本日のキャンセル」と、リール様の「キャンセルが発生しました」に出る（見本なのでメールは届かない）'],
    ['13', 'リール', '見本 I の色の付いた欄（キャンセル確認）に✓', '「キャンセル済み」になる'],
    ['14', 'みんな', '終わったら、メニュー「テスト：見本の予約を消す」', '見本（TEST-…）と、このシートが消える'],
    ['', '', '※ 見本（TEST-…）は、期限切れ・取り込み・完了報告のメールを一切送りません（本物の予約のメールは通常どおり）。メールを全部止めたいときは、設定シートの「メール通知」を OFF に。テスト用CSVは見本どうしだけで照らし合わせるので、本物の予約がキャンセル扱いになることはありません。', '']
  ];
  sh.clear();
  sh.getRange(1, 1, rows.length, 4).setValues(rows).setWrap(true).setVerticalAlignment('middle');
  sh.getRange(1, 1, 1, 4).setFontSize(14).setFontWeight('bold').setFontColor(COLORS.HEAD);
  sh.getRange(2, 1, 1, 4).setFontWeight('bold').setBackground('#eeeeee');
  var whoCol = rows.map(function (r) { return r[1] === 'リール' ? COLORS.REELU : r[1] === 'キラナ' ? COLORS.KIRA : r[1] === 'ガイド' ? COLORS.GUIDE : r[1] === 'リール・ガイド' ? COLORS.BOTH : COLORS.WHITE; });
  for (var i = 2; i < rows.length; i++) sh.getRange(i + 1, 2).setBackground(whoCol[i]);
  sh.getRange(2, 1, rows.length - 2, 4).setBorder(true, true, true, true, true, true, '#d0d0d0', SpreadsheetApp.BorderStyle.SOLID);
  sh.setColumnWidth(1, 40).setColumnWidth(2, 100).setColumnWidth(3, 520).setColumnWidth(4, 440);
  sh.setFrozenRows(2);
  ss.setActiveSheet(sh);
}

// ===== メニュー・初期設定 =====

function onOpen() {
  SpreadsheetApp.getUi().createMenu('NGT 手配ボード')
    .addItem('CSVを取り込む（ファイルを選ぶ）', 'showUpload')
    .addItem('予約を手入力する（メール・インフルエンサー）', 'showManual')
    .addItem('今すぐ更新（置き場のCSVも取り込む）', 'poll')
    .addItem('台帳を並べ替える（作業が必要な順）', 'sortLedger')
    .addItem('完了報告フォームのリンクを表示', 'showFormLink')
    .addSeparator()
    .addItem('テスト：見本の予約を入れる', 'seedTest')
    .addItem('テスト：見本の予約を消す', 'clearTest')
    .addSeparator()
    .addItem('完了報告フォームを作り直す（ツアーを変えたとき）', 'rebuildForm')
    .addItem('初期設定（最初に1回）', 'setup')
    .addToUi();
}

function showFormLink() {
  var f = form_();
  SpreadsheetApp.getUi().alert(f ? '完了報告フォーム：\n' + f.getPublishedUrl() + '\n\n案件ごとのリンク（案件ID入り）は、台帳の ④ 列にあります。' : '完了報告フォームがまだありません。「初期設定」を実行してください。');
}

function rebuildForm() {
  var props = PropertiesService.getScriptProperties(), ss = ss_();
  props.deleteProperty('FORM_STEP');
  props.deleteProperty('FORM_READY');
  var r = ensureForm_(ss, props, Date.now() + 270000);
  setValueByKey_(ss.getSheetByName(SHEETS.SETTINGS), '完了報告フォーム', r.form.getPublishedUrl());
  if (!r.done) { SpreadsheetApp.getUi().alert('フォームの作成が途中です。もう一度「完了報告フォームを作り直す」を実行すると、続きから作ります。'); return; }
  // 質問を作り直すとリンクが変わるので、未報告の案件のリンクを付け直す
  var L = ledger_(), col = colOf_(L, H.REPORT);
  L.rows.forEach(function (c) { if (!c[H.T_REPORT] && String(c[H.REPORT]).indexOf('報告済み') < 0) { L.sh.getRange(c._row, col).setValue(''); c[H.REPORT] = ''; } });
  var cfg = settings_(), now = now_();
  ensureReportLinks_(L, refreshAll_(L, cfg, now));
}

// シートをロックする。except の範囲だけはだれでも編集できる
function lockSheet_(sh, except) {
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { if (/^NGT/.test(p.getDescription())) p.remove(); });
  var p = sh.protect().setDescription('NGT ロック');
  if (except && except.length) p.setUnprotectedRanges(except);
  p.removeEditors(p.getEditors());
  if (p.canDomainEdit()) p.setDomainEdit(false);
  return p;
}

function setValueByKey_(sheet, key, value) {
  var v = sheet.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] === key) { sheet.getRange(i + 1, 2).setValue(value); return; }
  sheet.appendRow([key, value, '']);
}

function setup() {
  var startedAt = Date.now();
  var ss = ss_();
  ss.setSpreadsheetTimeZone('Asia/Tokyo');
  var props = PropertiesService.getScriptProperties();

  // 第1版のシートは残して名前を変える（中身は消さない）
  var oldLed = ss.getSheetByName(SHEETS.LEDGER);
  if (oldLed && oldLed.getLastRow() > 0 && String(oldLed.getRange(1, 2).getValue()) !== H.WHO) {
    [SHEETS.LEDGER, SHEETS.SETTINGS, SHEETS.TOURS].forEach(function (n) {
      var s = ss.getSheetByName(n);
      if (s && !ss.getSheetByName(n + '（第1版）')) s.setName(n + '（第1版）');
    });
  }

  var todo = todoSheet_() || ss.insertSheet(SHEETS.TODO, 0);
  todo.setColumnWidths(1, 1, 150).setColumnWidth(2, 380).setColumnWidths(3, 7, 110);

  var led = ss.getSheetByName(SHEETS.LEDGER) || ss.insertSheet(SHEETS.LEDGER, 1);
  // 廃止した列（キャンセル対応（キラナ））が残っていれば、列ごと消す（ほかの列の位置を見出しとそろえるため）
  if (led.getLastColumn() > 0) {
    var hd = led.getRange(1, 1, 1, led.getLastColumn()).getValues()[0].map(function (h) { return String(h).replace(/\n/g, ''); });
    var gone = hd.indexOf(H.CXKIRA);
    if (gone >= 0) {
      led.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { if (/^NGT/.test(p.getDescription())) p.remove(); });
      led.deleteColumn(gone + 1);
    }
  }
  var n = LEDGER_HEADERS.length, rows = led.getMaxRows() - 1;
  var col = function (name) { return LEDGER_HEADERS.indexOf(name) + 1; };
  led.getRange(1, 1, 1, n).setValues([LEDGER_HEADERS.map(dispHeader_)]);
  led.setFrozenRows(1);
  led.setFrozenColumns(1);
  led.getRange(1, 1, 1, n).setFontWeight('bold').setFontColor('#ffffff').setBackground('#6b7280').setWrap(true).setVerticalAlignment('middle');
  [H.ACCEPT, H.ARRANGE, H.CXOK, H.GUIDE].forEach(function (h) { led.getRange(1, col(h)).setBackground('#c2560c'); });
  led.getRange(1, col(H.GUEST)).setBackground('#3d8a94');
  led.getRange(1, col(H.RECEIVE)).setBackground('#1d4ed8');
  led.getRange(1, col(H.REPORT)).setBackground('#15803d');
  [H.DATE, H.TIME, H.TOUR, H.ADULT, H.CHILD, H.NAME, H.CONTACT, H.ROUTE, H.MEMO].forEach(function (h) { led.getRange(1, col(h)).setBackground('#1f2d52'); });
  led.setRowHeight(1, 48);
  led.getRange(1, 1, 1, n).setHorizontalAlignment('center');
  led.getRange(2, 1, rows, n).setVerticalAlignment('middle');
  // 予約番号から右（記録用の列）はまとめて折りたたむ。左上の「＋」で開ける
  var g1 = col(H.BOOKING);
  if (led.getColumnGroupDepth(g1) === 0) led.getRange(1, g1, 1, n - g1 + 1).shiftColumnGroupDepth(1);
  led.collapseAllColumnGroups();
  // 見出しに絞り込み（フィルタ）を付ける
  if (!led.getFilter()) led.getRange(1, 1, led.getMaxRows(), n).createFilter();
  led.getRange(2, col(H.DATE), rows, 1).setNumberFormat('yyyy-mm-dd');
  [H.TIME, H.BOOKING, H.AGENT, H.ID].forEach(function (h) { led.getRange(2, col(h), rows, 1).setNumberFormat('@'); });
  [H.DUE, H.T_CREATED, H.T_ACCEPT, H.T_ARRANGE, H.T_GUEST, H.T_REPORT, H.T_RECEIVE, H.T_CX, H.T_CXOK].forEach(function (h) {
    led.getRange(2, col(h), rows, 1).setNumberFormat('m/d(ddd) hh:mm');
  });
  var cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  [H.ACCEPT, H.ARRANGE, H.GUEST, H.RECEIVE, H.CXOK].forEach(function (h) { led.getRange(2, col(h), rows, 1).setDataValidation(cb); });
  led.getRange(2, col(H.ROUTE), rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ROUTE_CHOICES, true).setAllowInvalid(true).build());
  var widths = {}; widths[H.ID] = 95; widths[H.WHO] = 95; widths[H.TODO] = 260; widths[H.DUE] = 125; widths[H.ST] = 175;
  widths[H.DATE] = 100; widths[H.TIME] = 60; widths[H.TOUR] = 180; widths[H.ADULT] = 55; widths[H.CHILD] = 60; widths[H.NAME] = 160;
  widths[H.CONTACT] = 200; widths[H.ROUTE] = 160; widths[H.MEMO] = 200; widths[H.GUIDE] = 120; widths[H.NOTE] = 280; widths[H.REPORT_SUM] = 360;
  [H.ACCEPT, H.ARRANGE, H.GUEST, H.REPORT, H.RECEIVE, H.CXOK].forEach(function (h) { widths[h] = 92; });
  [H.ACCEPT, H.ARRANGE, H.GUEST, H.RECEIVE, H.CXOK].forEach(function (h) { led.getRange(2, col(h), rows, 1).setHorizontalAlignment('center'); });
  Object.keys(widths).forEach(function (h) { led.setColumnWidth(col(h), widths[h]); });
  led.getRange(2, col(H.TODO), rows, 1).setWrap(true);
  led.getRange(2, col(H.NOTE), rows, 1).setWrap(true);
  var notes = {};
  notes[H.WHO] = 'スクリプトが書く。オレンジ＝リール、青＝キラナ、緑＝ガイド、赤＝期限切れ';
  notes[H.ROUTE] = 'メール・インフルエンサーの予約は、メニュー「予約を手入力する」から登録する（空いている行に直接書いてもよい。案件IDは自動で付く）';
  notes[H.ACCEPT] = 'リール：内容を見て受けたら✓';
  notes[H.ARRANGE] = 'リール：ガイドを決めて、ガイド名を入れたら✓（前日20時まで）';
  notes[H.GUEST] = 'リールかガイド：ゲストと連絡できたら✓（どちらが付けてもよい）';
  notes[H.REPORT] = 'ガイド：ツアー後、このリンクの完了報告フォームを送る（リールからガイドに渡す）';
  notes[H.RECEIVE] = 'キラナ：完了報告を読んだら✓。これで完了';
  notes[H.CXOK] = 'リール：キャンセルが発生したことを確認したら✓（対応一覧から消える）';
  Object.keys(notes).forEach(function (h) { led.getRange(1, col(h)).setNote(notes[h]); });
  // 触ってよいのはチェック欄・ガイド名・メモだけ。ほかはロック（共有アカウント＝持ち主だけが編集できる）
  led.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (/^NGT/.test(p.getDescription())) p.remove(); });
  lockSheet_(led, [H.ACCEPT, H.ARRANGE, H.GUEST, H.RECEIVE, H.CXOK, H.GUIDE, H.MEMO].map(function (h) { return led.getRange(2, col(h), rows, 1); }));

  var tours = ss.getSheetByName(SHEETS.TOURS) || ss.insertSheet(SHEETS.TOURS);
  if (tours.getLastRow() === 0) {
    tours.appendRow(TOUR_HEADERS);
    tours.getRange(2, 1, TOUR_DEFAULTS.length, TOUR_HEADERS.length).setNumberFormat('@').setValues(TOUR_DEFAULTS);
    tours.getRange(1, 1).setNote('PLAN名に含まれる文字。| で区切ると、どれか1つ。上の行から順に照合します（NKTセットを先に置く）。');
    tours.getRange(1, 4).setNote('CSVの時刻を読み替える。「15:00=16:30, 18:00=19:30」＝15:00の予約は16:30開始として台帳に入れる');
    tours.getRange(1, 5).setNote('完了報告フォームの「盛り上がった場所」の選択肢。／で区切る。変えたらメニュー「完了報告フォームを作り直す」');
  }
  tours.setFrozenRows(1);
  led.getRange(2, col(H.TOUR), rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(tours.getRange('B2:B'), true).setAllowInvalid(true).build());

  var set = ss.getSheetByName(SHEETS.SETTINGS) || ss.insertSheet(SHEETS.SETTINGS);
  if (set.getLastRow() === 0) {
    set.appendRow(['項目', '値', '説明']);
    var seed = SETTING_DEFAULTS.map(function (r) {
      return [r[0], Object.prototype.hasOwnProperty.call(SETTING_OVERRIDES, r[0]) ? String(SETTING_OVERRIDES[r[0]]) : r[1], r[2]];
    });
    set.getRange(2, 1, seed.length, 3).setNumberFormat('@').setValues(seed);
    set.setColumnWidth(1, 240).setColumnWidth(2, 260).setColumnWidth(3, 480);
  }
  set.setFrozenRows(1);
  ensureSettingRows_(set);

  var log = ss.getSheetByName(SHEETS.LOG) || ss.insertSheet(SHEETS.LOG);
  if (log.getLastRow() === 0) log.appendRow(LOG_HEADERS);
  log.setFrozenRows(1);

  // CSV の置き場フォルダ
  var cfg = settings_();
  var folder = null;
  if (cfg.folderId) { try { folder = DriveApp.getFolderById(cfg.folderId); } catch (e) { folder = null; } }
  if (!folder) {
    folder = DriveApp.createFolder('NGT手配ボード_CSV置き場');
    setValueByKey_(set, 'CSVの置き場（フォルダID）', folder.getId());
  }
  subFolder_(folder, '取込済み');
  subFolder_(folder, 'エラー');

  // トリガー（このプロジェクトのものは作り直す）
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('poll').timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger('onBoardEdit').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('onReport').forSpreadsheet(ss).onFormSubmit().create();
  var pre = hmToMin_(cfg.precheckTime);
  ScriptApp.newTrigger('eveningCheck').timeBased().atHour(Math.floor(pre / 60)).everyDays(1).inTimezone('Asia/Tokyo').create();

  var now = now_(), L = ledger_();
  var list = refreshAll_(L, settings_(), now);
  if (sortLedger_(L, settings_(), now)) { L = ledger_(); list = refreshAll_(L, settings_(), now); }
  renderTodo_(L, settings_(), now, list);
  ss.setActiveSheet(ss.getSheetByName(SHEETS.TODO));

  [SHEETS.TODO, SHEETS.TOURS, SHEETS.SETTINGS, SHEETS.LOG, SHEETS.REPORT].forEach(function (n) { var x = ss.getSheetByName(n); if (x) lockSheet_(x, []); });

  // 完了報告フォーム（いちばん時間がかかるので最後。時間切れなら、もう一度 setup で続きから）
  var r = ensureForm_(ss, props, startedAt + 270000);
  setValueByKey_(set, '完了報告フォーム', r.form.getPublishedUrl());
  if (!r.done) {
    log_('初期設定', null, 'シート・置き場フォルダ・トリガーは用意済み。完了報告フォームの作成が途中のため、もう一度 setup を実行してください（続きから作ります）');
    Logger.log('完了報告フォームの作成が途中です。もう一度 setup を実行してください（続きから作ります）。');
    return;
  }
  log_('初期設定', null, '第2版のシート・フォーム・置き場フォルダ・トリガーを用意しました');
  Logger.log('初期設定が終わりました。CSVの置き場：' + folder.getUrl() + '　完了報告フォーム：' + r.form.getPublishedUrl());
  try {
    SpreadsheetApp.getUi().alert('初期設定が終わりました。\n\nCSVの置き場：\n' + folder.getUrl() + '\n\n完了報告フォーム：\n' + r.form.getPublishedUrl() +
      '\n\n設定シートの「キラナの通知先」「リールの通知先」を確かめてください。');
  } catch (e) { /* 画面がないとき（エディタから実行）は表示しない */ }
}
