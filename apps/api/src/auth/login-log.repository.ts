import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { LoginLogSortField, AuthLogSortOrder } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { loginLogs } from "../db/schema/auth-logs";
import { users } from "../db/schema/users";
import {
  identityColumns,
  rowScopeSql,
  type IdentityGrant,
} from "../permission/identity-projection";

/**
 * Bộ lọc login-log (mọi field optional). KHÔNG nhận company_id — đường đọc đi qua withTenant + RLS ép
 * Company-scope (BẤT BIẾN #1), repo KHÔNG tự khoanh tenant (giữ ranh giới ở tầng service).
 *
 * ⚠️ Mọi field ở đây đến TỪ QUERY PARAM CỦA CALLER — không field nào là căn cứ phân quyền. Vị từ
 * scope đi đường RIÊNG (`LoginLogPage.rowScope`), cố ý KHÔNG nhét vào interface này: một field
 * optional trong bộ lọc là một field QUÊN ĐƯỢC, mà quên vị từ scope chính là KI-070.
 */
export interface LoginLogFilter {
  userId?: string;
  status?: "success" | "failed" | "blocked";
  /**
   * S10-SEC-LOGINLOG429-1 (KI-048) — lọc theo MÃ LÝ DO. `string` chứ không union đóng: đây là dữ
   * liệu append-only LỊCH SỬ, đóng union lại sẽ làm hàng mang mã cũ (hoặc mã thêm sau) không lọc
   * được. Ranh giới đã kẹp độ dài ở `loginLogListQuerySchema`; ở đây tham số hoá nên không có bề
   * mặt injection.
   *
   * ⚠️ `failure_reason` KHÔNG có index (`auth-logs.ts`) ⇒ vị từ này quét tuần tự. Chấp nhận ở quy
   * mô hiện tại; đừng đọc nhầm là có index.
   */
  failureReason?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

/** Phân trang + sắp xếp (đã qua allowlist contract ở tầng DTO). */
export interface LoginLogPage {
  sort: LoginLogSortField;
  order: AuthLogSortOrder;
  limit: number;
  offset: number;
}

/**
 * Các grant của một truy vấn, truyền BẰNG TÊN — xem docblock `findManyTx`.
 *
 * `rowScope` chặn TẬP HÀNG (cặp `view:audit-log`); `identity` che CỘT danh tính (cặp `view:user`).
 * Hai cặp quyền khác nhau, hai vị từ khác nhau, KHÔNG được gộp.
 */
export interface LoginLogGrants {
  rowScope: IdentityGrant;
  identity: IdentityGrant;
}

/** 1 hàng login-log + ref user rút gọn (leftJoin users — user_id NULL khi fail UserNotFound). */
export interface LoginLogRow {
  id: string;
  loginStatus: string;
  ipAddress: string | null;
  userAgent: string | null;
  failureReason: string | null;
  createdAt: Date;
  userId: string | null;
  identityInScope: boolean;
  userEmail: string | null;
  userFullName: string | null;
}

/**
 * Bản đồ khoá-sort (API) → CỘT drizzle. **EXPORT có chủ đích, và đây là NGUỒN DUY NHẤT** —
 * `orderBy()` bên dưới đọc nó, và ratchet `auth-log-sort-allowlist.spec.ts` cũng đọc CHÍNH NÓ.
 *
 * ⚠️ VÌ SAO PHẢI DÙNG CHUNG (FULL gate `silent-failure-hunter`, 2026-08-21 — HIGH): bản đầu của
 * ratchet giữ một bản sao TAY của bản đồ này. Bản sao đó bắt được ca **THÊM** khoá sort mà quên cập
 * nhật, nhưng **KHÔNG** bắt được ca **ĐỔI ánh xạ của khoá đang có** sang một cột đã che — tức đúng
 * hình dạng KI-069 mà `done_when` #4 của WO tuyên bố đã chặn. Ratchet khi đó chỉ tự-kiểm bản sao của
 * chính nó: xanh trên cấu tạo riêng, không xanh trên hành vi thật.
 *
 * Dùng chung KHÔNG biến ratchet thành tautology: thứ nó khẳng định là **cột thuộc bảng nào** (phải là
 * `login_logs`, không phải `users`/`sec_event_actor`), và tập khoá phải khớp allowlist lấy độc lập từ
 * `@mediaos/contracts`. Đổi một ánh xạ sang cột danh tính ⇒ ĐỎ.
 */
export const LOGIN_LOG_SORT_COLUMN: Record<LoginLogSortField, PgColumn> = {
  created_at: loginLogs.createdAt,
  status: loginLogs.loginStatus,
};

/**
 * LoginLogRepository — đọc append-only `login_logs`. Mọi truy vấn nhận `tx` từ withTenant (RLS sống) —
 * KHÔNG tự mở context. Chỉ SELECT/COUNT (append-only BẤT BIẾN #2 — KHÔNG có path UPDATE/DELETE).
 * KHÔNG select cột jsonb `metadata` (có thể chứa token/secret → BẤT BIẾN #3: không phơi ra DTO).
 *
 * ⚠️ Cũng KHÔNG select `login_logs.email` / `login_logs.normalized_email`. Hai cột đó mang danh tính
 * người NHƯNG nằm ngoài tầm của census danh tính (census chỉ bind `email`/`fullName` tới bảng
 * `users`) ⇒ thêm chúng vào `select` sẽ KHÔNG bị ratchet nào chặn. Pin tĩnh ở
 * `auth-log-sort-allowlist.spec.ts`.
 */
@Injectable()
export class LoginLogRepository {
  /**
   * S10-SEC-AUDITLOGROW-1 (KI-070) — `rowScope` là THAM SỐ ĐẦU, BẮT BUỘC, và đứng TRƯỚC filter.
   *
   * Trước bản vá hàm này chỉ nhận `filter`, mà `filter` đến trọn vẹn từ query param của caller ⇒
   * `WHERE` của một vai `view:audit-log@Own` không khác gì `WHERE` của company-admin: cả hai đọc trọn
   * 366 hàng của tenant, và `?user_id=<UUID bất kỳ>` dò được lịch sử đăng nhập của người khác.
   *
   * Vị từ scope là thành phần ĐẦU TIÊN của `and(...)` và không có đường bỏ nó: nó không phải field
   * optional của `filter`, và `rowScopeSql` ném nếu grant sai basis/sai bảng. Hệ quả cho `filter.userId`
   * là phép GIAO, không phải 403: `Own` + `?user_id=<người khác>` ⇒ `user_id = other AND user_id = me`
   * ⇒ 0 hàng, HTTP 200. Cố ý — 403 ở đây phân biệt được "ngoài scope" với "không có hàng", tức trả
   * lời hộ câu "UUID này có tồn tại không".
   */
  private buildWhere(rowScope: IdentityGrant, filter: LoginLogFilter): SQL {
    const conds: SQL[] = [rowScopeSql(rowScope, loginLogs.userId)];
    if (filter.userId) conds.push(eq(loginLogs.userId, filter.userId));
    if (filter.status) conds.push(eq(loginLogs.loginStatus, filter.status));
    if (filter.failureReason) conds.push(eq(loginLogs.failureReason, filter.failureReason));
    if (filter.dateFrom) conds.push(gte(loginLogs.createdAt, filter.dateFrom));
    if (filter.dateTo) conds.push(lte(loginLogs.createdAt, filter.dateTo));
    // Luôn ≥1 điều kiện (vị từ scope) ⇒ `and()` không bao giờ trả `undefined`; ép kiểu bằng `?? sql`
    // thay vì `!` để nhánh không-thể-xảy-ra vẫn fail-CLOSED nếu drizzle đổi hành vi.
    return and(...conds) ?? sql`false`;
  }

  /**
   * ORDER BY từ allowlist contract (sort∈{created_at,status}); chống injection (param → cột cố định).
   *
   * ⚠️ Khoá phụ `id` là BẮT BUỘC, không phải trang trí (plan-review vòng 1): `sort=status` chỉ có 3
   * giá trị trên 366 hàng ⇒ sắp theo một cột là thứ tự KHÔNG XÁC ĐỊNH, và với `OFFSET` thì hàng
   * mất/lặp giữa các trang. Cùng khuôn `me-security-activity.repository.ts`.
   *
   * ⚠️ Cả hai cột đích đều là cột CỦA CHÍNH `login_logs`, không cột nào bị che — nếu ai thêm một khoá
   * sort ánh xạ sang cột danh tính đã che thì thứ tự hàng rò đúng thứ thự vừa che (bẫy KI-069).
   * Ghim ở `auth-log-sort-allowlist.spec.ts`.
   */
  private orderBy(sort: LoginLogSortField, order: AuthLogSortOrder): SQL[] {
    const dir = order === "asc" ? asc : desc;
    return [dir(LOGIN_LOG_SORT_COLUMN[sort]), desc(loginLogs.id)];
  }

  async findManyTx(
    tx: TenantTx,
    filter: LoginLogFilter,
    page: LoginLogPage,
    // ⚠️ Object CÓ TÊN, không phải hai tham số vị trí (plan-review vòng 1): `rowScope` và `identity`
    // CÙNG kiểu `IdentityGrant`, nên hoán vị chúng là HỢP KIỂU. Ở `security-event.repository` có tới
    // BA grant cùng kiểu — đúng hình dạng lỗ B1 mà KI-054 đã trả giá. Đối chiếu bảng trong
    // `rowScopeSql`/`identityColumns` chỉ nổ lúc CHẠY, không lúc typecheck; đặt tên thì typecheck bắt.
    grants: LoginLogGrants,
  ): Promise<LoginLogRow[]> {
    return tx
      .select({
        id: loginLogs.id,
        loginStatus: loginLogs.loginStatus,
        ipAddress: loginLogs.ipAddress,
        userAgent: loginLogs.userAgent,
        failureReason: loginLogs.failureReason,
        createdAt: loginLogs.createdAt,
        userId: loginLogs.userId,
        ...identityColumns(grants.identity, {
          userEmail: users.email,
          userFullName: users.fullName,
        }),
      })
      .from(loginLogs)
      .leftJoin(users, eq(users.id, loginLogs.userId))
      .where(this.buildWhere(grants.rowScope, filter))
      .orderBy(...this.orderBy(page.sort, page.order))
      .limit(page.limit)
      .offset(page.offset);
  }

  /**
   * ⚠️ `rowScope` BẮT BUỘC ở đây y như `findManyTx`, và đây là nửa dễ quên nhất của cả bản vá: vá
   * `findManyTx` mà để `countTx` nguyên thì `data` sạch nhưng `pagination.total` VẪN phát ra số hàng
   * ngoài scope — một oracle ĐẾM ĐƯỢC, im lặng, không lộ ra ở body.
   */
  async countTx(
    tx: TenantTx,
    filter: LoginLogFilter,
    grants: Pick<LoginLogGrants, "rowScope">,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(loginLogs)
      .where(this.buildWhere(grants.rowScope, filter));
    return row?.n ?? 0;
  }
}
