/**
 * 作業記録システム バックエンド（Google Apps Script）
 *
 * 使い方:
 * 1. 新しいスプレッドシートを作り、拡張機能 > Apps Script を開く
 * 2. このコードを貼り付けて保存
 * 3. エディタ上で setup 関数を1回実行（シートが自動作成される）
 * 4. デプロイ > 新しいデプロイ > ウェブアプリ
 *    - 次のユーザーとして実行: 自分
 *    - アクセスできるユーザー: 全員
 * 5. 発行されたURL（…/exec）を frontend/config.js の GAS_URL に設定
 */

var SHEET_RECORDS = "記録";
var SHEET_STAFF = "スタッフ";
var TZ = "Asia/Tokyo";

var RECORD_HEADERS = [
  "記録日時", "日付", "記録者", "userId",
  "拠点", "棟", "列", "位置", "作業", "作業詳細", "備考",
];

// 初期セットアップ。最初に1回だけエディタから実行する
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_RECORDS)) {
    var rec = ss.insertSheet(SHEET_RECORDS);
    rec.getRange(1, 1, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]);
    rec.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SHEET_STAFF)) {
    var staff = ss.insertSheet(SHEET_STAFF);
    staff.getRange(1, 1, 1, 3).setValues([["userId", "表示名", "初回登録日時"]]);
    staff.setFrozenRows(1);
  }
}

// 記録の受信。1マス1行に展開して保存する
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
    var now = new Date();
    var dateStr = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
    var timeStr = Utilities.formatDate(now, TZ, "yyyy-MM-dd HH:mm:ss");

    var rows = [];
    (data.entries || []).forEach(function (en) {
      // 作業は複数選択可。1マス×1作業＝1行に展開する
      var works = en.works || (en.work ? [en.work] : []);
      (en.cells || []).forEach(function (c) {
        works.forEach(function (w) {
          rows.push([
            timeStr, dateStr,
            data.recorder || "", data.userId || "",
            en.base || "", en.building || "",
            c.row, c.pos,
            w, w === "その他" ? (en.workDetail || "") : "",
            data.note || "",
          ]);
        });
      });
    });

    if (rows.length > 0) {
      sheet
        .getRange(sheet.getLastRow() + 1, 1, rows.length, RECORD_HEADERS.length)
        .setValues(rows);
    }
    registerStaff_(data.userId, data.recorder);

    return json_({ ok: true, saved: rows.length });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// セルの値を "yyyy-MM-dd" 形式の文字列にそろえる
// （シートが文字列をDate型に自動変換しても、"2026/06/12"表記でも照合できるように）
function dateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "yyyy-MM-dd");
  return String(v).trim().replace(/\//g, "-");
}

// データの取得。?action=today で今日記録済みのマス一覧を返す
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || "";

  if (action === "today") {
    var today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
    var values = sheet.getDataRange().getValues();
    var done = [];
    for (var i = 1; i < values.length; i++) {
      if (dateKey_(values[i][1]) === today) {
        // 拠点|棟|列|位置|作業 （フロント側のキー形式と一致させる）
        done.push(
          [values[i][4], values[i][5], values[i][6], values[i][7], values[i][8]].join("|")
        );
      }
    }
    return json_({ ok: true, done: done });
  }

  // 動作診断用。問題が解決したら消してよい
  if (action === "debug") {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_RECORDS);
    var vals = sh.getDataRange().getValues();
    var rows = [];
    for (var j = Math.max(1, vals.length - 5); j < vals.length; j++) {
      rows.push({
        rawType: Object.prototype.toString.call(vals[j][1]),
        isDate: vals[j][1] instanceof Date,
        raw: String(vals[j][1]),
        dateKey: dateKey_(vals[j][1]),
      });
    }
    return json_({
      ok: true,
      today: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd"),
      sheetTimeZone: ss.getSpreadsheetTimeZone(),
      scriptTimeZone: Session.getScriptTimeZone(),
      lastRows: rows,
    });
  }

  return json_({ ok: true, message: "farm-work-log API" });
}

// 初めて記録した人をスタッフシートに自動登録する
function registerStaff_(userId, name) {
  if (!userId) return;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === userId) return;
  }
  sheet.appendRow([
    userId,
    name || "",
    Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss"),
  ]);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
