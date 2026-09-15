/**
 * S15-PAYROLL-BE-4 — helper đọc kết quả `tx.execute` THÔ cho câu scalar/đếm gác QUYẾT ĐỊNH.
 *
 * VÌ SAO (silent-failure-hunter BE-4 H1): khuôn `rowsOf(res)[0]?.n ?? 0` biến «không có hàng» thành `0`. Trên luật PHỦ
 * (`uncoveredPayeesTx`: 0 = «đủ phủ» ⇒ kỳ sang `Paid`), trên `lineCountsTx` (`unpaid` 0 = «đã chi hết» ⇒ qua 027
 * `batch-incomplete`) và trên cổng `template-in-use` (`periodsUsingTx`: 0 = «không kỳ nào dùng» ⇒ xoá được mẫu) đó là
 * **fail-OPEN im lặng**. `count(*)` ở Postgres LUÔN trả đúng 1 hàng — trả khác đi là bug driver/SQL/pool ⇒ phải NÉM (500
 * sạch, không mặc định). Thông báo lỗi chỉ chở nhãn + số hàng, KHÔNG dữ liệu nghiệp vụ.
 *
 * Chỉ dùng cho câu gác quyết định; `countTx` phân trang (sai số chỉ ảnh hưởng UI) giữ khuôn mềm.
 */

function rowsOfResult(res: unknown): unknown[] | undefined {
  const rows = (res as { rows?: unknown } | null | undefined)?.rows;
  if (Array.isArray(rows)) return rows;
  if (Array.isArray(res)) return res;
  return undefined;
}

/** Đúng MỘT hàng object; khác ⇒ ném (kể cả 0 hàng, ≥2 hàng, hàng null, kết quả không phải mảng). */
export function singleRowOrThrow<T extends object>(res: unknown, label: string): T {
  const rows = rowsOfResult(res);
  if (!rows)
    throw new Error(`${label}: kết quả không phải mảng hàng — bug driver/SQL, KHÔNG mặc định 0`);
  if (rows.length !== 1) {
    throw new Error(
      `${label}: câu scalar phải trả ĐÚNG 1 hàng, nhận ${rows.length} — bug driver/SQL, KHÔNG mặc định 0`,
    );
  }
  const row = rows[0];
  if (row === null || typeof row !== "object") {
    throw new Error(`${label}: hàng scalar không phải object — bug driver/SQL, KHÔNG mặc định 0`);
  }
  return row as T;
}

/** Số nguyên ≥ 0 từ một ô đếm (`::int` hoặc chuỗi số); khác ⇒ ném. */
export function intOrThrow(value: unknown, label: string): number {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `${label}: ô đếm không phải số nguyên ≥ 0 (kiểu ${typeof value}) — bug SQL, KHÔNG mặc định 0`,
    );
  }
  return n;
}

/** `select count(*)::int as n …` ⇒ số; 0 hàng / nhiều hàng / ô không phải số ⇒ ném. */
export function countOrThrow(res: unknown, label: string, key = "n"): number {
  const row = singleRowOrThrow<Record<string, unknown>>(res, label);
  return intOrThrow(row[key], `${label}.${key}`);
}
