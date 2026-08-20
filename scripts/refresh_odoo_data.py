# -*- coding: utf-8 -*-
"""
Chạy trong GitHub Actions: lấy lịch chuyến mới nhất từ Odoo (ngày nào Odoo đã có lịch thật thì
lấy thật, kèm xe/tài đã được gán sẵn; ngày nào chưa có thì dùng nề nếp 1 ngày cùng thứ gần nhất
trong quá khứ làm tạm), rồi ghi đè xep_xe_timeline.html ngay tại chỗ.

Cần các biến môi trường: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD (đặt trong GitHub Secrets).
"""
import os, re, json, datetime, xmlrpc.client, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)  # script nằm ở scripts/, repo root là thư mục cha

WINDOW_DAYS = 14       # tổng số ngày hiển thị về tương lai, tính từ hôm nay
HISTORY_DAYS = 14      # số ngày quá khứ vẫn giữ lại lịch thật trong trang (không bị mất khi qua ngày)
LOOKBACK_DAYS = 28      # phạm vi quét quá khứ để tìm ngày tham chiếu cùng thứ (phải >= HISTORY_DAYS)
MIN_REF_TRIPS = 50      # 1 ngày quá khứ được coi là "đủ dữ liệu" để làm mẫu nếu có >= số chuyến này

WEEKDAY_VN = {0: "T2", 1: "T3", 2: "T4", 3: "T5", 4: "T6", 5: "T7", 6: "CN"}


def vn_today():
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=7)).date()


def odoo_call():
    url = os.environ["ODOO_URL"]
    db = os.environ["ODOO_DB"]
    user = os.environ["ODOO_USER"]
    key = os.environ["ODOO_PASSWORD"]

    class _UA(xmlrpc.client.SafeTransport):
        def send_headers(self, conn, headers):
            conn.putheader("User-Agent", "Mozilla/5.0 (GitHub Actions refresh bot)")
            super().send_headers(conn, headers)

    common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common", transport=_UA())
    uid = common.authenticate(db, user, key, {})
    models = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object", transport=_UA())

    def call(model, method, *args, **kw):
        return models.execute_kw(db, uid, key, model, method, list(args), kw)
    return call


def to_min(hhmm):
    h, m = map(int, hhmm.split(":"))
    return h * 60 + m


def parse_from_to(route):
    r = re.sub(r"\s*\(Limousine\)\s*$", "", route or "").strip()
    parts = r.split(" - ")
    return (parts[0].strip(), parts[1].strip()) if len(parts) == 2 else (route, route)


def strip_diacritics(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.replace("đ", "d").replace("Đ", "D").lower().strip()


def normalize_driver_names(days_out, drivers_full):
    # Odoo đôi khi trả tên tài xế không dấu (vd "NGUYEN THANH TUAN") — khớp lại đúng tên có dấu
    # theo danh sách lái xe chính thức để các chỗ khác (đối chiếu nghỉ phép, đếm lái đang chạy...)
    # nhận diện đúng người, không bị coi là người lạ chỉ vì thiếu dấu.
    # LUÔN ưu tiên khớp ĐÚNG NGUYÊN VĂN (có dấu đầy đủ) trước khi bỏ dấu so khớp mờ — bỏ hết dấu
    # (kể cả ơ/ư/ă/â/ê/ô, không chỉ thanh điệu) khiến 2 người khác nhau thật trùng cùng 1 khoá (vd
    # "Nguyễn Văn Cương" và "Nguyễn Văn Cường" đều thành "nguyen van cuong"); nếu chỉ dùng khớp mờ,
    # tên ĐÃ ĐÚNG do Odoo trả về có thể bị ghi đè nhầm thành tên người trùng khoá kia. Khớp mờ chỉ
    # dùng làm phương án cuối cho tên Odoo trả về thật sự không dấu / không khớp nguyên văn ai cả.
    exact_names = {d["ten"] for d in drivers_full}
    canon_by_key = {}
    for d in drivers_full:
        canon_by_key.setdefault(strip_diacritics(d["ten"]), d["ten"])
    for day in days_out:
        for t in day["trips"]:
            for key in ("odooLai1", "odooLai2"):
                name = t.get(key)
                if name and name not in exact_names:
                    t[key] = canon_by_key.get(strip_diacritics(name), name)


def build_trip(t):
    dep = to_min(t["departure_time"])
    arr = to_min(t["arrival_time"])
    if t.get("arrival_date") and t["arrival_date"] != t["date"]:
        arr += 24 * 60
    elif arr < dep:
        arr += 24 * 60
    if arr - dep > 1200:
        arr = dep + 1200
    route = t["route_id"][1] if t["route_id"] else "?"
    f, to = parse_from_to(route)
    return {
        "id": t["id"], "route": route, "dep": dep, "arr": arr,
        "depStr": t["departure_time"], "arrStr": t["arrival_time"],
        "from": f, "to": to,
        "assignedBks": t["vehicle_id"][1] if t.get("vehicle_id") else None,
        # tài xế thật đã lắp trong Odoo cho đúng chuyến này (driver_id/driver2_id trên vexere.trip) —
        # dùng để ưu tiên thay cho định biên tĩnh khi đã có
        "odooLai1": t["driver_id"][1] if t.get("driver_id") else None,
        "odooLai2": t["driver2_id"][1] if t.get("driver2_id") else None,
    }


def main():
    call = odoo_call()
    today = vn_today()
    window_start = today - datetime.timedelta(days=HISTORY_DAYS)
    window_end = today + datetime.timedelta(days=WINDOW_DAYS - 1)
    lookback_start = today - datetime.timedelta(days=LOOKBACK_DAYS)

    rows = call("vexere.trip", "search_read",
                [["date", ">=", lookback_start.isoformat()], ["date", "<=", window_end.isoformat()]],
                ["id", "date", "departure_time", "arrival_date", "arrival_time", "route_id", "vehicle_id",
                 "driver_id", "driver2_id"])

    by_date = {}
    for r in rows:
        by_date.setdefault(r["date"], []).append(r)

    days_out = []
    d = window_start
    while d <= window_end:
        ds = d.isoformat()
        wd = WEEKDAY_VN[d.weekday()]
        raw = by_date.get(ds, [])
        # ngày đã qua (d < today) chỉ giữ đúng lịch thật đã chạy, không cần "dự kiến" cho quá khứ —
        # giữ lại HISTORY_DAYS ngày gần nhất để không mất dữ liệu mỗi khi trang tự build lại theo
        # ngày mới; ngày tương lai có dữ liệu Odoo thật (raw) cũng xử lý y hệt
        if d < today or raw:
            trips = sorted((build_trip(t) for t in raw), key=lambda x: x["dep"])
            days_out.append({"date": ds, "weekday": wd, "dd": f"{d.day:02d}/{d.month:02d}",
                              "trips": trips, "real": True})
        else:
            # tìm ngày quá khứ gần nhất cùng thứ có đủ dữ liệu làm mẫu
            ref_date = None
            for back in range(1, LOOKBACK_DAYS + 1):
                cand = today - datetime.timedelta(days=back)
                if cand.weekday() != d.weekday():
                    continue
                cand_rows = by_date.get(cand.isoformat(), [])
                if len(cand_rows) >= MIN_REF_TRIPS:
                    ref_date = cand.isoformat()
                    ref_rows = cand_rows
                    break
            if ref_date is None:
                # không tìm được mẫu tốt — lấy tạm ngày quá khứ gần nhất cùng thứ có ít nhất 1 chuyến
                for back in range(1, LOOKBACK_DAYS + 1):
                    cand = today - datetime.timedelta(days=back)
                    if cand.weekday() != d.weekday():
                        continue
                    cand_rows = by_date.get(cand.isoformat(), [])
                    if cand_rows:
                        ref_date = cand.isoformat()
                        ref_rows = cand_rows
                        break
            trips = []
            if ref_date:
                trips = sorted((build_trip(t) for t in ref_rows), key=lambda x: x["dep"])
                for t in trips:
                    t["assignedBks"] = None
                    t["odooLai1"] = None
                    t["odooLai2"] = None
            days_out.append({"date": ds, "weekday": wd, "dd": f"{d.day:02d}/{d.month:02d}",
                              "trips": trips, "real": False, "refDate": ref_date})
        d += datetime.timedelta(days=1)

    # ---- load static config committed in repo ----
    with open(os.path.join(REPO_ROOT, "data", "bus_groups.json"), encoding="utf-8") as f:
        bus_groups = json.load(f)
    with open(os.path.join(REPO_ROOT, "data", "route_config.json"), encoding="utf-8") as f:
        route_config = json.load(f)
    with open(os.path.join(REPO_ROOT, "data", "drivers_full.json"), encoding="utf-8") as f:
        drivers_full = json.load(f)
    with open(os.path.join(REPO_ROOT, "template_xep_xe.html"), encoding="utf-8") as f:
        template = f.read()

    normalize_driver_names(days_out, drivers_full)

    html = template
    html = html.replace("__BUSES_JSON__", json.dumps(bus_groups["buses"], ensure_ascii=False))
    html = html.replace("__DAYS_JSON__", json.dumps(days_out, ensure_ascii=False))
    html = html.replace("__ROUTE_ORDER_JS__", json.dumps(route_config["order"], ensure_ascii=False))
    html = html.replace("__FALLBACK_IDX__", str(route_config["fallback_idx"]))
    html = html.replace("__GROUP_ORDER_KEYS_JS__", json.dumps(bus_groups["group_order"], ensure_ascii=False))
    html = html.replace("__GROUP_META_JS__", json.dumps(bus_groups["group_meta"], ensure_ascii=False))
    html = html.replace("__DRIVERS_JSON__", json.dumps(drivers_full, ensure_ascii=False))

    out_path = os.path.join(REPO_ROOT, "xep_xe_timeline.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    # kíp lái cần thiết/ngày = số nốt giờ (chuyến) thật trong ngày đó — cho trang xin nghỉ dùng thay vì số tĩnh đoán
    kip_lai = {
        day["date"]: {"kip": len(day["trips"]), "real": day["real"], "refDate": day.get("refDate")}
        for day in days_out
    }
    kip_path = os.path.join(REPO_ROOT, "data", "kip_lai_theo_ngay.json")
    with open(kip_path, "w", encoding="utf-8") as f:
        json.dump(kip_lai, f, ensure_ascii=False, indent=2)

    real_count = sum(1 for x in days_out if x["real"])
    print(f"OK — {len(days_out)} ngày ({real_count} ngày thật, {len(days_out)-real_count} dự kiến), "
          f"ghi vào {out_path} và {kip_path}")


if __name__ == "__main__":
    main()
