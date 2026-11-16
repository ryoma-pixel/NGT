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
 *  13:00 リールが「今やること」を見て、新規に ①受注 ✓ → ガイドを手配して ②手配完了 ✓
 *        → ガイドがゲストと連絡できたら ③ゲスト連絡 ✓
 *  前日20:00 までに翌日分の手配を終える。過ぎたら、キラナとリールに通知（原則キラナでキャンセル対応）
 *  ツアー後 ガイドが ④完了報告フォーム（チェック項目・アンケート）を送る → キラナが ⑤受領 ✓ で完了
 *  メール・インフルエンサーの予約は、台帳の空いている行にキラナが手で書く（経路を選ぶ）
 *
 * お客様の情報はこのスプレッドシートの中だけに置く（コードやリポジトリには入れない）。
 */

// ===== 定数 =====

var SHEETS = { TODO: '今やること', LEDGER: '台帳', TOURS: 'ツアー', SETTINGS: '設定', LOG: 'ログ', REPORT: '完了報告' };

// 台帳の列（見出しの文字がそのままキーになる）
var H = {
  ID: '案件ID', WHO: '次にやる人', TODO: '次にやること', DUE: '期限', ST: '状態',
  DATE: '催行日', TIME: '開始', TOUR: 'ツアー', ADULT: '大人', CHILD: '子ども', NAME: '代表者名', CONTACT: '連絡先',
  ROUTE: '経路', MEMO: 'メモ', GUIDE: 'ガイド名',
  ACCEPT: '①受注（リール）', ARRANGE: '②手配完了（リール）', GUEST: '③ゲスト連絡（リール）',
  REPORT: '④完了報告（ガイド）', RECEIVE: '⑤受領（キラナ）',
  CXOK: 'キャンセル確認（リール）', CXKIRA: 'キャンセル対応（キラナ）',
  NOTE: '変更・注意',
  BOOKING: '予約番号', AGENT: '代理店予約番号', PLAN: 'PLAN名', SRC: '取込元',
  T_CREATED: '登録日時', T_ACCEPT: '受注日時', T_ARRANGE: '手配日時', T_GUEST: '連絡日時', T_REPORT: '報告日時',
  T_RECEIVE: '受領日時', T_CX: 'キャンセル日時', CX_REASON: 'キャンセルの理由', T_CXOK: 'キャンセル確認日時',
  ALERTED: '通知済み', REPORT_SUM: '報告の要約'
};

var LEDGER_HEADERS = [
  H.ID, H.WHO, H.TODO, H.DUE, H.ST,
  H.DATE, H.TIME, H.TOUR, H.ADULT, H.CHILD, H.NAME, H.CONTACT, H.ROUTE, H.MEMO, H.GUIDE,
  H.ACCEPT, H.ARRANGE, H.GUEST, H.REPORT, H.RECEIVE, H.CXOK, H.CXKIRA, H.NOTE,
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
  { col: H.CXOK, stamp: H.T_CXOK, implies: [] },
  { col: H.CXKIRA, stamp: null, implies: [] }
];
// スクリプトが書く列（人は触らない）
var AUTO_COLS = [H.ID, H.WHO, H.TODO, H.DUE, H.ST, H.NOTE, H.SRC, H.T_CREATED, H.T_ACCEPT, H.T_ARRANGE, H.T_GUEST,
  H.T_REPORT, H.T_RECEIVE, H.T_CX, H.CX_REASON, H.T_CXOK, H.ALERTED, H.REPORT_SUM];
// 数式（リンク）を入れる列。行をまとめて書き戻すときは飛ばす
var FORMULA_COLS = [H.REPORT];

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
  ['キラナの通知先', '', 'キラナの担当者のアドレス。複数はカンマ区切り'],
  ['リールの通知先', '', 'リールの担当者・共有アドレス。複数はカンマ区切り'],
  ['リールの確認時刻', '13:00', 'リールが毎日台帳を見る時刻'],
  ['受注の猶予（分）', '60', '確認時刻からこの時間までに ①受注 がなければ通知'],
  ['手配の期限（前日の時刻）', '20:00', 'この時刻までに翌日分の ②手配完了 がなければ通知（原則キラナでキャンセル対応）'],
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
    kiraTo: splitList_(raw['キラナの通知先']),
    reeluTo: splitList_(raw['リールの通知先']),
    checkTime: toHm_(raw['リールの確認時刻']) || '13:00',
    acceptGraceMin: num_(raw['受注の猶予（分）'], 60),
    arrangeDeadline: toHm_(raw['手配の期限（前日の時刻）']) || '20:00',
    precheckTime: toHm_(raw['手配の事前確認（時刻）']) || '19:00',
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

  if (c[H.T_CX] || truthy_(c[H.CXKIRA])) {
    if ((accepted || arranged) && !truthy_(c[H.CXOK])) {
      var cx = toDate_(c[H.T_CX]) || now;
      return { st: 'キャンセル（リール確認待ち）', who: WHO.REELU, step: 'cxok',
        todo: 'キャンセルになりました。手配していたらガイドに連絡し「キャンセル確認」に✓',
        due: new Date(cx.getTime() + cfg.cxHours * H_MS) };
    }
    return { st: 'キャンセル済み', who: '', todo: '', due: null, step: 'cxdone' };
  }
  if (!ymd || !start || !String(c[H.TOUR] || '').trim()) {
    return { st: '入力待ち', who: WHO.KIRA, step: 'input', todo: '催行日・開始・ツアー・大人の人数を入れる', due: new Date(created.getTime() + H_MS) };
  }
  if (truthy_(c[H.RECEIVE])) return { st: '完了', who: '', todo: '', due: null, step: 'done' };
  var reported = toDate_(c[H.T_REPORT]);
  if (reported) {
    return { st: '完了報告済み（受領待ち）', who: WHO.KIRA, step: 'receive', todo: '完了報告を読んで ⑤受領 に✓',
      due: new Date(reported.getTime() + cfg.receiveDays * DAY_MS) };
  }
  if (guested) {
    var before = now.getTime() < start.getTime();
    return { st: 'ゲスト連絡済み', who: WHO.GUIDE, step: 'report',
      todo: before ? '当日ツアーを実施。終わったら ④完了報告フォームを送る' : 'ツアー後の ④完了報告フォームを送る',
      due: dayAt_(ymd, 1, cfg.reportTime) };
  }
  if (arranged) {
    var noGuide = !String(c[H.GUIDE] || '').trim();
    return { st: '手配済み（ゲスト連絡待ち）', who: WHO.REELU, step: 'guest',
      todo: (noGuide ? 'ガイド名を入れる。' : '') + 'ガイドがゲストと連絡できたら ③ゲスト連絡 に✓',
      due: new Date(start.getTime() - cfg.guestHours * H_MS) };
  }
  var arrangeDue = dayAt_(ymd, -1, cfg.arrangeDeadline);
  if (now.getTime() >= arrangeDue.getTime()) {
    return { st: '未手配（期限切れ）', who: WHO.KIRA, step: 'unarranged', due: arrangeDue,
      todo: '前日' + cfg.arrangeDeadline + 'までに手配できていません。原則キャンセル対応（対応したら「キャンセル対応（キラナ）」に✓）。手配できたらリールが ②手配完了 に✓' };
  }
  if (accepted) {
    return { st: '受注済み（手配中）', who: WHO.REELU, step: 'arrange', due: arrangeDue,
      todo: 'ガイドを手配し、ガイド名を入れて ②手配完了 に✓' };
  }
  return { st: '新規（受注待ち）', who: WHO.REELU, step: 'accept', due: acceptDue_(created, arrangeDue, cfg),
    todo: '内容を見て ①受注 に✓' };
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
  var valid = 0;

  csvObjects_(rows).forEach(function (o) {
    var b = rowToBooking_(o, src, tours, cfg);
    if (b.skip) { res.skipped++; return; }
    if (b.ymd && b.ymd < today) { res.skipped++; return; } // 過去の催行日（古いCSVを入れたとき）は取り込まない
    valid++;
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
      c[H.T_CX] = ''; c[H.CX_REASON] = ''; c[H.CXKIRA] = false;
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
  var gone = L.rows.filter(function (c) {
    return c[H.SRC] === srcTag && c[H.BOOKING] && !seen[c[H.BOOKING]] && !c[H.T_CX] &&
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
  rows.forEach(function (c) { var m = String(c[H.ID] || '').match(/(\d+)$/); if (m) max = Math.max(max, +m[1]); });
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

function tours_() {
  var sh = ss_().getSheetByName(SHEETS.TOURS);
  return toursFromRows_(sh ? sh.getDataRange().getValues().slice(1) : TOUR_DEFAULTS);
}

// 台帳を読む。案件IDがなくても、人が書きかけた行（手入力の予約）は拾う
function ledger_() {
  var sh = ss_().getSheetByName(SHEETS.LEDGER);
  if (!sh) throw new Error('「台帳」のシートがありません。先に関数「setup」を実行してください。');
  var values = sh.getDataRange().getValues();
  var head = values[0].map(String);
  if (head.indexOf(H.WHO) < 0) throw new Error('台帳が第2版の形になっていません。先に関数「setup」を実行してください。');
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 };
    for (var i = 0; i < head.length; i++) o[head[i]] = values[r][i];
    if (o[H.ID] || o[H.DATE] || o[H.TOUR] || o[H.NAME] || o[H.BOOKING]) rows.push(o);
  }
  return { sh: sh, head: head, rows: rows, last: values.length };
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
  c._row = Math.max(L.last, L.rows.reduce(function (m, x) { return Math.max(m, x._row); }, 1)) + 1;
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
  if (colName === H.CXKIRA) {
    if (on && !c[H.T_CX]) cancelCase_(c, now, 'キラナでキャンセル対応');
    if (!on && c[H.CX_REASON] === 'キラナでキャンセル対応') { c[H.T_CX] = ''; c[H.CX_REASON] = ''; addNote_(c, fmtDT_(now) + ' キラナのキャンセル対応を取り消し'); }
  } else if (on) {
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

// ===== 画面（台帳の色・今やること）=====

var COLORS = { REELU: '#fde7d4', KIRA: '#dbe8fb', GUIDE: '#e2f2e0', LATE: '#f8c9c4', DONE: '#eeeeee', HEAD: '#1f2d52' };

function whoColor_(d, now) {
  if (!d.who) return COLORS.DONE;
  if (isOverdue_(d, now)) return COLORS.LATE;
  return d.who === WHO.REELU ? COLORS.REELU : d.who === WHO.KIRA ? COLORS.KIRA : COLORS.GUIDE;
}

// 全行の「次にやる人・次にやること・期限・状態」を書き直す
function refreshAll_(L, cfg, now) {
  var last = Math.max(L.last, 1);
  if (last < 2) return [];
  var byRow = {};
  L.rows.forEach(function (c) { byRow[c._row] = c; });
  var vals = [], bgs = [], list = [];
  for (var r = 2; r <= last; r++) {
    var c = byRow[r];
    if (!c || !c[H.ID]) { vals.push(['', '', '', '']); bgs.push(['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff']); continue; }
    var d = derive_(c, cfg, now);
    c._d = d;
    list.push(c);
    var late = isOverdue_(d, now);
    vals.push([d.who ? (late ? '⚠ ' : '') + d.who : '—', d.todo, d.due || '', d.st]);
    var col = whoColor_(d, now);
    bgs.push([col, col, col, col, col]);
  }
  L.sh.getRange(2, colOf_(L, H.WHO), vals.length, 4).setValues(vals);
  L.sh.getRange(2, 1, bgs.length, 5).setBackgrounds(bgs);
  return list;
}

function todoUrl_() {
  var ss = ss_(), sh = ss.getSheetByName(SHEETS.TODO);
  return ss.getUrl() + (sh ? '#gid=' + sh.getSheetId() : '');
}

function renderTodo_(L, cfg, now, list) {
  var sh = ss_().getSheetByName(SHEETS.TODO);
  if (!sh) return;
  list = list || L.rows.filter(function (c) { return c[H.ID]; }).map(function (c) { c._d = derive_(c, cfg, now); return c; });
  var gid = L.sh.getSheetId();
  var W = 9;
  var out = [], fmt = [];
  var push = function (row, kind) { while (row.length < W) row.push(''); out.push(row); fmt.push(kind || ''); };
  var byDue = function (a, b) { return (a._d.due ? a._d.due.getTime() : 9e15) - (b._d.due ? b._d.due.getTime() : 9e15); };
  var line = function (c) {
    var d = c._d, late = isOverdue_(d, now);
    return [(late ? '⚠ 期限切れ ' : '') + fmtDT_(d.due), d.todo, c[H.ID], fmtMD_(toYmd_(c[H.DATE])) + ' ' + toHm_(c[H.TIME]),
      String(c[H.TOUR] || ''), (num_(c[H.ADULT], 0) || '') + (num_(c[H.CHILD], 0) ? '＋子' + num_(c[H.CHILD], 0) : ''),
      String(c[H.ROUTE] || ''), String(c[H.GUIDE] || ''),
      '=HYPERLINK("#gid=' + gid + '&range=A' + c._row + '","台帳で開く")'];
  };
  push(['NGT 手配ボード　今やること', '', '', '', '', '', '', '', '更新 ' + fmtDT_(now)], 'title');
  push([PropertiesService.getScriptProperties().getProperty('LAST_IMPORT') || '最終取込：まだありません'], 'sub');
  push([''], '');
  var sec = function (title, who, color) {
    var items = list.filter(function (c) { return who.indexOf(c._d.who) >= 0; }).sort(byDue);
    push([title + '（' + items.length + '件）'], 'sec:' + color);
    if (!items.length) { push(['いまはありません'], 'none'); push([''], ''); return; }
    push(['期限', 'やること', '案件ID', '催行日・開始', 'ツアー', '人数', '経路', 'ガイド', ''], 'head');
    items.forEach(function (c) { push(line(c), isOverdue_(c._d, now) ? 'late' : 'row:' + color); });
    push([''], '');
  };
  sec('■ リールがやること（ガイドの完了報告を含む）', [WHO.REELU, WHO.GUIDE], COLORS.REELU);
  sec('■ キラナがやること', [WHO.KIRA], COLORS.KIRA);
  // これから3日のツアー（全体の見通し）
  var t0 = ymd_(now), t3 = ymd_(new Date(now.getTime() + 3 * DAY_MS));
  var soon = list.filter(function (c) { var y = toYmd_(c[H.DATE]); return y >= t0 && y <= t3 && c._d.step !== 'cxdone'; })
    .sort(function (a, b) { return (startOf_(a) || 0) - (startOf_(b) || 0); });
  push(['■ これから3日のツアー（' + soon.length + '件）'], 'sec:#e8e8e8');
  if (soon.length) {
    push(['催行日・開始', '状態', '案件ID', 'ツアー', '人数', '経路', 'ガイド', '次にやる人', ''], 'head');
    soon.forEach(function (c) {
      push([fmtMD_(toYmd_(c[H.DATE])) + ' ' + toHm_(c[H.TIME]), c._d.st, c[H.ID], String(c[H.TOUR] || ''),
        (num_(c[H.ADULT], 0) || '') + (num_(c[H.CHILD], 0) ? '＋子' + num_(c[H.CHILD], 0) : ''), String(c[H.ROUTE] || ''),
        String(c[H.GUIDE] || ''), c._d.who || '—', '=HYPERLINK("#gid=' + gid + '&range=A' + c._row + '","台帳で開く")'], 'row:#ffffff');
    });
  } else push(['ありません'], 'none');

  sh.clear();
  sh.getRange(1, 1, out.length, W).setValues(out);
  for (var i = 0; i < fmt.length; i++) {
    var k = fmt[i], rg = sh.getRange(i + 1, 1, 1, W);
    if (k === 'title') rg.setFontSize(16).setFontWeight('bold').setFontColor(COLORS.HEAD);
    else if (k === 'sub') rg.setFontColor('#555555');
    else if (k.indexOf('sec:') === 0) rg.setBackground(k.slice(4)).setFontWeight('bold').setFontSize(12);
    else if (k === 'head') rg.setFontWeight('bold').setBackground('#f3f3f3');
    else if (k === 'late') rg.setBackground(COLORS.LATE).setFontWeight('bold');
    else if (k.indexOf('row:') === 0) rg.setBackground('#ffffff');
    else if (k === 'none') rg.setFontColor('#777777');
  }
  sh.setFrozenRows(1);
}

// ===== 通知 =====

function sheetLink_() { return todoUrl_(); }

function mail_(to, subject, lines) {
  to = (to || []).filter(function (x) { return x; });
  if (!to.length) { log_('通知先なし', null, subject); return; }
  MailApp.sendEmail({ to: to.join(','), subject: '【NGT 手配】' + subject, body: lines.concat(['', '今やること：' + sheetLink_()]).join('\n'), name: 'NGT 手配ボード' });
}
function both_(cfg) { return cfg.kiraTo.concat(cfg.reeluTo); }

function caseLine_(c) {
  return '［' + c[H.ID] + '］' + fmtMD_(toYmd_(c[H.DATE])) + ' ' + toHm_(c[H.TIME]) + '　' + (c[H.TOUR] || '（ツアー未設定）') +
    '　大人' + num_(c[H.ADULT], 0) + (num_(c[H.CHILD], 0) ? '・子ども' + num_(c[H.CHILD], 0) : '') + '　' + (c[H.ROUTE] || '');
}

// 期限を過ぎた案件を、段階ごとに1回だけ知らせる（夜間は朝に回す）
function alertOverdue_(L, cfg, now, list) {
  if (inQuiet_(now, cfg.quietStart, cfg.quietEnd)) return 0;
  var hits = (list || []).filter(function (c) {
    var d = c._d;
    return d && d.who && isOverdue_(d, now) && String(c[H.ALERTED]) !== d.step;
  });
  if (!hits.length) return 0;
  var unarranged = hits.filter(function (c) { return c._d.step === 'unarranged'; });
  var lines = ['期限を過ぎた案件があります。台帳の「今やること」で確認してください。', ''];
  if (unarranged.length) {
    lines.push('▼ 前日' + cfg.arrangeDeadline + 'までに手配できていない（原則キラナでキャンセル対応）');
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
  lines.push('', 'リールは' + cfg.checkTime + 'に「今やること」を確認してください。');
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
    (r.held.length ? '・要確認' + r.held.length : '') + '（対象外 ' + r.skipped + '行）';
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
    var results = (files || []).map(function (f) {
      var blob = Utilities.newBlob(Utilities.base64Decode(f.b64), 'text/csv', f.name);
      var r = importCsv_(f.name, decodeBlob_(blob), L, cfg, tours, now);
      if (folder) subFolder_(folder, r.error ? 'エラー' : '取込済み').createFile(blob);
      log_(r.error ? '取込エラー' : '取込', null, describe_(r));
      return r;
    });
    rememberImport_(results, now);
    var list = refreshAll_(L, cfg, now);
    ensureReportLinks_(L, list);
    renderTodo_(L, cfg, now, list);
    importSummaryMail_(cfg, results);
    return results.map(describe_).join('\n');
  } finally { lock.releaseLock(); }
}

var UPLOAD_HTML = '<!doctype html><html><head><base target="_top"><style>body{font-family:sans-serif;font-size:14px;padding:4px}' +
  'button{background:#1f2d52;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:14px;margin-top:10px}' +
  'pre{white-space:pre-wrap;background:#f5f5f5;padding:8px;border-radius:6px}</style></head><body>' +
  '<p>LINKTIVITY から書き出した CSV（<b>kiranah-resort-…</b> と <b>tryhard-…</b>）を選んでください。2つ同時に選べます。</p>' +
  '<input type="file" id="f" accept=".csv" multiple><br><button id="b" onclick="go()">取り込む</button><pre id="o"></pre>' +
  '<script>function b64(buf){var s="",a=new Uint8Array(buf);for(var i=0;i<a.length;i+=8192)s+=String.fromCharCode.apply(null,a.subarray(i,i+8192));return btoa(s)}' +
  'function go(){var fs=[].slice.call(document.getElementById("f").files);var o=document.getElementById("o");if(!fs.length){o.textContent="ファイルを選んでください";return}' +
  'document.getElementById("b").disabled=true;o.textContent="取り込み中…";Promise.all(fs.map(function(f){return f.arrayBuffer().then(function(b){return{name:f.name,b64:b64(b)}})}))' +
  '.then(function(x){google.script.run.withSuccessHandler(function(r){o.textContent=r+"\\n\\n完了しました。この画面を閉じてください。"}).withFailureHandler(function(e){o.textContent="エラー："+e.message;document.getElementById("b").disabled=false}).importUploaded(x)})}</script></body></html>';

function showUpload() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(UPLOAD_HTML).setWidth(460).setHeight(320), 'CSVを取り込む');
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
  c[H.REPORT_SUM] = sum.join('／');
  c[H.ALERTED] = '';
  var urgent = [];
  if (meet === A.MEET[2]) urgent.push('ゲストと合流できなかった');
  if (trouble === A.TROUBLE[1]) urgent.push('ケガ・トラブル・苦情があった');
  if (num_(reaction, 5) <= 2) urgent.push('ゲストの反応が ' + reaction + '/5');
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
    if (r.urgent.length) {
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
    var cfg = settings_(), tours = tours_(), now = now_(), L = ledger_();
    initManual_(L, now);
    var results = importFromFolder_(cfg, L, tours, now);
    rememberImport_(results, now);
    var list = refreshAll_(L, cfg, now);
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
  var list = L.rows.filter(function (c) {
    if (!c[H.ID] || toYmd_(c[H.DATE]) !== tomorrow) return false;
    var d = derive_(c, cfg, now);
    return d.step === 'accept' || d.step === 'arrange';
  });
  if (!list.length) return;
  mail_(both_(cfg), '明日のツアーで未手配が ' + list.length + '件（期限 今日' + cfg.arrangeDeadline + '）',
    ['明日（' + fmtMD_(tomorrow) + '）のツアーで、まだ ②手配完了 になっていない案件です。', ''].concat(list.map(caseLine_))
      .concat(['', '今日' + cfg.arrangeDeadline + 'を過ぎても未手配のときは、原則キラナでキャンセル対応になります。']));
}

// ===== メニュー・初期設定 =====

function onOpen() {
  SpreadsheetApp.getUi().createMenu('NGT 手配ボード')
    .addItem('CSVを取り込む（ファイルを選ぶ）', 'showUpload')
    .addItem('今すぐ更新（置き場のCSVも取り込む）', 'poll')
    .addItem('完了報告フォームのリンクを表示', 'showFormLink')
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

  var todo = ss.getSheetByName(SHEETS.TODO) || ss.insertSheet(SHEETS.TODO, 0);
  todo.setColumnWidths(1, 1, 150).setColumnWidth(2, 380).setColumnWidths(3, 7, 110);

  var led = ss.getSheetByName(SHEETS.LEDGER) || ss.insertSheet(SHEETS.LEDGER, 1);
  if (led.getLastRow() === 0) led.appendRow(LEDGER_HEADERS);
  var n = LEDGER_HEADERS.length, rows = led.getMaxRows() - 1;
  var col = function (name) { return LEDGER_HEADERS.indexOf(name) + 1; };
  led.setFrozenRows(1);
  led.setFrozenColumns(1);
  led.getRange(1, 1, 1, n).setFontWeight('bold').setFontColor('#ffffff').setBackground('#6b7280').setWrap(true).setVerticalAlignment('middle');
  [H.ACCEPT, H.ARRANGE, H.GUEST, H.CXOK, H.GUIDE].forEach(function (h) { led.getRange(1, col(h)).setBackground('#c2560c'); });
  [H.RECEIVE, H.CXKIRA].forEach(function (h) { led.getRange(1, col(h)).setBackground('#1d4ed8'); });
  led.getRange(1, col(H.REPORT)).setBackground('#15803d');
  [H.DATE, H.TIME, H.TOUR, H.ADULT, H.CHILD, H.NAME, H.CONTACT, H.ROUTE, H.MEMO].forEach(function (h) { led.getRange(1, col(h)).setBackground('#1f2d52'); });
  led.setRowHeight(1, 42);
  led.getRange(2, col(H.DATE), rows, 1).setNumberFormat('yyyy-mm-dd');
  [H.TIME, H.BOOKING, H.AGENT, H.ID].forEach(function (h) { led.getRange(2, col(h), rows, 1).setNumberFormat('@'); });
  [H.DUE, H.T_CREATED, H.T_ACCEPT, H.T_ARRANGE, H.T_GUEST, H.T_REPORT, H.T_RECEIVE, H.T_CX, H.T_CXOK].forEach(function (h) {
    led.getRange(2, col(h), rows, 1).setNumberFormat('m/d(ddd) hh:mm');
  });
  var cb = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  [H.ACCEPT, H.ARRANGE, H.GUEST, H.RECEIVE, H.CXOK, H.CXKIRA].forEach(function (h) { led.getRange(2, col(h), rows, 1).setDataValidation(cb); });
  led.getRange(2, col(H.ROUTE), rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ROUTE_CHOICES, true).setAllowInvalid(true).build());
  var widths = {}; widths[H.ID] = 90; widths[H.WHO] = 80; widths[H.TODO] = 300; widths[H.DUE] = 110; widths[H.ST] = 150;
  widths[H.DATE] = 95; widths[H.TIME] = 55; widths[H.TOUR] = 160; widths[H.ADULT] = 45; widths[H.CHILD] = 50; widths[H.NAME] = 140;
  widths[H.CONTACT] = 170; widths[H.ROUTE] = 120; widths[H.MEMO] = 180; widths[H.GUIDE] = 100; widths[H.NOTE] = 260; widths[H.REPORT_SUM] = 320;
  [H.ACCEPT, H.ARRANGE, H.GUEST, H.REPORT, H.RECEIVE, H.CXOK, H.CXKIRA].forEach(function (h) { widths[h] = 90; });
  Object.keys(widths).forEach(function (h) { led.setColumnWidth(col(h), widths[h]); });
  led.getRange(2, col(H.TODO), rows, 1).setWrap(true);
  led.getRange(2, col(H.NOTE), rows, 1).setWrap(true);
  var notes = {};
  notes[H.WHO] = 'スクリプトが書く。オレンジ＝リール、青＝キラナ、緑＝ガイド、赤＝期限切れ';
  notes[H.ROUTE] = 'メール・インフルエンサーの予約は、空いている行に催行日・開始・ツアー・大人・代表者名などを書き、ここで経路を選ぶ（案件IDは自動で付く）';
  notes[H.ACCEPT] = 'リール：内容を見て受けたら✓';
  notes[H.ARRANGE] = 'リール：ガイドを決めて、ガイド名を入れたら✓（前日20時まで）';
  notes[H.GUEST] = 'リール：ガイドがゲストと連絡できたら✓';
  notes[H.REPORT] = 'ガイド：ツアー後、このリンクの完了報告フォームを送る（リールからガイドに渡す）';
  notes[H.RECEIVE] = 'キラナ：完了報告を読んだら✓。これで完了';
  notes[H.CXOK] = 'リール：キャンセルを確認し、手配していたガイドに連絡したら✓';
  notes[H.CXKIRA] = 'キラナ：未手配などでキャンセル対応をしたら✓（お客様・予約システム側の手続きはキラナで）';
  Object.keys(notes).forEach(function (h) { led.getRange(1, col(h)).setNote(notes[h]); });
  // スクリプトが書く列は、うっかり書き換えないよう警告を出す
  led.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { if (p.getDescription() === 'NGT自動') p.remove(); });
  // 隣り合う列はまとめて1つの範囲にする（範囲の数が多いと初期設定が遅くなる）
  var autoIdx = AUTO_COLS.map(col).sort(function (a, b) { return a - b; });
  for (var ai = 0; ai < autoIdx.length;) {
    var aj = ai;
    while (aj + 1 < autoIdx.length && autoIdx[aj + 1] === autoIdx[aj] + 1) aj++;
    led.getRange(2, autoIdx[ai], rows, autoIdx[aj] - autoIdx[ai] + 1).protect().setDescription('NGT自動').setWarningOnly(true);
    ai = aj + 1;
  }

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
  renderTodo_(L, settings_(), now, list);
  ss.setActiveSheet(ss.getSheetByName(SHEETS.TODO));

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
