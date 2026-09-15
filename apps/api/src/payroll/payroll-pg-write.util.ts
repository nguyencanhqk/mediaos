import { pgErrorCode, pgErrorField } from "../common/db-error";
import { mapPayrollPgError } from "./payroll.errors";

/**
 * S15-PAYROLL-BE-4B — MỘT wrapper cho mọi câu GHI của track C (security BE-4 MEDIUM-2 gốc + L6).
 *
 * `DrizzleQueryError.message` là «Failed query: … params: [...]» — với `payroll_advances` params CHỞ `amount`; với
 * `payroll_payment_lines` câu INSERT snapshot là set-based (không có số TK trong params) nhưng UPDATE/DELETE và mọi câu
 * tương lai thì không ai bảo đảm. `AllExceptionsFilter` log `stack` của 5xx ⇒ thứ ném ra phải sạch NGAY TẠI NGUỒN:
 *  · lỗi có map (`mapPayrollPgError`: unique/CHECK/tag trigger) ⇒ HttpException đi thẳng (409/400 đúng SPEC-11 §12);
 *  · lỗi KHÔNG map ⇒ `Error` MỚI chỉ mang nhãn bảng + `code` + `constraint` + tag `<trigger>:<tag>` — KHÔNG `cause`,
 *    KHÔNG params, KHÔNG message gốc. Bất cứ lỗi nào (kể cả không phải PG) cũng đi qua khuôn này: đường ghi tiền không
 *    có nhánh «ném lại nguyên lỗi».
 */
export async function mappedWrite<T>(table: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const mapped = mapPayrollPgError(err);
    if (mapped) throw mapped;
    const code = pgErrorCode(err) ?? "unknown";
    const constraint = pgErrorField(err, "constraint") ?? "";
    throw new Error(
      `${table} write failed: code=${code} constraint=${constraint} tag=${triggerTagOf(err)}`,
    );
  }
}

/** Tag `<trigger>:<tag>` — bóc từ message của node PG (lớp có `code`), KHÔNG lấy phần thân sau tag. */
function triggerTagOf(err: unknown): string {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && typeof cur === "object" && cur !== null; depth++) {
    const node = cur as Record<string, unknown>;
    if (typeof node["code"] === "string") {
      const m = /^(\w+:[a-z-]+):/.exec(String(node["message"] ?? ""));
      return m ? m[1] : "";
    }
    cur = node["cause"];
  }
  return "";
}
