import { Pool } from "pg";
import { parseDbName, resolveTestDbUrls, TEST_LANE_STAMP } from "./db-target";

/**
 * S6-SEC-DBFENCE-1 (KI-028) — LỚP 2: CON DẤU NẰM TRONG DATABASE.
 *
 * Lớp 1 (`test/db-target.ts`) chốt trên TÊN DB và có một kẽ hở còn lại: `CI=1` đặt tay ở máy local sẽ
 * bỏ qua denylist. Lớp này đóng kẽ đó bằng thứ KHÔNG giả được bằng biến môi trường — một con dấu
 * `COMMENT ON DATABASE` nằm trong CHÍNH database đích:
 *
 *   • Lane DB hợp lệ được `scripts/lane-db-setup.sh` đóng dấu '<TEST_LANE_STAMP>' lúc tạo.
 *   • DB ephemeral của CI được đóng dấu bởi 1 step trong `.github/workflows/api.yml`.
 *   • DB PROD `mediaos` và dev-online `mediaos_dev` KHÔNG BAO GIỜ được đóng dấu ⇒ không có đường ghi.
 *
 * Đặt ở `globalSetup` (chạy MỘT lần, trước toàn bộ suite) là cố ý: nó phủ cả 266 file spec mà không
 * phải sửa file nào. Vá theo từng spec chính là cách đẻ ra KI-028 — 56 file tạo company mà chỉ gate
 * `hasDb`; file thứ 57 sẽ lại quên.
 *
 * KHÔNG đọc `process.env.DATABASE_DIRECT_URL` ở đây: `test.env` của vitest chỉ áp cho WORKER, còn
 * globalSetup chạy ở tiến trình chính. Phải tự resolve đúng bằng cùng hàm mà config dùng.
 */
export default async function setup(): Promise<void> {
  const { DATABASE_DIRECT_URL } = resolveTestDbUrls(process.env);

  // Không có DB đích ⇒ run unit thuần (int-spec tự skip). Không có gì để canh.
  if (!DATABASE_DIRECT_URL) return;

  const dbName = parseDbName(DATABASE_DIRECT_URL) ?? "(không rõ)";
  const pool = new Pool({ connectionString: DATABASE_DIRECT_URL, max: 1 });

  let stamp: string | null;
  try {
    const res = await pool.query<{ stamp: string | null }>(
      `SELECT shobj_description(oid, 'pg_database') AS stamp
         FROM pg_database WHERE datname = current_database()`,
    );
    stamp = res.rows[0]?.stamp ?? null;
  } catch (err) {
    // Không nối được ⇒ để suite tự skip/đỏ theo cách cũ; KHÔNG nuốt lỗi im lặng.
    console.warn(
      `[db-fence] không kiểm được con dấu của DB "${dbName}": ${(err as Error).message}`,
    );
    await pool.end();
    return;
  }
  await pool.end();

  if (stamp === TEST_LANE_STAMP) return;

  throw new Error(
    [
      "",
      "╔══════════════════════════════════════════════════════════════════════════════════╗",
      "║  DỪNG: DB đích KHÔNG mang con dấu lane test — từ chối chạy suite.                ║",
      "╚══════════════════════════════════════════════════════════════════════════════════╝",
      `  database : ${dbName}`,
      `  con dấu  : ${stamp === null ? "(không có)" : stamp}`,
      `  cần      : ${TEST_LANE_STAMP}`,
      "",
      "Integration test SEED dữ liệu thật. Chỉ DB được đóng dấu tường minh là lane test mới được ghi",
      "(KI-028: PROD từng bị seed 74 tenant test / 226 user vì thiếu đúng hàng rào này).",
      "",
      "Nếu đây LÀ lane DB của bạn, đóng dấu (idempotent):",
      `  bash scripts/lane-db-setup.sh <lane>`,
      "hoặc đóng dấu tay:",
      `  docker exec -i mediaos-postgres psql -U mediaos -d postgres \\`,
      `    -c "COMMENT ON DATABASE ${dbName} IS '${TEST_LANE_STAMP}'"`,
      "",
      "Nếu đây là DB PROD/dev-online: ĐỪNG đóng dấu. Tạo lane riêng bằng scripts/lane-db-setup.sh.",
      "",
    ].join("\n"),
  );
}
