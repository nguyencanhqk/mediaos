import { sql, type SQL } from "drizzle-orm";
import type { DataScope } from "@mediaos/contracts";
import { addDaysToLocalDate, localDateOf, wallTimeToInstant } from "../common/tz.util";

/**
 * S20-TASK-WORKLOAD-1 — hằng + vị từ DÙNG CHUNG cho «Đội của tôi» (plan D2 · D4).
 * Nguồn duy nhất của định nghĩa «mở», «quá hạn», «sắp hạn 7 ngày»: `GET /tasks?overdue=true`
 * (`TaskCoreRepository.listTx`) và workload cùng gọi `taskOverduePredicate` ⇒ «Quá hạn: N» khớp danh sách
 * BẰNG CẤU TRÚC. REPORTCOUNTS/PROJLISTSTATS import từ đây.
 */

/** Cửa sổ «sắp hạn»: hết ngày thứ 7 tính từ hôm nay theo GIỜ CÔNG TY. */
export const TASK_DUE_SOON_DAYS = 7;

/** Alias bảng là hằng của code gọi — vẫn chặn ký tự lạ để không bao giờ nối chuỗi SQL từ đầu vào. */
const ALIAS_RE = /^[a-z][a-z0-9_]{0,15}$/;
function aliasSql(alias: string): SQL {
  if (!ALIAS_RE.test(alias)) throw new Error(`alias không hợp lệ: ${alias}`);
  return sql.raw(alias);
}

/** Việc MỞ: trạng thái NULL hoặc không Done/Cancelled. */
export function taskOpenPredicate(alias: string): SQL {
  const a = aliasSql(alias);
  return sql`(${a}.task_status is null or ${a}.task_status not in ('Done','Cancelled'))`;
}

/**
 * Quá hạn = có hạn, hạn đã qua, và còn mở. `nowExpr` mặc định `now()` (đường danh sách); workload truyền
 * đồng hồ cố định để cửa sổ sắp hạn và biên quá hạn dùng CÙNG một thời điểm.
 */
export function taskOverduePredicate(alias: string, nowExpr: SQL = sql`now()`): SQL {
  const a = aliasSql(alias);
  return sql`(${a}.due_at is not null and ${a}.due_at < ${nowExpr} and ${taskOpenPredicate(alias)})`;
}

/** Đầu ngày công ty của (hôm nay + TASK_DUE_SOON_DAYS + 1) — cận TRÊN LOẠI TRỪ của «sắp hạn». */
export function dueSoonWindowEnd(now: Date, tz: string): Date {
  const today = localDateOf(now, tz);
  return wallTimeToInstant(addDaysToLocalDate(today, TASK_DUE_SOON_DAYS + 1), "00:00:00", tz);
}

/**
 * Nhánh (A) của `buildReadScopeExists`: người phụ trách (chưa xoá mềm) thoả `scopeCond`. Đứng riêng để
 * workload dùng được mà KHÔNG đụng ~9 người gọi của `buildReadScopeExists` (có đường ghi). Văn bản KHỚP
 * NGUYÊN VĂN nhánh (A) ở `task-core.repository.ts` — `task-workload.predicates.spec.ts` ghim hai chiều.
 */
export function buildAssigneeScopeExists(scopeCond: SQL): SQL {
  return sql`exists (
      select 1 from employee_profiles
       where employee_profiles.id = tk.main_assignee_employee_id
         and employee_profiles.deleted_at is null
         and ${scopeCond}
    )`;
}

/**
 * Vị từ «người xuất hiện» (AND với `exists` read-scope của GET /tasks, plan D2):
 *  - Company/System: không thêm (undefined);
 *  - Team/Department: `(chưa giao OR người thuộc phạm vi)` — giữ nhóm «Chưa giao»;
 *  - Own: CHỈ người thuộc phạm vi (không có vế NULL ⇒ không «Chưa giao»).
 * Scope hẹp mà thiếu `scopeCond` ⇒ ném (fail-closed, không match-all).
 */
export function buildWorkloadPersonPredicate(
  scope: DataScope,
  scopeCond: SQL | undefined,
): SQL | undefined {
  if (scope === "Company" || scope === "System") return undefined;
  if (!scopeCond) throw new Error("buildWorkloadPersonPredicate: thiếu scopeCond cho scope hẹp");
  const assignee = buildAssigneeScopeExists(scopeCond);
  if (scope === "Own") return assignee;
  return sql`(tk.main_assignee_employee_id is null or ${assignee})`;
}
