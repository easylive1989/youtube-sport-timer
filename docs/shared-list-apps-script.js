/**
 * 運動節奏計時器 — 共享清單 Google Apps Script
 *
 * 使用步驟：
 * 1. 前往 Google 試算表 (sheets.new)，新增一份試算表
 * 2. 把網址列的試算表 ID 填入下方的 SPREADSHEET_ID
 *    （網址格式：docs.google.com/spreadsheets/d/<這段就是 ID>/edit）
 * 3. 工具 > Apps Script
 * 4. 貼上此檔案全部內容，儲存（Ctrl+S）
 * 5. 部署 > 新增部署 > 類型：網頁應用程式
 *    - 執行身分：我（你的 Google 帳號）
 *    - 誰可以存取：任何人
 * 6. 授權並完成部署，複製 /exec 結尾的 URL
 * 7. 把該 URL 填入 frontend/config.js 的 sharedApiUrl 欄位
 *
 * 注意：必須用 openById() 指定試算表，不能用 getActiveSpreadsheet()。
 * Web App 的 doGet/doPost 不是從試算表選單觸發，getActiveSpreadsheet()
 * 會回傳 null，導致 503 / "Cannot read properties of null"。
 */

var SHEET_NAME = "shared";
var COLUMNS = ["id", "title", "author", "video", "ts", "created_at"];
var SPREADSHEET_ID = "1t6dR3_ny8Wa5oiJHId-8kv6DQ38trOLgpj06daSHqfc";

function getSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLUMNS); // 標題列
  }
  return sh;
}

/** GET — 回傳所有項目（最新的在前） */
function doGet(e) {
  var sh = getSheet();
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  rows.reverse(); // 新的在前
  return ContentService
    .createTextOutput(JSON.stringify(rows))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * POST — 新增一筆項目
 * 前端以 Content-Type: text/plain;charset=utf-8 發送 JSON 字串，
 * 避免觸發瀏覽器的 preflight OPTIONS（Apps Script 無法回應 OPTIONS）。
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var sh = getSheet();
    var row = COLUMNS.map(function(col) {
      if (col === "created_at") return new Date().toISOString();
      return body[col] !== undefined ? String(body[col]) : "";
    });
    sh.appendRow(row);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
