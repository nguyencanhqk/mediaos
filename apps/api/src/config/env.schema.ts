import { z } from "zod";

/**
 * Thứ tự file env — DÙNG CHUNG giữa preload (`config/load-env.ts`) và `ConfigModule.forRoot`
 * (`app.module.ts`) để KHÔNG lệch nguồn. File ĐỨNG TRƯỚC thắng (apps/api/.env override ../../.env),
 * khớp đúng precedence của @nestjs/config. Đường dẫn resolve theo `process.cwd()` (= apps/api khi chạy).
 */
export const ENV_FILE_PATHS = [".env", "../../.env"] as const;

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
  // ── Realtime (G10-1) ───────────────────────────────────────────────────────
  // Kill-switch gateway WS: 'false' tắt hẳn Socket.IO (FE còn poll REST fallback). KHÔNG z.coerce.boolean
  // (bẫy: coi 'false' → true). Default 'true'. VALKEY_URL vắng → adapter fail-soft in-memory (single instance).
  REALTIME_ENABLED: z.enum(["true", "false"]).default("true"),

  // ── Auth (G2-6) ──────────────────────────────────────────────────────────
  // JWT_SECRET optional để API vẫn boot khi chưa cấu hình; AuthModule fail-fast khi dùng mà thiếu.
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 phút
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(2592000), // 30 ngày
  RESET_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(3600), // 1 giờ
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_SEC: z.coerce.number().int().positive().default(900), // khoá tạm 15 phút

  // ── KMS / Envelope encryption (G6-2, plan §6d) ────────────────────────────
  // KMS_PROVIDER chọn DI provider: 'local' (dev, KEK 32B từ file .secrets/) | 'vault' (prod, Vault transit).
  // Default 'local' để app vẫn boot/test mà KHÔNG cần Vault (KEK đọc lazy → fail-fast lúc dùng nếu thiếu file).
  KMS_PROVIDER: z.enum(["local", "vault"]).default("local"),
  // Đường dẫn file KEK 32-byte (LocalKekProvider). ADR-0004 cấm KEK-in-env-host cho prod → chỉ dùng dev/test.
  KMS_LOCAL_KEK_PATH: z.string().min(1).default(".secrets/local-kek.bin"),
  // Vault transit — chỉ bắt buộc khi KMS_PROVIDER='vault' (xem superRefine bên dưới).
  KMS_VAULT_ADDR: z.string().url().optional(),
  KMS_VAULT_TOKEN: z.string().min(1).optional(),
  // ⚠️ ALLOW_SUPERUSER_ROTATION (KHÔNG validate qua zod — CỐ Ý): SecretRotationService đọc THẲNG
  // `process.env.ALLOW_SUPERUSER_ROTATION === 'true'` để fail-closed tuyệt đối (mọi giá trị ≠ 'true', kể cả
  // unset → CHẶN rotation bằng role BYPASS RLS). Không dùng z.coerce.boolean() vì nó coi 'false' → true (bẫy).
  // Chỉ bật ở harness test seed/teardown bằng superuser; KHÔNG đặt ở staging/prod.
}).superRefine((env, ctx) => {
  // Fail-fast: chọn Vault thì PHẢI có addr + token (không để provider chết im lúc runtime).
  if (env.KMS_PROVIDER === "vault") {
    if (!env.KMS_VAULT_ADDR) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["KMS_VAULT_ADDR"],
        message: "bắt buộc khi KMS_PROVIDER='vault'",
      });
    }
    if (!env.KMS_VAULT_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["KMS_VAULT_TOKEN"],
        message: "bắt buộc khi KMS_PROVIDER='vault'",
      });
    }
  }
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
