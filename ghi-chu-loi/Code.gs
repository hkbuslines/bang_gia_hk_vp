/**
 * Apps Script backend cho form "Ghi chú lỗi".
 * Cách cài đặt:
 * 1. Tạo (hoặc mở) một Google Sheet.
 * 2. Vào Extensions > Apps Script, xóa hết code mặc định, dán toàn bộ file này vào.
 * 3. Deploy > New deployment > chọn loại "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy URL web app (dạng https://script.google.com/macros/s/XXXX/exec)
 *    và dán vào biến WEB_APP_URL trong file index.html.
 * 5. Mỗi lần sửa code.gs và deploy lại, chọn "Manage deployments" > sửa
 *    deployment cũ > Version: New, để giữ nguyên URL.
 */

var SHEET_NAME = "Data";

function doGet(e) {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  values.shift(); // bỏ dòng tiêu đề

  var tz = Session.getScriptTimeZone();
  var rows = values.map(function (r) {
    return {
      thoiGianGhi: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, "dd/MM/yyyy HH:mm") : r[0],
      ngay: r[1] instanceof Date ? Utilities.formatDate(r[1], tz, "dd/MM/yyyy") : r[1],
      boPhan: r[2],
      ten: r[3],
      loi: r[4],
      hoanTra: r[5]
    };
  }).reverse();

  return jsonOutput_({ result: "success", data: rows.slice(0, 100) });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!body.ngay || !body.boPhan || !body.loi) {
      return jsonOutput_({ result: "error", message: "Thiếu Ngày, Bộ phận hoặc Lỗi." });
    }

    var sheet = getSheet_();
    sheet.appendRow([
      new Date(),
      body.ngay,
      body.boPhan,
      body.ten || "",
      body.loi,
      body.hoanTra || ""
    ]);

    return jsonOutput_({ result: "success" });
  } catch (err) {
    return jsonOutput_({ result: "error", message: err.message });
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Thời gian ghi", "Ngày", "Bộ phận", "Tên", "Lỗi", "Hoàn trả"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
