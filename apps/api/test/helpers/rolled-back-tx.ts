import { sql, TransactionRollbackError } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { expect } from "vitest";
import type { TenantTx } from "../../src/db/db.service";
import * as schema from "../../src/db/schema";

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

/**
 * Bản drizzle của `withRolledBackTx` — cho hàm đích NHẬN `TenantTx` (vd `computeInputsTx`): drizzle tx trên
 * MỘT kết nối riêng của `pool`, `body(tx)`, rồi LUÔN `tx.rollback()`.
 *
 * drizzle `NodePgSession.transaction` với client KHÔNG phải Pool: BEGIN/COMMIT/ROLLBACK chạy trên chính
 * client và KHÔNG tự release ⇒ helper release. Đường bình thường: drizzle chạy ROLLBACK rồi ném lại ĐÚNG
 * lỗi nó nhận — `TransactionRollbackError` (body xong) hoặc lỗi gốc của body. Lỗi nào KHÁC hai cái đó =
 * BEGIN/ROLLBACK hỏng (drizzle để lỗi ROLLBACK thay chỗ lỗi gốc) ⇒ log + `release(err)` + ném lại lỗi gốc
 * nếu có (plan §4.0).
 */
export async function withRolledBackDrizzleTx<T>(
  pool: Pool,
  context: string,
  body: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  // Hộp (không phải `let`): gán trong callback ⇒ TS không thu hẹp nhầm kiểu sau khi callback chạy.
  const box: { outcome?: Outcome<T> } = {};
  let txError: { err: unknown } | undefined;
  try {
    await drizzle(c, { schema }).transaction(async (tx) => {
      try {
        box.outcome = { ok: true, value: await body(tx) };
      } catch (err) {
        box.outcome = { ok: false, err };
        throw err;
      }
      tx.rollback();
    });
  } catch (err) {
    txError = { err };
  }

  const outcome = box.outcome;
  const rolledBackCleanly =
    txError !== undefined &&
    outcome !== undefined &&
    (outcome.ok ? txError.err instanceof TransactionRollbackError : txError.err === outcome.err);
  if (txError && !rolledBackCleanly) {
    console.error(
      `[withRolledBackDrizzleTx] ${context}: BEGIN/ROLLBACK lỗi — huỷ kết nối (Postgres tự huỷ tx chưa commit)`,
      txError.err,
    );
    c.release(asError(txError.err));
    throw outcome && !outcome.ok ? outcome.err : txError.err;
  }
  c.release();

  if (!outcome) throw new Error(`[withRolledBackDrizzleTx] ${context}: body không chạy`);
  if (!outcome.ok) throw outcome.err;
  return outcome.value;
}

/** Bản drizzle của `enterAppRoleInTx` — cùng ba bước, cùng neo vai. */
export async function enterAppRoleInDrizzleTx(tx: TenantTx, companyId: string): Promise<void> {
  await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
  await tx.execute(sql`select set_config('app.current_company_id', ${companyId}, true)`);
  const who = await tx.execute<{ who: string }>(sql`select current_user as who`);
  expect(who.rows[0].who, "neo vai: phần kiểm phải chạy dưới vai app (RLS)").toBe(APP_ROLE);
}
