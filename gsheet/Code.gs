// Google Apps Script — dán nguyên file này vào Extensions > Apps Script của 1 Google Sheet mới.
// Giữ dữ liệu Gara + Xin nghỉ trong chính Sheet đó, và (tuỳ chọn) giữ token GitHub 1 chỗ để bấm
// nút "Làm mới từ Odoo". Không trang HTML nào cần nhập token/đăng nhập gì cả.
//
// CÁCH DÙNG:
// 1. Tạo 1 Google Sheet mới (sheet trống, tên gì cũng được).
// 2. Extensions > Apps Script, xoá code mặc định, dán nguyên file này vào, bấm Save.
// 3. Deploy > New deployment > chọn loại "Web app".
//      - Execute as: Me
//      - Who has access: Anyone
//    Bấm Deploy, cho phép quyền truy cập khi được hỏi (chỉ hỏi 1 lần, đây là bạn tự cấp quyền
//    cho chính script của mình, không phải cấp cho ai khác).
// 4. Copy URL dạng https://script.google.com/macros/s/xxxxx/exec — gửi lại URL này.
// 5. (Chỉ cần nếu muốn dùng nút "Làm mới từ Odoo"): Project Settings (biểu tượng bánh răng bên
//    trái) > Script Properties > Add script property > tên GITHUB_TOKEN, dán 1 token GitHub
//    (fine-grained, quyền "Actions: Read and write" cho repo hkbuslines/bang_gia_hk_vp) > Save.
//    Token này chỉ nằm trong Script Properties, không trang HTML nào đọc được.

const SHEET_NAME = 'Data';
const REPO = 'hkbuslines/bang_gia_hk_vp';

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(['key', 'value']);
  }
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function readKey_(key) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) return data[i][1] || '';
  }
  return '';
}

function writeKey_(key, valueStr) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(valueStr);
      return;
    }
  }
  sheet.appendRow([key, valueStr]);
}

function doGet(e) {
  const key = e.parameter.key;
  if (!key) return jsonOut_({ ok: false, error: 'Thiếu tham số key' });
  const raw = readKey_(key);
  if (!raw) return jsonOut_({ entries: [] });
  try {
    return ContentService.createTextOutput(raw).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return jsonOut_({ entries: [] });
  }
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: 'JSON không hợp lệ' });
  }

  if (body.action === 'save') {
    if (!body.key || !body.payload) return jsonOut_({ ok: false, error: 'Thiếu key hoặc payload' });
    const payload = body.payload;
    payload.updated_at = new Date().toISOString();
    writeKey_(body.key, JSON.stringify(payload));
    return jsonOut_({ ok: true, updated_at: payload.updated_at });
  }

  if (body.action === 'triggerRefresh') {
    const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
    if (!token) {
      return jsonOut_({ ok: false, error: 'Chưa cấu hình GITHUB_TOKEN trong Script Properties (xem hướng dẫn bước 5 ở đầu file)' });
    }
    const res = UrlFetchApp.fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/refresh-odoo.yml/dispatches`,
      {
        method: 'post',
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' },
        contentType: 'application/json',
        payload: JSON.stringify({ ref: 'main' }),
        muteHttpExceptions: true,
      }
    );
    const code = res.getResponseCode();
    if (code === 204) return jsonOut_({ ok: true });
    return jsonOut_({ ok: false, error: 'GitHub trả về HTTP ' + code + ': ' + res.getContentText() });
  }

  return jsonOut_({ ok: false, error: 'Không rõ action: ' + body.action });
}
