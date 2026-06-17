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
  // PGBOUNCER_URL → mediaos_app QUA PgBouncer transaction-mode (:6432). Chỉ dùng cho integration test
  // kiểm chứng tenant isolation giữ vững khi connection bị tái dùng qua pooler (GX-4, g2rls). App runtime
  // dùng DATABASE_URL (đã trỏ PgBouncer ở prod). Vắng ⇒ test pgbouncer tự skip (không đỏ giả).
  PGBOUNCER_URL: z.string().url().optional(),
  VALKEY_URL: z.string().url().optional(),
  // ── Realtime (G10-1) ───────────────────────────────────────────────────────
  // Kill-switch gateway WS: 'false' tắt hẳn Socket.IO (FE còn poll REST fallback). KHÔNG z.coerce.boolean
  // (bẫy: coi 'false' → true). Default 'true'. VALKEY_URL vắng → adapter fail-soft in-memory (single instance).
  REALTIME_ENABLED: z.enum(["true", "false"]).default("true"),

  // ── Auth (G2-6) ──────────────────────────────────────────────────────────
  // JWT_SECRET optional để API vẫn boot khi chưa cấu hình; AuthModule fail-fast khi dùng mà thiếu.
  JWT_SECRET: z.string().min(32).optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 phút
  // AC-0b: TTL access token PHIÊN OPERATOR (platform-admin, aud='operator'). Ngắn hơn tenant — phiên
  // control-plane chéo tenant rủi ro cao nên thu hẹp cửa sổ. Default 600s (10 phút).
  OPERATOR_ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(600),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(2592000), // 30 ngày
  RESET_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(3600), // 1 giờ
  // G16-1b: ép server-side 2FA enrollment. Default 'true' (BẬT ở prod) — user có role requires_two_factor
  // mà chưa enroll bị TwoFactorEnforcementGuard DENY mọi tài nguyên bảo vệ. KHÔNG z.coerce.boolean ('false'→true
  // bẫy). Đặt 'false' ở harness e2e cũ (admin chưa enroll qua login mock) để không phá bộ test sẵn có; logic
  // DENY vẫn được phủ bởi unit-test guard + tích phân riêng. Prod/staging GIỮ default true.
  TWO_FACTOR_ENFORCEMENT_ENABLED: z.enum(["true", "false"]).default("true"),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_SEC: z.coerce.number().int().positive().default(900), // khoá tạm 15 phút
  // Bucket THEO TÀI KHOẢN (company|email, mọi IP) — bắt credential-stuffing phân tán nhiều IP lên 1 account.
  // Ngưỡng cao hơn per-IP (mặc định 20) để giảm rủi ro account-lockout DoS; vẫn là backstop, không thay per-IP.
  LOGIN_ACCOUNT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),

  // ── FS-1a Session / SSO cookie (frontend-split plan §7) ───────────────────
  // AUTH_COOKIE_DOMAIN: domain cho refresh/CSRF cookie. Prod = `.<domain>` (vd `.mediaos.example`) để cookie
  // dùng chung mọi subdomain (auth./studio./people./console.). RỖNG (default) → cookie host-only (dev không
  // subdomain). KHÔNG validate URL (đây là cookie Domain attribute, không phải origin).
  AUTH_COOKIE_DOMAIN: z.string().default(""),
  // AUTH_COOKIE_SECURE: gắn cờ Secure cho cookie. Default 'true' (prod BẮT BUỘC TLS). Đặt 'false' CHỈ ở dev
  // không-TLS (http). KHÔNG z.coerce.boolean ('false'→true bẫy). Browser cho phép Secure trên localhost.
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).default("true"),
  // AUTH_REDIRECT_ALLOWLIST: danh sách origin (phẩy) được phép cho `?redirect` (chống open-redirect, rủi ro
  // #11). So khớp origin TƯỜNG MINH (scheme+host+port), KHÔNG '*', KHÔNG substring. RỖNG (default) → từ chối
  // MỌI redirect (fail-closed). Vd: `https://studio.localhost,https://people.localhost,https://console.localhost`.
  AUTH_REDIRECT_ALLOWLIST: z.string().default(""),

  // ── G16-3 SaaS enforcement (feature-flag / usage-limit guards) ────────────
  // Kill-switch toàn cục cho FeatureFlagEnforcementGuard + UsageLimitEnforcementGuard. Default 'true'
  // (BẬT). Guard CHỈ áp khi route khai @RequireFeature/@EnforceUsageLimit (no-op nếu không) ⇒ default
  // bật KHÔNG ảnh hưởng route hiện có. Đặt 'false' để tắt hẳn enforcement (emergency rollback). KHÔNG
  // z.coerce.boolean ('false'→true bẫy).
  SAAS_ENFORCEMENT_ENABLED: z.enum(["true", "false"]).default("true"),

  // ── KMS / Envelope encryption (G6-2, plan §6d) ────────────────────────────
  // KMS_PROVIDER chọn DI provider: 'local' (dev, KEK 32B từ file .secrets/) | 'vault' (prod, Vault transit).
  // Default 'local' để app vẫn boot/test mà KHÔNG cần Vault (KEK đọc lazy → fail-fast lúc dùng nếu thiếu file).
  KMS_PROVIDER: z.enum(["local", "vault"]).default("local"),
  // Đường dẫn file KEK 32-byte (LocalKekProvider). ADR-0004 cấm KEK-in-env-host cho prod → chỉ dùng dev/test.
  KMS_LOCAL_KEK_PATH: z.string().min(1).default(".secrets/local-kek.bin"),
  // Vault transit — chỉ bắt buộc khi KMS_PROVIDER='vault' (xem superRefine bên dưới).
  KMS_VAULT_ADDR: z.string().url().optional(),
  KMS_VAULT_TOKEN: z.string().min(1).optional(),
  // ── Object storage / S3 (B4 task attachments — MinIO/R2 qua @aws-sdk/client-s3) ──────────────
  // OPTIONAL để API vẫn boot khi storage chưa cấu hình (dev không docker). ObjectStorageService
  // fail-fast (StorageNotConfiguredError) KHI DÙNG nếu thiếu — KHÔNG fail-open (không tự bịa endpoint).
  // S3_FORCE_PATH_STYLE=true cho MinIO (bucket-in-path, không virtual-host). Default true.
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true"),
  // TTL (giây) cho presigned PUT/GET URL — ephemeral, KHÔNG persist. Default 5 phút.
  S3_PRESIGN_TTL_SEC: z.coerce.number().int().positive().max(3600).default(300),

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
