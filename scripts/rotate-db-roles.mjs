#!/usr/bin/env node
/**
 * rotate-db-roles.mjs — ĐỔI MẬT KHẨU 5 DB ROLE sang giá trị đang có trong `.env` (S6-SEC-ROTATE-1 / KI-043).
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CÓ FILE NÀY, TÁCH KHỎI `setup-db-roles.mjs`
 *
 * `setup-db-roles.mjs` nối tới Postgres **qua TCP** bằng `DATABASE_DIRECT_URL`. Khi rotate, `.env` đã
 * mang mật khẩu MỚI trong khi role trong DB còn mật khẩu CŨ ⇒ chính nó không đăng nhập được:
 *
 *     [setup-db-roles] thất bại: password authentication failed for user "mediaos"   ← đo thật 2026-07-28
 *
 * Đó là bẫy thứ tự cố hữu của mọi lần rotate: công cụ đổi mật khẩu lại cần chính mật khẩu nó sắp đổi.
 * File này gỡ bằng cách bootstrap qua **local socket trong container** (`docker exec psql`), đường không
 * cần mật khẩu — rồi mới gọi `setup-db-roles.mjs` để sinh lại `userlist.txt` cho PgBouncer.
 *
 * DÙNG:
 *   1. Sinh mật khẩu mới và ghi vào `.env` / `.env.prod` (KHÔNG tracked).
 *   2. node scripts/rotate-db-roles.mjs
 *   3. docker compose up -d          # pgbouncer nạp userlist mới
 *   4. restart API / worker          # tiến trình đang chạy vẫn giữ mật khẩu CŨ trong bộ nhớ
 *   5. verify hai chiều (mật khẩu cũ PHẢI fail · /health/db PHẢI 200)
 *
 * KHÔNG in mật khẩu ra stdout/stderr. Câu SQL đi qua **stdin**, không nằm trong argv (argv của tiến
 * trình đọc được từ ngoài trên cả Windows lẫn Linux).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = process.env.MEDIAOS_ENV_FILE ?? resolve(ROOT, ".env");
const CONTAINER = process.env.PG_CONTAINER ?? "mediaos-postgres";
const SUPERUSER = process.env.PG_SUPERUSER ?? "mediaos";

/** Role → biến env. Giữ ĐỒNG BỘ với ROLE_PASSWORDS trong setup-db-roles.mjs. */
const ROLES = [
  ["mediaos_app", "APP_DB_PASSWORD"],
  ["mediaos_worker", "WORKER_DB_PASSWORD"],
  ["pgbouncer_auth", "PGBOUNCER_AUTH_PASSWORD"],
  ["mediaos_owner", "OWNER_DB_PASSWORD"],
  // SUPERUSER ĐỨNG CUỐI: đây là chìa khoá của chính đường bootstrap. Đổi sau cùng ⇒ nếu một role phía
  // trên lỗi, lần chạy lại vẫn vào được bằng đúng cách cũ.
  ["mediaos", "SUPERUSER_DB_PASSWORD"],
];

/**
 * Đọc .env — FIRST-WINS, khớp `apps/api/src/config/load-env.ts` (nguồn sự thật cho API lúc chạy).
 *
 * VÌ SAO QUAN TRỌNG (FULL gate 2026-07-28): các parser .env trong repo KHÔNG đồng ý nhau về khoá TRÙNG —
 * `load-env.ts` và `db-secrets.sh` lấy dòng ĐẦU, còn `Import-DotEnv` của mediaos.ps1 lấy dòng CUỐI.
 * Nếu ai đó rotate bằng cách APPEND dòng mới vào cuối .env, script này (last-wins) sẽ đặt cụm theo giá
 * trị MỚI trong khi API (first-wins) vẫn đọc giá trị CŨ ⇒ PROD 500 ngay sau rotate, mà log thì chỉ nói
 * "password authentication failed". Vì vậy: first-wins + TỪ CHỐI CHẠY khi thấy khoá trùng.
 */
function readEnvFile(p) {
  const out = {};
  const dup = new Set();
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    if (key in out) {
      dup.add(key);
      continue; // FIRST-WINS
    }
    out[key] = t.slice(i + 1).trim();
  }

  const relevant = [...dup].filter((k) => /_(PASSWORD|URL)$/.test(k));
  if (relevant.length > 0) {
    console.error(
      [
        "",
        `[rotate-db-roles] ⛔ .env có KHOÁ TRÙNG: ${relevant.join(", ")}`,
        "",
        "  Các parser trong repo không đồng ý nhau về khoá trùng (load-env.ts lấy dòng ĐẦU,",
        "  Import-DotEnv của mediaos.ps1 lấy dòng CUỐI). Rotate trong tình trạng này ⇒ cụm và API",
        "  dùng HAI mật khẩu khác nhau ⇒ PROD 500. Xoá dòng thừa rồi chạy lại.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  return out;
}

if (!existsSync(ENV_PATH)) {
  console.error(
    `[rotate-db-roles] không thấy ${ENV_PATH}. Đặt MEDIAOS_ENV_FILE nếu file ở chỗ khác.`,
  );
  process.exit(1);
}
const env = readEnvFile(ENV_PATH);

const missing = ROLES.filter(([, key]) => !env[key]).map(([, key]) => key);
if (missing.length > 0) {
  console.error(
    [
      `[rotate-db-roles] ⛔ .env THIẾU: ${missing.join(", ")}`,
      "",
      "  Sinh giá trị:  node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\"",
      "  rồi ghi vào .env (và .env.prod) TRƯỚC khi chạy lại lệnh này.",
    ].join("\n"),
  );
  process.exit(1);
}

// Một transaction: hoặc cả 5 role đổi, hoặc không role nào — không để cụm ở trạng thái nửa vời.
const sql = [
  "BEGIN;",
  ...ROLES.map(
    ([role, key]) => `ALTER ROLE ${role} WITH LOGIN PASSWORD '${env[key].replace(/'/g, "''")}';`,
  ),
  "COMMIT;",
].join("\n");

try {
  execFileSync(
    "docker",
    // prettier-ignore
    ["exec", "-i", CONTAINER, "psql", "-U", SUPERUSER, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
    { input: sql, stdio: ["pipe", "inherit", "inherit"] },
  );
} catch {
  console.error(
    `[rotate-db-roles] ⛔ ALTER ROLE thất bại qua container '${CONTAINER}'. Cụm KHÔNG đổi (transaction rollback).`,
  );
  process.exit(1);
}
console.log(
  `[rotate-db-roles] ✅ đã đổi mật khẩu ${ROLES.length} role: ${ROLES.map(([r]) => r).join(" · ")}`,
);

// Sinh lại userlist PgBouncer bằng mật khẩu mới — giờ TCP đã đăng nhập được.
console.log(
  "[rotate-db-roles] → setup-db-roles.mjs (sinh lại userlist PgBouncer + xác nhận idempotent)",
);
execFileSync(process.execPath, [resolve(ROOT, "scripts/setup-db-roles.mjs")], {
  stdio: "inherit",
  env: { ...process.env, ...env },
});

console.log(
  [
    "",
    "[rotate-db-roles] CÒN LẠI (mật khẩu cũ vẫn sống trong BỘ NHỚ tiến trình đang chạy):",
    "  docker compose up -d          # pgbouncer nạp userlist mới",
    "  Restart-Service MediaOS-API   # PowerShell admin",
    "  → rồi verify: mật khẩu CŨ phải FAIL, /health/db phải 200",
    "",
  ].join("\n"),
);
