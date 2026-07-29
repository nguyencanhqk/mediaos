/**
 * seed-target.mjs — RESOLVER DB ĐÍCH CHO SCRIPT SEED, FAIL-CLOSED (S6-SEC-ROTATE-1 / KI-043).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO FILE NÀY TỒN TẠI
 *
 * `S6-SEC-DBFENCE-1` (KI-028) đã dựng hàng rào cho **vitest** (`test/db-target.ts` + `test/global-setup.ts`):
 * test không còn ghi được vào PROD. Nhưng bốn script seed chạy tay — `demo-seed-base` · `demo-seed-full` ·
 * `demo-seed-dashboard` · `seed-operator` — nằm HOÀN TOÀN ngoài hàng rào đó, và mỗi cái mặc định
 * `postgres://mediaos:<literal>@localhost:5432/mediaos` = **DB PROD bằng superuser**. Gõ nhầm một lệnh
 * là seed company `demo` + tài khoản `platform-admin` thẳng vào dữ liệu thật — đúng loại thiệt hại mà
 * KI-028 mất cả một WO để dọn (74 tenant test).
 *
 * HAI LUẬT (giống tinh thần `test/db-target.ts`):
 *   1. KHÔNG khai đích tường minh ⇒ DỪNG. Không có default nào cả — "mặc định tiện tay" chính là bug.
 *   2. Đích nằm trong danh sách BẢO VỆ (`mediaos` = PROD, `mediaos_dev` = dev-online) ⇒ DỪNG, trừ khi
 *      người chạy khai ĐÚNG TÊN DB đó qua `SEED_ALLOW_PROTECTED_DB` — một hành động không thể làm nhầm.
 *   URL không parse được tên DB cũng DỪNG: `postgres://mediaos:…@host:5432/` (path rỗng) vẫn nối được
 *   và libpq lấy tên DB = tên role = `mediaos` = PROD (bẫy đã đo ở KI-028).
 */

/** Giữ ĐỒNG BỘ với `PROTECTED_DB_NAMES` trong `apps/api/test/db-target.ts`. */
export const PROTECTED_DB_NAMES = ["mediaos", "mediaos_dev"];

function parseDbName(url) {
  try {
    const path = new URL(url).pathname.replace(/^\//, "");
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

function die(lines) {
  console.error(["", ...lines, ""].join("\n"));
  process.exit(1);
}

/**
 * Trả về connection string đã được kiểm duyệt, hoặc THOÁT process với hướng dẫn.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.envKeys] Thứ tự ưu tiên biến env chứa URL đích.
 * @param {string}   [opts.label]   Tên script, chỉ dùng cho thông báo.
 * @returns {string}
 */
export function resolveSeedTarget(opts = {}) {
  const envKeys = opts.envKeys ?? ["SEED_DIRECT_URL", "DATABASE_DIRECT_URL"];
  const label = opts.label ?? "seed";

  const key = envKeys.find((k) => (process.env[k] ?? "").trim());
  if (!key) {
    die([
      `[${label}] ⛔ CHƯA KHAI DB ĐÍCH — script seed không còn giá trị mặc định.`,
      "",
      `  Trước 2026-07-28 mặc định là DB PROD (\`mediaos\`) bằng mật khẩu superuser nằm trong repo PUBLIC.`,
      "  Đó là cách 74 tenant test lọt vào PROD (KI-028). Nay phải khai tường minh:",
      "",
      `    SEED_DIRECT_URL=postgres://mediaos:<mat-khau>@localhost:5432/mediaos_<lane> node ${label}.mjs`,
      "",
      `  (biến chấp nhận, theo thứ tự: ${envKeys.join(" > ")})`,
    ]);
  }

  const url = process.env[key].trim();
  const dbName = parseDbName(url);
  if (dbName === null) {
    die([
      `[${label}] ⛔ ${key} không parse được TÊN DATABASE — fail-closed.`,
      "",
      "  URL dạng `postgres://mediaos:…@host:5432/` (thiếu tên DB) VẪN nối được: libpq lấy tên database",
      "  bằng tên role ⇒ rơi đúng vào `mediaos` = PROD. Khai đầy đủ `/<ten_db>` ở cuối URL.",
    ]);
  }

  if (PROTECTED_DB_NAMES.includes(dbName)) {
    const optIn = (process.env.SEED_ALLOW_PROTECTED_DB ?? "").trim();
    if (optIn !== dbName) {
      die([
        `[${label}] ⛔ ĐÍCH LÀ DATABASE ĐƯỢC BẢO VỆ: \`${dbName}\` (${dbName === "mediaos" ? "PROD" : "dev-online"}).`,
        "",
        "  Script seed tạo company demo + tài khoản quản trị. Chạy lên DB này = làm bẩn dữ liệu thật.",
        "",
        "  Muốn thật sự làm điều đó (hiếm — thường là sai) thì khai ĐÚNG TÊN, không thể gõ nhầm:",
        "",
        `    SEED_ALLOW_PROTECTED_DB=${dbName} SEED_DIRECT_URL=... node ${label}.mjs`,
      ]);
    }
    console.warn(
      `[${label}] ⚠️  ĐANG SEED VÀO DATABASE ĐƯỢC BẢO VỆ \`${dbName}\` (đã khai SEED_ALLOW_PROTECTED_DB).`,
    );
  }

  console.log(`[${label}] DB đích: ${dbName} (từ ${key})`);
  return url;
}
