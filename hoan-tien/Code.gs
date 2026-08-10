/**
 * BACKEND cho "Giấy đề nghị hoàn tiền" — chạy trên Google Apps Script, đọc/ghi vào Google Sheet.
 *
 * CÀI ĐẶT (làm 1 lần):
 * 1. Tạo 1 Google Sheet mới, đặt tên tab là "Requests" (đúng chữ, phân biệt hoa/thường).
 * 2. Dán các cột sau vào hàng 1 (đúng thứ tự, đúng tên):
 *    reqCode | createdAt | department | requesterName | fromDate | toDate | reason | rowsJson |
 *    totalRequest | totalApproved | bankAccount | bankName | beneficiary | status | rejectReason |
 *    approvedBy | approvedAt | paidBy | paidAt | attachmentsJson | historyJson
 * 3. Trong Sheet: Extensions (Tiện ích mở rộng) → Apps Script.
 * 4. Xóa hết code mẫu, dán TOÀN BỘ file Code.gs này vào.
 * 5. Bấm Deploy → New deployment → chọn loại "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Copy đường link "Web app URL" (dạng https://script.google.com/macros/s/xxx/exec)
 *    → dán vào biến API_URL trong file shared.js.
 * 7. Mỗi lần sửa code.gs xong phải bấm "Deploy → Manage deployments → sửa (bút chì) → New version" thì link mới nhận code mới.
 *
 * FILE ĐÍNH KÈM (hoá đơn / chứng từ gửi kèm đơn):
 * Mặc định script tự tạo 1 thư mục Drive tên "HK Hoàn tiền - Đính kèm" (trong Drive của
 * tài khoản chạy script, theo "Execute as: Me") để lưu file, không cần cấu hình gì thêm.
 * Nếu muốn chỉ định thư mục Drive có sẵn, dán ID thư mục đó vào ATTACHMENT_FOLDER_ID bên dưới.
 */

var SHEET_NAME = "Requests";
var ATTACHMENT_FOLDER_ID = ""; // để trống = tự tạo/tự tìm thư mục "HK Hoàn tiền - Đính kèm"
var ATTACHMENT_FOLDER_NAME = "HK Hoàn tiền - Đính kèm";
var MAX_ATTACHMENT_TOTAL_BYTES = 8 * 1024 * 1024; // 8MB tổng các file 1 đơn, tránh vượt giới hạn Apps Script

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
  // e sẽ là undefined nếu bấm nút "Run" trong trình soạn thảo Apps Script để test
  // thủ công (không có request thật) — chỉ chạy đúng khi gọi qua URL Web App thật.
  var action = (e && e.parameter && e.parameter.action) || "list";
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
    body = JSON.parse(e.postData.contents); // e/e.postData undefined nếu bấm "Run" thủ công thay vì gọi qua URL thật
  } catch (err) {
    return jsonOut_({ ok: false, error: "JSON không hợp lệ (hoặc bạn đang bấm Run thử trong editor thay vì gọi qua URL Web App thật)" });
  }

  var action = body.action;
  if (action === "create") return handleCreate_(sheet, body);
  if (action === "resubmit") return handleResubmit_(sheet, body);
  if (action === "approve") {
    // totalApproved > 0: ít nhất 1 dòng được duyệt -> "da_duyet".
    // totalApproved == 0: tất cả các dòng bị từ chối (duyệt theo dòng) -> coi như "tu_choi".
    var approveFields = {
      status: (Number(body.totalApproved) > 0) ? "da_duyet" : "tu_choi",
      approvedBy: body.approvedBy || "",
      approvedAt: nowIso_(),
      totalApproved: body.totalApproved
    };
    if (body.rows) approveFields.rowsJson = JSON.stringify(body.rows);
    return handleUpdate_(sheet, body.reqCode, approveFields);
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
      try { obj.attachments = obj.attachmentsJson ? JSON.parse(obj.attachmentsJson) : []; } catch (e) { obj.attachments = []; }
      try { obj.history = obj.historyJson ? JSON.parse(obj.historyJson) : []; } catch (e) { obj.history = []; }
      return obj;
    });
}

// ---- File đính kèm (Drive) ----
function getAttachmentFolder_() {
  if (ATTACHMENT_FOLDER_ID) return DriveApp.getFolderById(ATTACHMENT_FOLDER_ID);
  var props = PropertiesService.getScriptProperties();
  var cachedId = props.getProperty("ATTACHMENT_FOLDER_ID_CACHE");
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (e) { /* thư mục bị xoá, tạo lại bên dưới */ }
  }
  var existing = DriveApp.getFoldersByName(ATTACHMENT_FOLDER_NAME);
  var folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(ATTACHMENT_FOLDER_NAME);
  props.setProperty("ATTACHMENT_FOLDER_ID_CACHE", folder.getId());
  return folder;
}

function saveAttachments_(reqCode, attachments) {
  if (!attachments || !attachments.length) return [];
  var totalBytes = 0;
  attachments.forEach(function (a) { totalBytes += Math.ceil((a.data || "").length * 0.75); });
  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new Error("Tổng dung lượng file đính kèm vượt quá " + Math.round(MAX_ATTACHMENT_TOTAL_BYTES / 1024 / 1024) + "MB");
  }
  var folder = getAttachmentFolder_();
  return attachments.map(function (a) {
    var blob = Utilities.newBlob(Utilities.base64Decode(a.data), a.mimeType || "application/octet-stream", (reqCode + " - " + (a.name || "file")));
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* domain có thể chặn chia sẻ ra ngoài, bỏ qua */ }
    return { name: a.name || file.getName(), url: file.getUrl() };
  });
}

function handleCreate_(sheet, body) {
  if (!body.reqCode || !body.requesterName || !body.department) {
    return jsonOut_({ ok: false, error: "Thiếu dữ liệu bắt buộc" });
  }
  var attachments;
  try {
    attachments = saveAttachments_(body.reqCode, body.attachments);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
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
    paidBy: "", paidAt: "",
    attachmentsJson: JSON.stringify(attachments)
  };
  var rowArr = headers.map(function (h) { return record[h] !== undefined ? record[h] : ""; });
  sheet.appendRow(rowArr);
  return jsonOut_({ ok: true, reqCode: record.reqCode });
}

function getRecordByReqCode_(sheet, reqCode) {
  var headers = getHeaders_(sheet);
  var reqCodeCol = headers.indexOf("reqCode") + 1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var ids = sheet.getRange(2, reqCodeCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === reqCode) {
      var values = sheet.getRange(i + 2, 1, 1, headers.length).getValues()[0];
      var obj = {};
      headers.forEach(function (h, j) { obj[h] = values[j]; });
      return obj;
    }
  }
  return null;
}

// Đơn đã bị TỪ CHỐI TOÀN BỘ được người nộp sửa lại (bổ sung file, sửa nội dung...)
// rồi gửi lại — giữ nguyên reqCode, quay về "cho_duyet", lưu lại lịch sử lần từ chối
// trước vào historyJson để Ban Giám Đốc xem lại khi duyệt lần sau.
function handleResubmit_(sheet, body) {
  if (!body.reqCode) return jsonOut_({ ok: false, error: "Thiếu reqCode" });
  var current = getRecordByReqCode_(sheet, body.reqCode);
  if (!current) return jsonOut_({ ok: false, error: "Không tìm thấy reqCode: " + body.reqCode });
  if (current.status !== "tu_choi") {
    return jsonOut_({ ok: false, error: "Chỉ có thể gửi lại đơn đang ở trạng thái Từ chối (đơn này hiện là \"" + current.status + "\")." });
  }

  var newAttachments;
  try {
    newAttachments = saveAttachments_(body.reqCode, body.attachments);
  } catch (err) {
    return jsonOut_({ ok: false, error: err.message });
  }
  var existingAttachments = [];
  try { existingAttachments = current.attachmentsJson ? JSON.parse(current.attachmentsJson) : []; } catch (e) { existingAttachments = []; }
  var finalAttachments = existingAttachments.concat(newAttachments);

  var history = [];
  try { history = current.historyJson ? JSON.parse(current.historyJson) : []; } catch (e) { history = []; }
  history.push({
    rejectReason: current.rejectReason || "",
    rejectedBy: current.approvedBy || "",
    rejectedAt: current.approvedAt || "",
    resubmittedAt: nowIso_()
  });

  var fields = {
    requesterName: body.requesterName || current.requesterName,
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
    approvedBy: "",
    approvedAt: "",
    attachmentsJson: JSON.stringify(finalAttachments),
    historyJson: JSON.stringify(history)
  };
  return handleUpdate_(sheet, body.reqCode, fields);
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
