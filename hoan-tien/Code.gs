/**
 * BACKEND cho "Giấy đề nghị hoàn tiền" — chạy trên Google Apps Script, đọc/ghi vào Google Sheet.
 *
 * CÀI ĐẶT (làm 1 lần):
 * 1. Tạo 1 Google Sheet mới, đặt tên tab là "Requests" (đúng chữ, phân biệt hoa/thường).
 * 2. Dán các cột sau vào hàng 1 (đúng thứ tự, đúng tên):
 *    reqCode | createdAt | department | requesterName | fromDate | toDate | reason | rowsJson |
 *    totalRequest | totalApproved | bankAccount | bankName | beneficiary | status | rejectReason |
 *    approvedBy | approvedAt | paidBy | paidAt
 * 3. Trong Sheet: Extensions (Tiện ích mở rộng) → Apps Script.
 * 4. Xóa hết code mẫu, dán TOÀN BỘ file Code.gs này vào.
 * 5. Bấm Deploy → New deployment → chọn loại "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Copy đường link "Web app URL" (dạng https://script.google.com/macros/s/xxx/exec)
 *    → dán vào biến API_URL trong file shared.js.
 * 7. Mỗi lần sửa code.gs xong phải bấm "Deploy → Manage deployments → sửa (bút chì) → New version" thì link mới nhận code mới.
 */

var SHEET_NAME = "Requests";

function getSheet_() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function nowIso_() {
  return new Date().toISOString();
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var action = (e.parameter.action || "list");
  var sheet = getSheet_();
  if (!sheet) return jsonOut_({ ok: false, error: "Không tìm thấy tab '" + SHEET_NAME + "' trong Sheet" });

  if (action === "list") {
    return jsonOut_({ ok: true, data: readAllRows_(sheet) });
  }
  return jsonOut_({ ok: false, error: "Unknown action: " + action });
}

function doPost(e) {
  var sheet = getSheet_();
  if (!sheet) return jsonOut_({ ok: false, error: "Không tìm thấy tab '" + SHEET_NAME + "' trong Sheet" });

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: "JSON không hợp lệ" });
  }

  var action = body.action;
  if (action === "create") return handleCreate_(sheet, body);
  if (action === "approve") {
    return handleUpdate_(sheet, body.reqCode, {
      status: "da_duyet",
      approvedBy: body.approvedBy || "",
      approvedAt: nowIso_(),
      totalApproved: body.totalApproved
    });
  }
  if (action === "reject") {
    return handleUpdate_(sheet, body.reqCode, {
      status: "tu_choi",
      rejectReason: body.rejectReason || "",
      approvedBy: body.approvedBy || "",
      approvedAt: nowIso_()
    });
  }
  if (action === "markPaid") {
    return handleUpdate_(sheet, body.reqCode, {
      status: "da_chi",
      paidBy: body.paidBy || "",
      paidAt: nowIso_()
    });
  }
  return jsonOut_({ ok: false, error: "Unknown action: " + action });
}

function readAllRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var headers = getHeaders_(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values
    .filter(function (row) { return row[0]; }) // bỏ dòng trống (chưa có reqCode)
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      try { obj.rows = obj.rowsJson ? JSON.parse(obj.rowsJson) : []; } catch (e) { obj.rows = []; }
      return obj;
    });
}

function handleCreate_(sheet, body) {
  if (!body.reqCode || !body.requesterName || !body.department) {
    return jsonOut_({ ok: false, error: "Thiếu dữ liệu bắt buộc" });
  }
  var headers = getHeaders_(sheet);
  var record = {
    reqCode: body.reqCode,
    createdAt: nowIso_(),
    department: body.department,
    requesterName: body.requesterName,
    fromDate: body.fromDate || "",
    toDate: body.toDate || "",
    reason: body.reason || "",
    rowsJson: JSON.stringify(body.rows || []),
    totalRequest: body.totalRequest || 0,
    totalApproved: body.totalRequest || 0,
    bankAccount: body.bankAccount || "",
    bankName: body.bankName || "",
    beneficiary: body.beneficiary || "",
    status: "cho_duyet",
    rejectReason: "",
    approvedBy: "", approvedAt: "",
    paidBy: "", paidAt: ""
  };
  var rowArr = headers.map(function (h) { return record[h] !== undefined ? record[h] : ""; });
  sheet.appendRow(rowArr);
  return jsonOut_({ ok: true, reqCode: record.reqCode });
}

function handleUpdate_(sheet, reqCode, fields) {
  if (!reqCode) return jsonOut_({ ok: false, error: "Thiếu reqCode" });
  var headers = getHeaders_(sheet);
  var reqCodeCol = headers.indexOf("reqCode") + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return jsonOut_({ ok: false, error: "Không có dữ liệu" });

  var ids = sheet.getRange(2, reqCodeCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === reqCode) {
      var rowIndex = i + 2;
      Object.keys(fields).forEach(function (key) {
        var col = headers.indexOf(key) + 1;
        if (col > 0) sheet.getRange(rowIndex, col).setValue(fields[key]);
      });
      return jsonOut_({ ok: true });
    }
  }
  return jsonOut_({ ok: false, error: "Không tìm thấy reqCode: " + reqCode });
}
