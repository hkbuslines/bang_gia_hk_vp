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

function isDate_(v) {
  // Không dùng instanceof Date: giá trị Date đọc từ Sheet đôi khi thuộc
  // context JS khác, khiến instanceof trả về false một cách âm thầm.
  return Object.prototype.toString.call(v) === "[object Date]";
}

function doGet(e) {
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  values.shift(); // bỏ dòng tiêu đề

  var tz = Session.getScriptTimeZone() || "Asia/Ho_Chi_Minh";
  var rows = values.map(function (r) {
    return {
      thoiGianGhi: isDate_(r[0]) ? Utilities.formatDate(r[0], tz, "dd/MM/yyyy HH:mm") : r[0],
      ngay: isDate_(r[1]) ? Utilities.formatDate(r[1], tz, "dd/MM/yyyy") : r[1],
      boPhan: r[2],
      ten: r[3],
      loi: r[4],
      hoanTra: r[5],
      maVe: r[6],
      tuyen: r[7]
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

    // body.ngay đến từ <input type="date"> nên luôn có dạng "yyyy-MM-dd"
    // (không mơ hồ). Dựng Date từ 3 số riêng lẻ để tránh Sheets tự đoán
    // nhầm "03/08/2026" là 8 tháng 3 kiểu Mỹ thay vì 3 tháng 8.
    var parts = String(body.ngay).split("-");
    var ngayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);

    var sheet = getSheet_();
    sheet.appendRow([
      new Date(),
      ngayDate,
      body.boPhan,
      body.ten || "",
      body.loi,
      body.hoanTra || "",
      body.maVe || "",
      body.tuyen || ""
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
    sheet.appendRow(["Thời gian ghi", "Ngày", "Bộ phận", "Tên", "Lỗi", "Hoàn trả", "Mã vé", "Tuyến"]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Chạy MỘT LẦN thủ công (chọn hàm này trong dropdown ở Apps Script editor
 * rồi bấm Run) sau khi nâng cấp lên bản có cột Mã vé/Tuyến, để:
 * 1. Thêm tiêu đề "Mã vé"/"Tuyến" nếu sheet cũ chưa có (an toàn nếu đã có).
 * 2. Bù cột Mã vé/Tuyến cho các dòng cũ bằng cách tách từ text cột Lỗi
 *    (định dạng "[Mã vé] Tuyến (Nhóm lỗi): mô tả...").
 * 3. Xóa cột Tên ở các dòng "... - Trung chuyển (...)" vì lỗi trung chuyển
 *    (điều phối/lịch trình) không phải lúc nào cũng là lỗi cá nhân lái xe.
 */
function migrateBackfillMaVeTuyenAndFixTen() {
  var sheet = getSheet_();
  var header = sheet.getRange(1, 1, 1, 8).getValues()[0];
  if (header[6] !== "Mã vé") sheet.getRange(1, 7).setValue("Mã vé");
  if (header[7] !== "Tuyến") sheet.getRange(1, 8).setValue("Tuyến");

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var range = sheet.getRange(2, 1, lastRow - 1, 8);
  var values = range.getValues();
  var pattern = /^\[([^\]]+)\]\s+(.+?)\s+(?:- Trung chuyển )?\(/;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var loi = String(row[4] || "");
    var m = loi.match(pattern);
    if (m) {
      if (!row[6]) values[i][6] = m[1]; // Mã vé
      if (!row[7]) values[i][7] = m[2]; // Tuyến
    }
    if (loi.indexOf("- Trung chuyển (") !== -1) {
      values[i][3] = ""; // Tên: xóa vì lỗi trung chuyển không hẳn do lái xe
    }
  }

  range.setValues(values);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
