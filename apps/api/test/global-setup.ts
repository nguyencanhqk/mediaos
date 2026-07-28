import { Pool } from "pg";
import { parseDbName, PROTECTED_DB_NAMES, resolveTestDbUrls, TEST_LANE_STAMP } from "./db-target";

const trimmed = (v: string | undefined): string => (v ?? "").trim();

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
    await pool.end().catch(() => {});
    // FAIL-CLOSED. Đây là lớp chốt CUỐI — nó không được phép có nhánh "đi tiếp".
    // Bản đầu chỉ `console.warn` rồi `return`: ghép với `CI=1` đặt tay thì thành đường lách trọn
    // (DIRECT hỏng ⇒ bỏ qua kiểm, trong khi `DATABASE_URL` vẫn trỏ PROD và worker ghi qua mediaos_app).
    if (trimmed(process.env.TEST_DB_FENCE_ALLOW_UNREACHABLE) === "1") {
      console.warn(
        `[db-fence] ⚠ BỎ QUA kiểm con dấu của DB "${dbName}" theo TEST_DB_FENCE_ALLOW_UNREACHABLE=1: ${(err as Error).message}`,
      );
      return;
    }
    throw new Error(
      `[db-fence] KHÔNG kiểm được con dấu lane test của DB "${dbName}": ${(err as Error).message}\n` +
        `Từ chối chạy suite (fail-closed). DB không lên thì đừng chạy int-spec; muốn bỏ qua có chủ đích: TEST_DB_FENCE_ALLOW_UNREACHABLE=1`,
    );
  }
  await pool.end();

  if (stamp === TEST_LANE_STAMP) return;

  // DB được bảo vệ: TUYỆT ĐỐI không in lệnh đóng dấu — bản đầu in nguyên văn
  // `COMMENT ON DATABASE mediaos IS '…'`, tức đưa sẵn lệnh copy-paste để tự tay tháo lớp chốt cuối
  // khỏi chính PROD.
  const laDbBaoVe = (PROTECTED_DB_NAMES as readonly string[]).includes(dbName);
  const huongDan = laDbBaoVe
    ? [
        `⛔ "${dbName}" là DB ĐƯỢC BẢO VỆ (PROD / dev-online) — KHÔNG đóng dấu nó, dù có cách.`,
        "   Tạo lane riêng:  bash scripts/lane-db-setup.sh <lane> && export LANE_DB=mediaos_<lane>",
        "   Và bỏ URL tường minh:  unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL",
      ]
    : [
        "Nếu đây LÀ lane DB của bạn, đóng dấu (idempotent):",
        `  bash scripts/lane-db-setup.sh ${dbName.replace(/^mediaos_/, "")}`,
      ];

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
      ...huongDan,
      "",
    ].join("\n"),
  );
}
