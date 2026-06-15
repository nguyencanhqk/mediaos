import type { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { workerDb } from "./index";

type WorkerDb = NonNullable<typeof workerDb>;

export interface AssertWorkerRoleOpts {
  /** Tên service cho thông điệp lỗi/cảnh báo (vd "OutboxWorker"). */
  context: string;
  /**
   * - `prod-only`: chỉ NÉM khi `NODE_ENV==='production'` (dev/test chỉ cảnh báo to). Dùng cho worker
   *   KHÔNG ghi secret (outbox, dashboard MV refresh) — vẫn cần RLS đúng nhưng không phá luồng dev.
   * - `strict`: NÉM ở MỌI env trừ khi `overrideEnvVar==='true'`. Dùng cho đường GHI secret (rotation) —
   *   không nới lỏng ngầm theo môi trường (staging/CI mirror prod).
   */
  mode: "prod-only" | "strict";
  /** Tên env-var cho phép hạ xuống warn-only (chỉ mode `strict`; CHỈ chuỗi `'true'` mới có hiệu lực). */
  overrideEnvVar?: string;
  logger?: Pick<Logger, "warn">;
}

/**
 * Chặn worker chạy bằng role **BYPASS RLS / superuser** (BẤT BIẾN #1). Khi `DATABASE_WORKER_URL` vắng,
 * `workerDb` fallback `directPool` có thể là role đặc quyền ⇒ RLS bị vô hiệu + bỏ qua column-grant (ghi đè
 * `secret_ciphertext`). Gom logic từng-trùng-lặp ở OutboxWorker/SecretRotationService về 1 nơi (G16 #3).
 *
 * **Fail-closed:** KHÔNG đọc được role từ `pg_roles` (current_user bị drop giữa session / connection lỗi)
 * ⇒ NÉM — không chạy mù qua một guard bị bỏ qua im lặng. Chi tiết role (tên + cờ) CHỈ nằm trong message
 * của throw, KHÔNG bao giờ tới logger (tránh lộ topology role + quảng cáo bề mặt bypass cho ai đọc log).
 */
export async function assertWorkerRoleSafe(dbw: WorkerDb, opts: AssertWorkerRoleOpts): Promise<void> {
  const res = await dbw.execute(sql`
    SELECT current_user AS role, rolsuper, rolbypassrls
    FROM pg_roles WHERE rolname = current_user
  `);
  const row = res.rows[0] as { role: string; rolsuper: boolean; rolbypassrls: boolean } | undefined;
  if (!row) {
    throw new Error(
      `${opts.context}: không đọc được role của current_user từ pg_roles — chặn (fail-closed).`,
    );
  }
  if (!row.rolsuper && !row.rolbypassrls) return; // role an toàn

  // Chi tiết role chỉ vào message của throw (không tới log).
  const throwMsg =
    `${opts.context} đang chạy bằng role '${row.role}' có BYPASS RLS ` +
    `(super=${row.rolsuper}, bypassrls=${row.rolbypassrls}) — đặt DATABASE_WORKER_URL trỏ mediaos_worker. ` +
    `Role này bypass cả column-grant → có thể ghi đè secret.`;

  if (opts.mode === "strict") {
    // Chỉ chính xác chuỗi 'true' mới warn-only; mọi giá trị khác (kể cả unset) → NÉM.
    if (opts.overrideEnvVar && process.env[opts.overrideEnvVar] === "true") {
      opts.logger?.warn(
        `${opts.context}: role BYPASS RLS được cho qua vì ${opts.overrideEnvVar}='true' — ` +
          "chỉ dùng cho harness seed/teardown, KHÔNG đặt ở staging/prod.",
      );
      return;
    }
    throw new Error(throwMsg);
  }

  // mode 'prod-only'
  if (process.env.NODE_ENV === "production") throw new Error(throwMsg);
  opts.logger?.warn(throwMsg);
}
