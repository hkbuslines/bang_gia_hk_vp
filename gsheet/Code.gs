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
// 1 ô Google Sheets giới hạn cứng 50.000 ký tự. Trước đây ghi thẳng cả chuỗi JSON vào 1 ô — khi
// vượt giới hạn, setValue() ném lỗi NHƯNG doPost không có try/catch nên throw ra ngoài khiến
// Apps Script trả về trang lỗi HTML thay vì JSON; ở một số trường hợp khác (ví dụ ghi đè ô đã có
// dữ liệu ngắn hơn) việc ghi coi như "thành công" phía client dù giá trị thật sự không đổi — nhìn
// chung là thất bại IM LẶNG, rất khó phát hiện. Giờ tự động CHIA NHỎ chuỗi dài ra nhiều ô liên tiếp
// (mỗi ô ≤ CHUNK_SIZE ký tự, chừa biên an toàn) — bỏ hẳn giới hạn thay vì né nó, và luôn báo lỗi rõ
// ràng nếu ghi thất bại vì lý do khác (quota, mạng...) thay vì báo "ok" giả.
const CHUNK_SIZE = 40000;

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

// Chuỗi dài được lưu thành nhiều dòng liên tiếp ngay sau dòng "key" gốc:
//   key            | __chunked__:<tổng số đoạn>
//   key::chunk::1  | <đoạn 1>
//   key::chunk::2  | <đoạn 2>
//   ...
// readKey_ tự nhận diện và ghép lại; dữ liệu cũ ghi kiểu 1-ô vẫn đọc bình thường (tương thích ngược).
function chunkMarkerKey_(key, idx) { return key + '::chunk::' + idx; }

function readKey_(key) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      const raw = data[i][1] || '';
      const m = /^__chunked__:(\d+)$/.exec(raw);
      if (!m) return raw;
      const total = parseInt(m[1], 10);
      const chunkMap = {};
      for (let j = 1; j < data.length; j++) {
        const ck = String(data[j][0] || '');
        const cm = /^.+::chunk::(\d+)$/.exec(ck);
        if (cm && ck.indexOf(key + '::chunk::') === 0) {
          chunkMap[parseInt(cm[1], 10)] = data[j][1] || '';
        }
      }
      let out = '';
      for (let n = 1; n <= total; n++) {
        if (!(n in chunkMap)) throw new Error('Thiếu đoạn ' + n + '/' + total + ' của key "' + key + '" — dữ liệu bị hỏng.');
        out += chunkMap[n];
      }
      return out;
    }
  }
  return '';
}

function writeKey_(key, valueStr) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  let keyRow = -1;
  const oldChunkRows = []; // {row, idx} — các dòng chunk CŨ của key này, để dọn nếu số đoạn mới ít hơn
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) keyRow = i;
    const ck = String(data[i][0] || '');
    const cm = /^.+::chunk::(\d+)$/.exec(ck);
    if (cm && ck.indexOf(key + '::chunk::') === 0) oldChunkRows.push({ row: i, idx: parseInt(cm[1], 10) });
  }

  const needsChunking = valueStr.length > CHUNK_SIZE;
  const chunks = [];
  if (needsChunking) {
    for (let p = 0; p < valueStr.length; p += CHUNK_SIZE) chunks.push(valueStr.slice(p, p + CHUNK_SIZE));
  }
  const headerValue = needsChunking ? ('__chunked__:' + chunks.length) : valueStr;

  if (keyRow === -1) {
    sheet.appendRow([key, headerValue]);
  } else {
    sheet.getRange(keyRow + 1, 2).setValue(headerValue);
  }

  // ghi các đoạn mới (append vào cuối sheet — thứ tự dòng không quan trọng, readKey_ tra theo tên key)
  chunks.forEach((c, idx0) => {
    const idx = idx0 + 1;
    const existing = oldChunkRows.find(r => r.idx === idx);
    if (existing) {
      sheet.getRange(existing.row + 1, 2).setValue(c);
    } else {
      sheet.appendRow([chunkMarkerKey_(key, idx), c]);
    }
  });
  // dọn các đoạn CŨ dư ra (lần lưu trước nhiều đoạn hơn lần này)
  oldChunkRows.filter(r => r.idx > chunks.length).forEach(r => {
    sheet.getRange(r.row + 1, 1, 1, 2).clearContent();
  });

  // Xác minh lại ngay sau khi ghi — phát hiện sớm nếu vì lý do gì đó (quota, race) mà không ghi đúng,
  // thay vì để client tin "ok" rồi phát hiện mất dữ liệu về sau.
  const verify = readKey_(key);
  if (verify !== valueStr) {
    throw new Error('Ghi thất bại: đọc lại không khớp dữ liệu vừa lưu (độ dài ghi ' + valueStr.length + ', đọc lại ' + verify.length + ').');
  }
}

function doGet(e) {
  // e undefined khi bấm "Run" thử trực tiếp trong Apps Script editor (không phải request thật qua
  // URL) — trả thông báo rõ ràng thay vì crash TypeError, không ảnh hưởng gì khi chạy qua Web App.
  if (!e || !e.parameter) return jsonOut_({ ok: false, error: 'Hàm này chỉ chạy qua URL Web App (thêm ?key=...), không chạy trực tiếp trong editor.' });
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
  // e undefined khi bấm "Run" thử trực tiếp trong Apps Script editor — xem chú thích ở doGet.
  if (!e || !e.postData) return jsonOut_({ ok: false, error: 'Hàm này chỉ chạy qua URL Web App (POST thật), không chạy trực tiếp trong editor.' });
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
    try {
      writeKey_(body.key, JSON.stringify(payload));
    } catch (err) {
      // Trả lỗi rõ ràng thay vì để exception rơi ra thành trang lỗi HTML (client parse JSON sẽ
      // không thấy "ok":true và tự retry) — không bao giờ báo "ok":true khi chưa chắc đã ghi đúng.
      return jsonOut_({ ok: false, error: 'Lưu thất bại: ' + err.message });
    }
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
