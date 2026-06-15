import { ConflictException } from "@nestjs/common";

/**
 * G13CTL — HTTP-layer helper: map Postgres unique-violation (23505) trên các constraint
 * `revenue_records_replaces_uq` / `cost_records_replaces_uq` → 409 ConflictException.
 *
 * QUY TẮC:
 *  - Chỉ map ĐÚNG 2 constraint replaces_uq; mọi 23505 khác được rethrow nguyên trạng.
 *  - Constraint khác (không phải 23505) cũng rethrow nguyên trạng — không nuốt bất kỳ lỗi nào.
 *  - Được dùng trong controller try/catch bao quanh service.adjust() / service.void().
 */

export const PG_UNIQUE_VIOLATION = "23505";

/**
 * Kiểm tra lỗi có phải unique-violation (23505) hay không.
 * An toàn với mọi kiểu thrown value.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  return e["code"] === PG_UNIQUE_VIOLATION;
}

/**
 * Danh sách constraint name của "adjust/void double-write" trong finance.
 * Chỉ 2 constraint này được map → 409.
 */
const REPLACES_UNIQUE_CONSTRAINTS: ReadonlySet<string> = new Set([
  "revenue_records_replaces_uq",
  "cost_records_replaces_uq",
]);

/**
 * Nếu `err` là 23505 trên đúng 1 trong 2 constraint replaces_uq → ném ConflictException (409).
 * Mọi lỗi khác (23505 constraint khác, hoặc không phải 23505) → rethrow nguyên trạng.
 *
 * Dùng trong controller:
 * ```ts
 * try {
 *   return await this.revenue.adjust(companyId, userId, id, dto);
 * } catch (err) {
 *   mapReplacesUniqueToConflict(err);
 *   throw err;
 * }
 * ```
 */
export function mapReplacesUniqueToConflict(err: unknown): never | void {
  if (!isUniqueViolation(err)) return;
  const e = err as Record<string, unknown>;
  const constraint = typeof e["constraint"] === "string" ? e["constraint"] : "";
  if (REPLACES_UNIQUE_CONSTRAINTS.has(constraint)) {
    throw new ConflictException(
      "Bản ghi đã được điều chỉnh/void — thao tác trùng (double-adjust không được phép).",
    );
  }
  // 23505 nhưng constraint khác → rethrow để AllExceptionsFilter xử lý, tránh false-409.
}
