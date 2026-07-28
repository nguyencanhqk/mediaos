/**
 * S6-SEC-DBFENCE-1 (KI-028) — RESOLVER DB ĐÍCH CHO TEST, FAIL-CLOSED.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO FILE NÀY TỒN TẠI (đọc trước khi sửa)
 *
 * Trước 2026-07-28, `vitest.config.ts` resolve DB đích bằng `process.env.LANE_DB ?? "mediaos"`.
 * `.env` và `.env.prod` của dự án trỏ CÙNG một DB `postgres://…@localhost:5432/mediaos` ⇒ **thiếu
 * LANE_DB thì test chạy thẳng vào DB PROD**. Vì `laneDbEnv()` LUÔN trả URL (không bao giờ rỗng),
 * `hasDb = Boolean(directUrl && appUrl)` LUÔN true ⇒ mọi spec `describe.skipIf(!hasDb)` đều CHẠY THẬT
 * và seed vào PROD.
 *
 * Đo được trên PROD 2026-07-28: **74/75 company** là tenant test, **226 user active**, trong đó **18
 * tài khoản vừa đăng nhập được vừa giữ role TOÀN CỤC** (5 `platform-admin` — có đường đọc chéo tenant).
 *
 * Truy nguyên 72/74 company về đúng spec sinh ra chúng cho thấy **HAI** vector, không phải một:
 *   V1 — spec chỉ gate `hasDb` (56 file tạo company) chạy khi KHÔNG có LANE_DB  → 58 company.
 *   V2 — spec CÓ gate `LANE_DB` vẫn ghi vào `mediaos`                            → 14 company.
 *        (LANE_DB được set nhưng CONNECTION vẫn về `mediaos`: hoặc `LANE_DB=mediaos` chép từ CI,
 *         hoặc `DATABASE_URL` tường minh trong shell/.env thắng precedence.)
 *
 * ⇒ BÀI HỌC: **sự có mặt của `LANE_DB` KHÔNG phải thuộc tính an toàn — TÊN DB ĐÍCH mới là.**
 *    Vì vậy fence ở đây chốt trên tên DB đã resolve, không chốt trên "có LANE_DB hay không".
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * HAI LUẬT (fail-closed)
 *
 *   1. Không `LANE_DB` và không URL tường minh ⇒ trả **chuỗi rỗng** cho cả 3 URL.
 *      `hasDb` = false ⇒ mọi int-spec SKIP. KHÔNG còn fallback `"mediaos"`.
 *      Cố ý trả `""` chứ KHÔNG bỏ trống key: `vitest` áp `test.env` lên `process.env` của worker, và
 *      `src/config/load-env.ts` bỏ qua khoá đã `in process.env` ⇒ `""` CHẶN luôn đường `.env` nạp lại
 *      URL PROD. Bỏ trống key sẽ mở lại chính vector đó.
 *
 *   2. DB đích nằm trong danh sách BẢO VỆ (`mediaos`, `mediaos_dev` = DB của `.env.prod` /
 *      `.env.dev-online`) ⇒ **THROW** ngay lúc load config, trừ khi `CI` được set (DB của CI là
 *      container ephemeral tình cờ trùng tên).
 *
 * `CI=1` đặt tay ở máy local vẫn lách được luật 2 — đó là lý do có lớp 2 độc lập, KHÔNG dựa vào env:
 * `test/global-setup.ts` đòi DB đích mang con dấu `mediaos-test-lane` nằm TRONG chính database.
 */

/** Con dấu cấp database của một lane DB hợp lệ (xem `test/global-setup.ts`, `scripts/lane-db-setup.sh`). */
export const TEST_LANE_STAMP = "mediaos-test-lane";

/**
 * DB KHÔNG BAO GIỜ được dùng làm DB test: `mediaos` = PROD (`.env` / `.env.prod`),
 * `mediaos_dev` = dev-online. Nới/thu qua env `TEST_DB_DENYLIST` (phân tách bằng dấu phẩy).
 */
export const PROTECTED_DB_NAMES = ["mediaos", "mediaos_dev"] as const;

export interface TestDbUrls {
  DATABASE_URL: string;
  DATABASE_DIRECT_URL: string;
  DATABASE_WORKER_URL: string;
}

/** Tên database trong một connection string Postgres (`null` nếu không parse được). */
export function parseDbName(url: string): string | null {
  if (!url) return null;
  try {
    const path = new URL(url).pathname.replace(/^\//, "");
    return path ? decodeURIComponent(path) : null;
  } catch {
    return null;
  }
}

function trimmed(v: string | undefined): string {
  return (v ?? "").trim();
}

/**
 * Resolve 3 URL DB cho test từ `env`. Ném lỗi nếu đích là DB được bảo vệ (xem luật 2 ở đầu file).
 *
 * Precedence mỗi URL: biến tường minh (`DATABASE_URL`/`_DIRECT_URL`/`_WORKER_URL`) > dựng từ `LANE_DB`.
 * Giữ nguyên precedence cũ để CI (truyền URL tường minh + `LANE_DB`) không đổi hành vi.
 */
export function resolveTestDbUrls(env: NodeJS.ProcessEnv = process.env): TestDbUrls {
  const lane = trimmed(env.LANE_DB);
  const explicitApp = trimmed(env.DATABASE_URL);
  const explicitDirect = trimmed(env.DATABASE_DIRECT_URL);
  const explicitWorker = trimmed(env.DATABASE_WORKER_URL);

  // Luật 1 — không có gì để trỏ tới ⇒ KHÔNG bịa DB. Fail-closed: int-spec skip, unit test vẫn chạy.
  if (!lane && !explicitApp && !explicitDirect && !explicitWorker) {
    return { DATABASE_URL: "", DATABASE_DIRECT_URL: "", DATABASE_WORKER_URL: "" };
  }

  const host = trimmed(env.PG_HOSTPORT) || "localhost:5432";
  const urls: TestDbUrls = {
    DATABASE_URL: explicitApp || `postgres://mediaos_app:changeme_app_only@${host}/${lane}`,
    DATABASE_DIRECT_URL: explicitDirect || `postgres://mediaos:changeme_dev_only@${host}/${lane}`,
    DATABASE_WORKER_URL:
      explicitWorker || `postgres://mediaos_worker:changeme_worker_only@${host}/${lane}`,
  };

  assertNotProtectedDb(urls, env);
  return urls;
}

/** Luật 2 — chặn cứng khi DB đích là DB PROD/dev-online. */
export function assertNotProtectedDb(urls: TestDbUrls, env: NodeJS.ProcessEnv = process.env): void {
  // CI: DB `mediaos` của job là service-container EPHEMERAL, bị huỷ cùng job ⇒ trùng tên nhưng vô hại.
  // Đây KHÔNG phải kẽ hở: `global-setup.ts` vẫn đòi con dấu nằm trong DB, `CI=1` không giả được.
  if (trimmed(env.CI)) return;

  const denylist = new Set(
    (trimmed(env.TEST_DB_DENYLIST) || PROTECTED_DB_NAMES.join(","))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const targets = new Map<string, string>();
  for (const [key, url] of Object.entries(urls)) {
    const name = parseDbName(url);
    if (name && denylist.has(name)) targets.set(key, name);
  }
  const lane = trimmed(env.LANE_DB);
  if (lane && denylist.has(lane)) targets.set("LANE_DB", lane);

  if (targets.size === 0) return;

  const chiTiet = [...targets].map(([k, v]) => `  ${k} → ${v}`).join("\n");
  throw new Error(
    [
      "",
      "╔══════════════════════════════════════════════════════════════════════════════════╗",
      "║  DỪNG: test đang trỏ vào DATABASE ĐƯỢC BẢO VỆ (PROD / dev-online).               ║",
      "╚══════════════════════════════════════════════════════════════════════════════════╝",
      chiTiet,
      "",
      "Chạy test trên DB này sẽ SEED DỮ LIỆU TEST VÀO PROD (KI-028: đã xảy ra 2 lần —",
      "74/75 company trong PROD là tenant test, 18 tài khoản test giữ role toàn cục).",
      "",
      "Cách đúng:",
      "  bash scripts/lane-db-setup.sh <lane>      # tạo + migrate + đóng dấu DB cô lập",
      "  export LANE_DB=mediaos_<lane>",
      "  unset DATABASE_URL DATABASE_DIRECT_URL DATABASE_WORKER_URL   # URL tường minh THẮNG LANE_DB",
      "",
      "Hoặc gọn hơn:  bash harness/check.sh --lane-db",
      "",
    ].join("\n"),
  );
}
