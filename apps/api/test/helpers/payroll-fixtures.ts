import type { Pool } from "pg";

/**
 * S15-PAYROLL-DB-1B (plan §3.1 · §3.8 M-1) — ghi `salary_profiles.allowances` bằng SQL thô trong fixture PHẢI kèm
 * `salary_profile_items` khớp khuôn backfill mig 0570 (6c), và PHẢI trong CÙNG transaction: E2 của
 * `s15-payroll-db1-invariants` quét TOÀN lane song song, một cửa sổ autocommit «có allowances mà 0 item» là đỏ oan.
 *
 * `text` là MỘT câu INSERT/UPDATE `salary_profiles` có `RETURNING id`. Hàm tự mở transaction, chạy câu đó, xoá item
 * MIRROR (`PC_nnn`) của các hồ sơ vừa ghi rồi chèn lại theo đúng câu (6c): mã `PC_nnn` theo thứ tự phần tử · `amount` ·
 * `note = name` · `created_at/by` của hồ sơ. Item mã khác (fixture/API tạo) KHÔNG bị xoá. Hồ sơ đã xoá mềm không có
 * item (khớp (6c)).
 *
 * Nhận `Pool` và TỰ giữ transaction: nhận client đang ở trong tx của người gọi thì `BEGIN` ở đây chỉ là WARNING còn
 * `COMMIT`/`ROLLBACK` sẽ kết thúc tx của người gọi giữa chừng.
 */
export async function writeSalaryProfileWithItems(
  pool: Pool,
  text: string,
  params: readonly unknown[],
): Promise<string[]> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query<{ id: string }>(text, [...params]);
    const ids = r.rows.map((row) => row.id);
    if (ids.length === 0) {
      throw new Error(
        "writeSalaryProfileWithItems: câu ghi không trả id nào — thiếu `RETURNING id` hoặc WHERE trượt",
      );
    }
    // `\\_` trong template literal ⇒ `\_` tới Postgres = gạch dưới NGUYÊN VĂN (khuôn E3 s15-payroll-db1-invariants).
    await c.query(
      `DELETE FROM salary_profile_items
        WHERE salary_profile_id = ANY($1::uuid[]) AND component_code LIKE 'PC\\_%'`,
      [ids],
    );
    await c.query(
      `INSERT INTO salary_profile_items
         (company_id, salary_profile_id, component_code, amount, is_active, note, created_at, created_by)
       SELECT sp.company_id, sp.id, 'PC_' || lpad(e.ord::text, 3, '0'), (e.elem ->> 'amount')::numeric(18,2),
              true, e.elem ->> 'name', sp.created_at, sp.created_by
         FROM salary_profiles sp
         CROSS JOIN LATERAL jsonb_array_elements(sp.allowances) WITH ORDINALITY AS e(elem, ord)
        WHERE sp.id = ANY($1::uuid[]) AND sp.deleted_at IS NULL`,
      [ids],
    );
    await c.query("COMMIT");
    return ids;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
