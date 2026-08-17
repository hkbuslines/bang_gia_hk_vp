// Cloudflare Worker — giữ GitHub token 1 chỗ duy nhất (server-side secret),
// không trang HTML nào cần nhập/lưu token nữa. Các trang chỉ gọi 2 endpoint dưới đây.
//
// Deploy: dán nguyên file này vào Cloudflare dashboard > Workers > tạo Worker mới > Edit code.
// Sau đó vào Settings > Variables > Secrets, thêm biến GITHUB_TOKEN = personal access token
// (fine-grained, quyền "Contents: Read and write" + "Actions: Read and write" cho repo
// hkbuslines/bang_gia_hk_vp). Không ai khác nhìn thấy được giá trị này qua trang HTML.

const REPO = 'hkbuslines/bang_gia_hk_vp';
const ALLOWED_FILES = new Set(['bao_duong_data.json', 'lai_xe_nghi_data.json']);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'hkbuslines-worker',
  };
}

async function handleSave(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ ok: false, error: 'JSON không hợp lệ' }, 400);
  }
  const { path, payload } = body || {};
  if (!ALLOWED_FILES.has(path)) {
    return json({ ok: false, error: 'File không được phép ghi: ' + path }, 400);
  }
  const apiUrl = `https://api.github.com/repos/${REPO}/contents/${path}`;
  let sha = null;
  const cur = await fetch(apiUrl, { headers: ghHeaders(env.GITHUB_TOKEN) });
  if (cur.ok) {
    sha = (await cur.json()).sha;
  } else if (cur.status !== 404) {
    return json({ ok: false, error: 'Không đọc được file hiện tại (HTTP ' + cur.status + ')' }, 502);
  }
  const content = { ...payload, updated_at: new Date().toISOString() };
  const putBody = {
    message: `Cập nhật ${path} qua API — ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
  };
  if (sha) putBody.sha = sha;
  const put = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...ghHeaders(env.GITHUB_TOKEN), 'Content-Type': 'application/json' },
    body: JSON.stringify(putBody),
  });
  if (!put.ok) {
    const errBody = await put.json().catch(() => ({}));
    return json({ ok: false, error: errBody.message || ('HTTP ' + put.status) }, 502);
  }
  return json({ ok: true, updated_at: content.updated_at });
}

async function handleTriggerRefresh(env) {
  const dispatchUrl = `https://api.github.com/repos/${REPO}/actions/workflows/refresh-odoo.yml/dispatches`;
  const res = await fetch(dispatchUrl, {
    method: 'POST',
    headers: { ...ghHeaders(env.GITHUB_TOKEN), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (res.status === 204) return json({ ok: true });
  const errBody = await res.json().catch(() => ({}));
  return json({ ok: false, error: errBody.message || ('HTTP ' + res.status) }, 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (!env.GITHUB_TOKEN) {
      return json({ ok: false, error: 'Worker chưa cấu hình GITHUB_TOKEN (thêm ở Settings > Variables > Secrets)' }, 500);
    }
    if (url.pathname === '/save' && request.method === 'POST') {
      return handleSave(request, env);
    }
    if (url.pathname === '/trigger-refresh' && request.method === 'POST') {
      return handleTriggerRefresh(env);
    }
    return json({ ok: false, error: 'Not found' }, 404);
  },
};
