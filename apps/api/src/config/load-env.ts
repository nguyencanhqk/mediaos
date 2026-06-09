import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ENV_FILE_PATHS } from "./env.schema";

/**
 * Nạp file `.env` vào `process.env` NGAY khi module này được import.
 * PHẢI được import TRƯỚC `AppModule` (xem `main.ts`) — đó là toàn bộ lý do file này tồn tại.
 *
 * Vì sao cần (nếu xoá sẽ tái hiện bug DB "not configured"):
 *   `db/index.ts` đọc `process.env` ở TOP-LEVEL lúc import để tạo pool theo `DATABASE_URL`.
 *   ES import được hoisted/eval trước thân `@Module`, nên `db/index.ts` chạy TRƯỚC khi
 *   `ConfigModule.forRoot()` kịp nạp `.env`. Không preload ở đây ⇒ `pool`/`db` = undefined
 *   dù `.env` có `DATABASE_URL`, và mọi `withTenant` ném `DatabaseNotConfiguredError`.
 *
 * Precedence khớp @nestjs/config (KHÔNG override): biến đã có trong `process.env` (env thật)
 * THẮNG; giữa các file, file đứng trước trong `ENV_FILE_PATHS` THẮNG. Idempotent — chạy 1 lần là đủ.
 *
 * Parser cố ý tối giản (KISS): `.env` của dự án là định dạng phẳng `KEY=VALUE` + `#` comment,
 * không quote/multiline/`export`. KHÔNG diễn giải escape/quote để tránh lệch ngầm với ý nghĩa raw.
 */
function loadEnvFiles(): void {
  for (const relPath of ENV_FILE_PATHS) {
    const absPath = resolve(process.cwd(), relPath);
    if (!existsSync(absPath)) continue;

    for (const rawLine of readFileSync(absPath, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const eq = line.indexOf("=");
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      // Bỏ qua nếu env thật / file đứng trước đã set → giữ nguyên (precedence).
      if (!key || key in process.env) continue;

      process.env[key] = line.slice(eq + 1).trim();
    }
  }
}

loadEnvFiles();
