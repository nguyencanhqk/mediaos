/**
 * S10-SEC-AUDITLOGROW-1 (KI-070) — RATCHET cho `done_when` #4: *"Kiểm cả ORDER BY: sắp theo cột đã
 * che vẫn là oracle (đúng bẫy đã mắc ở KI-069)"*.
 *
 * ── Vì sao ratchet này phải neo vào CỘT, không neo vào TÊN ────────────────────────────────────────
 * Bản nháp đầu của WO định assert *"giao của allowlist sort với `{email, fullName}` phải RỖNG"*. Đó là
 * ca **xanh-RỖNG theo cấu tạo**: allowlist là chuỗi API snake_case (`created_at`/`status`/`severity`
 * /`event_type`) nên nó KHÔNG BAO GIỜ trùng chuỗi `email`; người thêm `sort=user_email` vẫn XANH.
 * Nên ratchet ánh xạ **mỗi khoá sort sang đúng cột drizzle mà `orderBy()` chọn** rồi hỏi cột đó thuộc
 * bảng nào (memory `index-ratchet-must-pin-definition-not-name`).
 *
 * Hai điều nó ép:
 *   1. Mọi cột sắp xếp phải thuộc CHÍNH bảng nhật ký. Cột của `users`/`sec_event_actor` bị che bằng
 *      `case when` (KI-054) — sắp theo cột GỐC của nó thì thứ tự hàng rò đúng thứ tự alphabet của
 *      thứ vừa che, tức bản vá thành oracle (KI-069, đã cắn thật ở `role-admin` và `leave-admin`).
 *   2. ORDER BY phải có khoá phụ `id`. `sort=status` chỉ 3 giá trị / `severity` 5 giá trị ⇒ sắp theo
 *      một cột là thứ tự KHÔNG XÁC ĐỊNH; với `OFFSET` thì hàng mất/lặp giữa các trang (bug phân
 *      trang, và nó làm chính int-spec của WO này flake).
 *
 * ⚠️ Chiều thứ ba (§D8d) là một PIN TĨNH có bằng chứng YẾU HƠN — nói thẳng ra thay vì để nó được đọc
 * như một chứng minh: nó đọc mã nguồn bằng regex. Lý do vẫn cần: `login_logs.email` và
 * `login_logs.normalized_email` mang danh tính người NHƯNG census danh tính chỉ bind `email`/`fullName`
 * tới bảng `users` (`test/foundation/identity-projection-census.ts`) ⇒ hai cột đó **vô hình** với
 * ratchet chính, và người thêm `email: loginLogs.email` vào `select` sẽ được cấp giấy thông hành.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  LOGIN_LOG_SORT_FIELDS,
  SECURITY_EVENT_SORT_FIELDS,
  type LoginLogSortField,
  type SecurityEventSortField,
} from "@mediaos/contracts";
import { loginLogs, userSecurityEvents } from "../db/schema/auth-logs";

/**
 * ⚠️ BẢN SAO CÓ CHỦ Ý của `orderBy()` trong hai repository — KHÔNG import hàm private.
 *
 * Ratchet mà gọi chính hàm nó canh thì hai vế không bao giờ lệch được và nó mất tác dụng. Ở đây bản
 * sao là thứ ĐƯỢC canh: thêm một khoá sort ở repo mà quên đây ⇒ ca "phủ hết allowlist" ĐỎ TO TIẾNG.
 */
const LOGIN_SORT_COLUMN: Record<LoginLogSortField, PgColumn> = {
  created_at: loginLogs.createdAt,
  status: loginLogs.loginStatus,
};

const SECURITY_SORT_COLUMN: Record<SecurityEventSortField, PgColumn> = {
  created_at: userSecurityEvents.createdAt,
  severity: userSecurityEvents.severity,
  event_type: userSecurityEvents.eventType,
};

const REPO_DIR = __dirname;

function repoSource(file: string): string {
  return fs.readFileSync(path.join(REPO_DIR, file), "utf8");
}

describe("KI-070 — ORDER BY của hai viewer nhật ký không được thành oracle", () => {
  it("mọi khoá sort của login-log ánh xạ sang cột CỦA CHÍNH `login_logs`", () => {
    for (const field of LOGIN_LOG_SORT_FIELDS) {
      const col = LOGIN_SORT_COLUMN[field];
      expect(col, `khoá sort "${field}" chưa có cột trong bản đồ ratchet`).toBeDefined();
      expect(getTableName(col.table), `sort=${field} sắp theo cột NGOÀI login_logs`).toBe(
        "login_logs",
      );
    }
  });

  it("mọi khoá sort của security-event ánh xạ sang cột CỦA CHÍNH `user_security_events`", () => {
    for (const field of SECURITY_EVENT_SORT_FIELDS) {
      const col = SECURITY_SORT_COLUMN[field];
      expect(col, `khoá sort "${field}" chưa có cột trong bản đồ ratchet`).toBeDefined();
      expect(getTableName(col.table), `sort=${field} sắp theo cột NGOÀI user_security_events`).toBe(
        "user_security_events",
      );
    }
  });

  it("bản đồ ratchet phủ ĐÚNG allowlist — không thừa, không thiếu", () => {
    // Chiều "không thiếu" chống người thêm khoá sort mà quên ratchet; chiều "không thừa" chống ratchet
    // canh một khoá đã bị gỡ (xanh trên một tập rỗng thực tế).
    expect(Object.keys(LOGIN_SORT_COLUMN).sort()).toEqual([...LOGIN_LOG_SORT_FIELDS].sort());
    expect(Object.keys(SECURITY_SORT_COLUMN).sort()).toEqual(
      [...SECURITY_EVENT_SORT_FIELDS].sort(),
    );
  });

  it("KHÔNG khoá sort nào ánh xạ sang cột danh tính bị che (`users` / `sec_event_actor`)", () => {
    // Vế này là hệ quả của hai ca trên, viết riêng vì nó là CÂU HỎI của `done_when` #4 — người đọc
    // sổ nghiệm thu phải tìm thấy nó dưới đúng tên đó.
    const masked = new Set(["users", "sec_event_actor"]);
    for (const col of [...Object.values(LOGIN_SORT_COLUMN), ...Object.values(SECURITY_SORT_COLUMN)])
      expect(masked.has(getTableName(col.table))).toBe(false);
  });

  it("ORDER BY có khoá phụ `id` ở CẢ HAI repository (chống thứ tự không xác định + OFFSET)", () => {
    expect(repoSource("login-log.repository.ts")).toContain("desc(loginLogs.id)");
    expect(repoSource("security-event.repository.ts")).toContain("desc(userSecurityEvents.id)");
  });
});

describe("KI-070 — pin vùng mù: `login_logs.email` / `normalized_email` KHÔNG được chiếu", () => {
  it("hai cột danh tính của chính bảng nhật ký không xuất hiện trong repository", () => {
    // Chúng nằm NGOÀI census danh tính (census chỉ bind email/fullName tới bảng `users`), nên không
    // ratchet nào khác chặn được. `normalized_email` còn tệ hơn `email`: nó là khoá dò trùng.
    const src = repoSource("login-log.repository.ts");
    expect(src).not.toContain("loginLogs.email");
    expect(src).not.toContain("loginLogs.normalizedEmail");
  });
});

describe("KI-070 — vị từ chặn TẬP HÀNG không được bỏ ở BẤT KỲ đường đọc nào", () => {
  it("`findManyTx` và `countTx` của cả hai repository đều dựng WHERE qua `buildWhere(rowScope, …)`", () => {
    // `countTx` là nửa dễ quên nhất: `data` sạch mà `pagination.total` vẫn đếm hàng ngoài scope thì
    // đó là oracle ĐẾM ĐƯỢC, im lặng, không lộ ra ở body. Ca này đếm SỐ LƯỢT gọi `buildWhere`.
    for (const file of ["login-log.repository.ts", "security-event.repository.ts"]) {
      const src = repoSource(file);
      const calls = src.match(/this\.buildWhere\(grants\.rowScope, filter\)/g) ?? [];
      expect(calls.length, `${file}: mỗi truy vấn phải đi qua buildWhere(rowScope, …)`).toBe(2);
      expect(src).toContain("rowScopeSql(rowScope,");
    }
  });
});
