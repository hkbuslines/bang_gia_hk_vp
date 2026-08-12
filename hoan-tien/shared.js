// ==== 1. DÁN LINK WEB APP CỦA APPS SCRIPT VÀO ĐÂY (sau khi Deploy) ====
const API_URL = "https://script.google.com/macros/s/AKfycbwbi2F1DcU-61zFuUp9pmn15TwUTcVGwOVv5yKIy0E0ucPfx02gvWy6K2s1_9fkrhuciQ/exec";
// Ví dụ: "https://script.google.com/macros/s/AKfycb.../exec"

export const DEPARTMENTS = [
  { slug: "vp70", name: "VP 70 Nguyễn Hữu Huân" },
  { slug: "sapa", name: "VP Sapa" },
  { slug: "danang", name: "VP Đà Nẵng" },
  { slug: "hoian", name: "VP Hội An" },
  { slug: "hue", name: "VP Huế" },
  { slug: "vp96", name: "VP 96 Võ Chí Công" },
  { slug: "gara", name: "Bộ phận Gara" },
  { slug: "kiemsoat", name: "Bộ phận Kiểm Soát" },
  { slug: "dieuhanh", name: "Bộ phận Điều Hành" },
  { slug: "nhansu", name: "Bộ phận Nhân Sự" }
];

export const BANKS = [
  { name: "MB Bank", bin: "970422" },
  { name: "Vietcombank", bin: "970436" },
  { name: "VietinBank", bin: "970415" },
  { name: "BIDV", bin: "970418" },
  { name: "Techcombank", bin: "970407" },
  { name: "ACB", bin: "970416" },
  { name: "TPBank", bin: "970423" },
  { name: "VPBank", bin: "970432" },
  { name: "Sacombank", bin: "970403" },
  { name: "Agribank", bin: "970405" },
  { name: "SHB", bin: "970443" },
  { name: "HDBank", bin: "970437" },
  { name: "VIB", bin: "970441" },
  { name: "MSB", bin: "970426" },
  { name: "OCB", bin: "970448" }
];

export const STATUS_LABEL = {
  cho_duyet: "Chờ duyệt",
  da_duyet: "Đã duyệt",
  tu_choi: "Từ chối",
  da_chi: "Đã chi"
};

// Nhãn trạng thái hiện đúng thực tế: nếu đơn có ít nhất 1 dòng bị từ chối
// (dù đơn tổng thể đang "đã duyệt"/"đã chi") thì không nên hiện trơn là
// "Đã duyệt" — dễ hiểu lầm là toàn bộ đơn được duyệt hết, trong khi có
// phần đã bị từ chối. Trạng thái "Từ chối" (từ chối toàn bộ) không đổi.
export function statusLabelFor(r) {
  const hasRejectedLine = (r.rows || []).some(row => row.lineStatus === "tu_choi");
  if (hasRejectedLine && (r.status === "da_duyet" || r.status === "da_chi")) {
    return "Duyệt 1 phần";
  }
  return STATUS_LABEL[r.status] || r.status;
}

export function fmtVND(n) {
  n = Math.round(n || 0);
  return "đ" + n.toLocaleString("vi-VN");
}

// Hiện rõ đã duyệt bao nhiêu / bị từ chối bao nhiêu, thay vì chỉ hiện 1 số
// tổng tiền đề nghị ban đầu (dễ hiểu lầm là số đó = số đã duyệt/đã chi).
export function amountSummaryHtml(r) {
  const total = r.totalRequest || 0;
  const approved = r.totalApproved != null ? r.totalApproved : total;
  const rejected = Math.max(0, total - approved);
  if (r.status === "cho_duyet") return fmtVND(total);
  if (r.status === "tu_choi") return `<span style="color:var(--danger);">${fmtVND(total)}</span>`;
  if (rejected > 0) {
    return `${fmtVND(approved)}<br><span style="color:var(--danger); font-weight:600; font-size:11px;">(từ chối ${fmtVND(rejected)})</span>`;
  }
  return fmtVND(approved);
}
export function parseNum(v) {
  // VNĐ không có số lẻ nên bỏ hết ký tự không phải chữ số (kể cả dấu chấm
  // ngăn cách nghìn kiểu "đ280.000") thay vì dùng parseFloat — tránh lỗi
  // hiểu nhầm dấu chấm ngăn cách nghìn thành dấu thập phân.
  var n = parseInt(String(v).replace(/[^\d]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}
export function pad(n) { return n < 10 ? "0" + n : "" + n; }
export function fmtDate(v) {
  if (!v) return "";
  // Sheet có thể trả về "YYYY-MM-DD" (từ input) hoặc chuỗi ISO đầy đủ có sẵn giờ
  // (khi Google Sheets tự nhận cột là kiểu Date) — chỉ nối "T00:00:00" cho
  // trường hợp đầu, nếu không sẽ tạo ra chuỗi ngày không hợp lệ (NaN/NaN/NaN).
  var s = String(v);
  var d = s.indexOf("T") >= 0 ? new Date(s) : new Date(s + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
}
export function fmtDateTime(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  var h = d.getHours(), ampm = h >= 12 ? "PM" : "AM", h12 = h % 12; if (h12 === 0) h12 = 12;
  return pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " " + h12 + ":" + pad(d.getMinutes()) + " " + ampm;
}

// Tên Giám Đốc có chữ ký scan sẵn (signature-giamdoc.png, lấy từ file PDF mẫu) —
// khớp đúng tên thì chèn ảnh chữ ký phía trên, không khớp (vd Kế Toán tự duyệt
// đơn cabin) thì chỉ hiện tên chữ như bình thường, không có ảnh.
var SIGNATURE_NAME = "Ngô Văn Công";
export function signatureImgHtml(approvedBy) {
  if ((approvedBy || "").trim() !== SIGNATURE_NAME) return "";
  return '<img src="signature-giamdoc.png" alt="Chữ ký" style="height:34px; display:block; margin:0 auto;">';
}

export function soTienBangChu(number) {
  number = Math.round(Math.abs(number || 0));
  if (number === 0) return "Không đồng";
  var chuSo = ["không","một","hai","ba","bốn","năm","sáu","bảy","tám","chín"];
  function docBaSo(baso, forceHundred) {
    var tram = Math.floor(baso / 100), chuc = Math.floor((baso % 100) / 10), donvi = baso % 10, s = "";
    if (tram > 0) s += chuSo[tram] + " trăm ";
    else if (forceHundred) s += "không trăm ";
    if (chuc === 0) { if (donvi > 0 && (tram > 0 || forceHundred)) s += "linh "; }
    else if (chuc === 1) s += "mười ";
    else s += chuSo[chuc] + " mươi ";
    if (donvi > 0) {
      if (chuc >= 2 && donvi === 1) s += "mốt ";
      else if (chuc >= 1 && donvi === 5) s += "lăm ";
      else s += chuSo[donvi] + " ";
    }
    return s.trim();
  }
  var groups = [], n = number;
  while (n > 0) { groups.unshift(n % 1000); n = Math.floor(n / 1000); }
  var units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
  var numGroups = groups.length, parts = [];
  for (var i = 0; i < numGroups; i++) {
    var g = groups[i];
    if (g === 0) continue;
    parts.push(docBaSo(g, i > 0) + (units[numGroups - 1 - i] ? (" " + units[numGroups - 1 - i]) : ""));
  }
  var result = parts.join(" ").replace(/\s+/g, " ").trim();
  return result.charAt(0).toUpperCase() + result.slice(1) + " đồng";
}

export function genReqCode() { return "REQ-" + Date.now(); }

export function attachmentLinksHtml(attachments) {
  if (!attachments || !attachments.length) return "";
  return attachments.map(a =>
    `<a href="${a.url}" target="_blank" rel="noopener noreferrer" class="attach-link">📎 ${a.name}</a>`
  ).join("");
}

// Đơn có dòng nào bị từ chối MÀ CHƯA XỬ LÝ (chưa gửi bổ sung / chưa bấm chấp
// nhận bỏ qua) — hiện cờ này bất kể đơn đang ở trạng thái nào (đã duyệt, đã
// chi...), vì phần dòng bị từ chối vẫn cần văn phòng quyết định dù đơn đã
// được xử lý xong phần còn lại.
export function hasUnresolvedRejectedLine(r) {
  return (r.rows || []).some(row => row.lineStatus === "tu_choi" && !row.lineResolved);
}

// Mã đơn GỐC mà văn phòng đã có hành động sau khi bị từ chối — gồm cả 2
// cách: (1) sửa & gửi lại chính đơn đó (có historyJson), hoặc (2) tạo đơn
// bổ sung riêng trỏ về qua supplementOf. Chỉ tính đơn ĐANG CÒN Ở TRẠNG THÁI
// LIÊN QUAN (chờ duyệt lại, hoặc bị từ chối lần nữa) — đơn đã duyệt/đã chi
// xong thì thôi, không cần nhắc lại nữa.
//
// Tách 2 loại để phân biệt rõ với Ban Giám Đốc:
// - "pending": đang chờ duyệt lại (còn việc phải làm)
// - "rejectedAgain": gửi lại/bổ sung nhưng bị từ chối tiếp (không tự gửi
//   lại nữa được qua đơn bổ sung — VP phải tự quyết định bước tiếp theo)
export function reqCodesPendingFollowUp(requests) {
  const set = new Set();
  (requests || []).forEach(r => {
    if (r.status !== "cho_duyet") return;
    if (r.supplementOf) set.add(r.supplementOf);
    if (r.history && r.history.length) set.add(r.reqCode);
  });
  return set;
}
export function reqCodesRejectedAgain(requests) {
  const set = new Set();
  (requests || []).forEach(r => {
    if (r.status !== "tu_choi") return;
    if (r.supplementOf) set.add(r.supplementOf);
    if (r.history && r.history.length) set.add(r.reqCode);
  });
  return set;
}

export function buildVietQRUrl(bankName, account, amount, addInfo, accountName) {
  var bank = BANKS.find(function (b) { return b.name === bankName; });
  if (!bank || !account) return "";
  return "https://img.vietqr.io/image/" + bank.bin + "-" + encodeURIComponent(account) + "-compact2.png"
    + "?amount=" + Math.max(0, Math.round(amount || 0))
    + "&addInfo=" + encodeURIComponent(addInfo || "")
    + (accountName ? "&accountName=" + encodeURIComponent(accountName.toUpperCase()) : "");
}

// ---- Gọi API Apps Script ----
// Lưu ý: dùng Content-Type "text/plain" khi POST để tránh trình duyệt gửi
// preflight OPTIONS (Apps Script Web App không xử lý preflight tốt).
export async function apiList() {
  const res = await fetch(API_URL + "?action=list");
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Lỗi tải dữ liệu");
  return json.data;
}
export async function apiPost(payload) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Lỗi gửi dữ liệu");
  return json;
}
