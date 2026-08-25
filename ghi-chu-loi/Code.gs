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
