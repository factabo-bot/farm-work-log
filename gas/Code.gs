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
var SHEET_TASKS = "タスク";
var TZ = "Asia/Tokyo";

var RECORD_HEADERS = [
  "記録日時", "日付", "記録者", "userId",
  "拠点", "棟", "列", "位置", "作業", "作業詳細", "備考", "記録ID",
];

var TASK_HEADERS = [
  "日付", "作成時刻", "宛先", "宛先userId", "順番",
  "拠点", "棟", "場所", "セル", "作業", "作業詳細",
  "宛先備考", "全体コメント", "状態",
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
  if (!ss.getSheetByName(SHEET_TASKS)) {
    var tasks = ss.insertSheet(SHEET_TASKS);
    tasks.getRange(1, 1, 1, TASK_HEADERS.length).setValues([TASK_HEADERS]);
    tasks.setFrozenRows(1);
  }
  // 既存の記録シートに「記録ID」列がなければ追加（取り消し機能用）
  var rec2 = ss.getSheetByName(SHEET_RECORDS);
  var headers = rec2.getRange(1, 1, 1, rec2.getLastColumn()).getValues()[0];
  if (headers.indexOf("記録ID") < 0) {
    rec2.getRange(1, headers.length + 1).setValue("記録ID");
  }
}

// 記録・指示の受信
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.type === "shiji") return saveShiji_(data);
    if (data.type === "deleteRecords") return deleteRecords_(data);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
    var now = new Date();
    var dateStr = Utilities.formatDate(now, TZ, "yyyy-MM-dd");
    var timeStr = Utilities.formatDate(now, TZ, "yyyy-MM-dd HH:mm:ss");

    var rows = [];
    (data.entries || []).forEach(function (en) {
      // 作業は複数選択可。1マス×1作業＝1行に展開する。
      // 列のない場所（露地・育苗ハウス・作業場）は列・位置を空欄で1行
      var works = en.works || (en.work ? [en.work] : []);
      var cellList = en.cells && en.cells.length > 0 ? en.cells : [{ row: "", pos: "" }];
      cellList.forEach(function (c) {
        works.forEach(function (w) {
          rows.push([
            timeStr, dateStr,
            data.recorder || "", data.userId || "",
            en.base || "", en.building || "",
            c.row, c.pos,
            w, w === "その他" ? (en.workDetail || "") : "",
            data.note || "",
            Utilities.getUuid(), // 記録ID（本人による取り消しに使う）
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

// 本人による記録の取り消し。記録IDとuserIdの両方が一致する行だけ削除する
function deleteRecords_(data) {
  var ids = data.ids || [];
  if (ids.length === 0) return json_({ ok: true, deleted: 0 });
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
  var values = sheet.getDataRange().getValues();
  var idCol = RECORD_HEADERS.indexOf("記録ID");
  var deleted = 0;
  // 行番号がずれないように下から消す
  for (var i = values.length - 1; i >= 1; i--) {
    if (ids.indexOf(values[i][idCol]) >= 0 && values[i][3] === (data.userId || "")) {
      sheet.deleteRow(i + 1);
      deleted++;
    }
  }
  return json_({ ok: true, deleted: deleted });
}

// 指示の保存。宛先×タスクを1行ずつタスクシートに書く
function saveShiji_(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TASKS);
  var timeStr = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss");
  var rows = [];
  (data.blocks || []).forEach(function (b) {
    (b.tasks || []).forEach(function (t, i) {
      rows.push([
        data.date || "", timeStr,
        b.name || "", b.userId || "", i + 1,
        t.base || "", t.building || "",
        t.place || "", JSON.stringify(t.cells || []),
        t.work || "", t.workDetail || "",
        b.note || "", data.comment || "", "未着手",
      ]);
    });
  });
  if (rows.length > 0) {
    sheet
      .getRange(sheet.getLastRow() + 1, 1, rows.length, TASK_HEADERS.length)
      .setValues(rows);
  }
  return json_({ ok: true, saved: rows.length });
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

  // 今日の自分の記録一覧（取り消し用）。?action=mytoday&userId=xxx
  if (action === "mytoday") {
    var uid = String(e.parameter.userId || "");
    var today2 = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    var shm = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
    var vm = shm.getDataRange().getValues();
    var idCol2 = RECORD_HEADERS.indexOf("記録ID");
    var mine = [];
    for (var q = 1; q < vm.length; q++) {
      if (dateKey_(vm[q][1]) !== today2) continue;
      if (vm[q][3] !== uid) continue;
      var tq = vm[q][0];
      mine.push({
        id: vm[q][idCol2] || "",
        time: tq instanceof Date ? Utilities.formatDate(tq, TZ, "HH:mm") : String(tq).slice(11, 16),
        base: vm[q][4],
        building: vm[q][5],
        row: vm[q][6],
        pos: vm[q][7],
        work: vm[q][8],
        workDetail: vm[q][9],
      });
    }
    return json_({ ok: true, records: mine });
  }

  // スタッフ一覧（指示画面の宛先候補）
  if (action === "staff") {
    var stf = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_STAFF);
    var sv = stf.getDataRange().getValues();
    var staff = [];
    for (var s = 1; s < sv.length; s++) {
      staff.push({ userId: sv[s][0], name: sv[s][1] });
    }
    return json_({ ok: true, staff: staff });
  }

  // 直近N日の作業状況（指示画面のヒートマップ用）。?action=status&days=14
  // 「拠点|棟|列|位置|作業」→ 最後にやった日 を返す
  if (action === "status") {
    var days = Math.max(1, Math.min(60, Number(e.parameter.days) || 14));
    var since = new Date();
    since.setDate(since.getDate() - days);
    var sinceKey = Utilities.formatDate(since, TZ, "yyyy-MM-dd");
    var sh3 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
    var vals3 = sh3.getDataRange().getValues();
    var status = {};
    for (var m = 1; m < vals3.length; m++) {
      var dk = dateKey_(vals3[m][1]);
      if (dk < sinceKey) continue;
      var key = [vals3[m][4], vals3[m][5], vals3[m][6], vals3[m][7], vals3[m][8]].join("|");
      if (!status[key] || status[key] < dk) status[key] = dk;
    }
    return json_({ ok: true, status: status });
  }

  // 指定日の記録一覧（進捗ボード用）。?action=records&date=yyyy-MM-dd
  if (action === "records") {
    var dateParam = String(e.parameter.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      dateParam = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
    }
    var sh2 = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORDS);
    var vals2 = sh2.getDataRange().getValues();
    var records = [];
    for (var k = 1; k < vals2.length; k++) {
      if (dateKey_(vals2[k][1]) !== dateParam) continue;
      var t = vals2[k][0];
      records.push({
        time: t instanceof Date ? Utilities.formatDate(t, TZ, "HH:mm") : String(t),
        recorder: vals2[k][2],
        base: vals2[k][4],
        building: vals2[k][5],
        row: vals2[k][6],
        pos: vals2[k][7],
        work: vals2[k][8],
        workDetail: vals2[k][9],
        note: vals2[k][10],
      });
    }
    return json_({ ok: true, records: records });
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
