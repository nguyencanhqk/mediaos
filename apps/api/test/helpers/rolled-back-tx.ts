import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";

/**
 * S18-QA-NOTIGLOBALLEAK-1 — khuôn «gieo + kiểm + ROLLBACK trong MỘT transaction» cho int-spec cần hàng
 * GLOBAL (`company_id IS NULL`) của catalog dùng chung.
 *
 * VÌ SAO: hàng GLOBAL không thuộc tenant nào ⇒ `cleanupTenants` không dọn; spec gieo ở `beforeAll` và chỉ
 * dọn ở `afterAll` thì một lượt crash (fork vitest chết `ERR_IPC_CHANNEL_CLOSED`, KI-014) để lại hàng
 * GLOBAL sống vĩnh viễn trên lane ⇒ spec catalog đọc toàn tập (vd `noti-seed-catalog-permissions`) ĐỎ ở
 * lượt sau. Hàng CHƯA commit thì kết nối khác không thấy, và crash ở bất kỳ đâu Postgres cũng tự huỷ tx ⇒
 * không có gì để dọn.
 *
 * Luật lỗi (plan §4.0): lỗi gốc của `body` LUÔN được ném lại — lỗi ROLLBACK không bao giờ thay chỗ nó;
 * ROLLBACK lỗi ⇒ log + huỷ kết nối (`release(err)`), KHÔNG trả kết nối trạng thái không rõ về pool;
 * không có câu `COMMIT` nào.
 */

type Outcome<T> = { ok: true; value: T } | { ok: false; err: unknown };

const asError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

/** Mở `BEGIN` trên một kết nối riêng của `pool`, chạy `body`, rồi LUÔN `ROLLBACK`. */
export async function withRolledBackTx<T>(
  pool: Pool,
  context: string,
  body: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  let outcome: Outcome<T>;
  try {
    await c.query("BEGIN");
    outcome = { ok: true, value: await body(c) };
  } catch (err) {
    outcome = { ok: false, err };
  }

  try {
    await c.query("ROLLBACK");
  } catch (rollbackErr) {
    console.error(
      `[withRolledBackTx] ${context}: ROLLBACK lỗi — huỷ kết nối (Postgres tự huỷ tx chưa commit)`,
      rollbackErr,
    );
    c.release(asError(rollbackErr));
    throw outcome.ok ? rollbackErr : outcome.err;
  }
  c.release();

  if (!outcome.ok) throw outcome.err;
  return outcome.value;
}

/** Vai ứng dụng (không BYPASSRLS) — tiền lệ `foundation-db2-hygiene.int-spec.ts` (E2). */
export const APP_ROLE = "mediaos_app";

/**
 * Trong tx đang mở trên kết nối superuser: hạ xuống vai app + đặt GUC tenant (đúng `set_config` mà
 * `DatabaseService.withTenant` đặt) rồi NEO vai — RLS tính theo `current_user`, quên `SET LOCAL ROLE` thì
 * superuser bỏ qua RLS và ca cô lập xanh rỗng. Neo là assert, không phải `if/return`.
 */
export async function enterAppRoleInTx(c: PoolClient, companyId: string): Promise<void> {
  await c.query(`SET LOCAL ROLE ${APP_ROLE}`);
  await c.query("SELECT set_config('app.current_company_id', $1, true)", [companyId]);
  const who = await c.query<{ who: string }>("SELECT current_user AS who");
  expect(who.rows[0].who, "neo vai: phần kiểm phải chạy dưới vai app (RLS)").toBe(APP_ROLE);
}
