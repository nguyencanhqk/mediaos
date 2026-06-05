import { z } from "zod";

/**
 * Validate biến môi trường tại biên hệ thống (coding-style: fail-fast, không tin dữ liệu ngoài).
 * DB URL để OPTIONAL → API vẫn boot khi DB chưa lên (health/db báo "down"), giúp `pnpm dev` chạy không cần docker.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3100),
  API_PREFIX: z.string().min(1).default("api"),
  API_VERSION: z.string().min(1).default("v1"),
  CORS_ORIGIN: z.string().default("http://localhost:5273"),
  // DATABASE_URL → mediaos_app qua PgBouncer (MỌI query nghiệp vụ, RLS ép ở đây).
  DATABASE_URL: z.string().url().optional(),
  // DATABASE_DIRECT_URL → owner/superuser, direct (migration + DDL).
  DATABASE_DIRECT_URL: z.string().url().optional(),
  // DATABASE_WORKER_URL → mediaos_worker, direct (outbox worker, G2-4). Fallback: DIRECT_URL.
  DATABASE_WORKER_URL: z.string().url().optional(),
  VALKEY_URL: z.string().url().optional(),

  // ── Auth (G2-6) ──────────────────────────────────────────────────────────
  // JWT_SECRET optional để API vẫn boot khi chưa cấu hình; AuthModule fail-fast khi dùng mà thiếu.
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 phút
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(2592000), // 30 ngày
  RESET_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(3600), // 1 giờ
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_SEC: z.coerce.number().int().positive().default(900), // khoá tạm 15 phút
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
