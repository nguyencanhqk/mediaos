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
  // CS-9: nguồn `req.ip` cho IP-allowlist (security policy). Express `trust proxy` MẶC ĐỊNH "false"
  // → req.ip = socket peer, KHÔNG đọc X-Forwarded-For (chống giả mạo XFF ở dev/no-proxy). Sau reverse
  // proxy/LB, ops PHẢI đặt số hop tin cậy (vd "1") hoặc CIDR proxy (vd "10.0.0.0/8") — nếu không
  // IP-allowlist hoặc vỡ (mọi request = IP proxy) hoặc bị spoof. Giá trị: "false" | số hop | preset/CIDR.
  TRUST_PROXY: z.string().default("false"),
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
  // CS-9: kill-switch CỨNG cho enforcement chính sách bảo mật per-company (IP/giờ/email-domain + nhánh
  // 2FA-override đọc DB). Default 'true' (BẬT). Đặt 'false' ⇒ BỎ QUA toàn bộ enforce CS-9 mà KHÔNG đọc DB
  // (chống tự-khoá admin khi policy lỗi/parse sai — rollback tức thì, không cần revert). KHÔNG z.coerce.boolean
  // ('false'→true bẫy). LƯU Ý: tắt cờ này KHÔNG hạ sàn 2FA global (TWO_FACTOR_ENFORCEMENT_ENABLED độc lập).
  SECURITY_POLICY_ENFORCEMENT_ENABLED: z.enum(["true", "false"]).default("true"),
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
  // CS-10: URL trang kích hoạt tài khoản (người được mời mở từ email). Link = `${URL}?company=<slug>&token=<token>`.
  // RỖNG (default) → KHÔNG gửi được email (invite trả emailSent:false; admin cần cấu hình). KHÔNG ép URL hợp lệ
  // ở đây để dev linh hoạt (vd `https://auth.localhost/activate`); service tự bỏ qua nếu rỗng.
  INVITE_ACTIVATION_URL: z.string().default(""),

  // ── G16-3 SaaS enforcement (feature-flag / usage-limit guards) ────────────
  // Kill-switch toàn cục cho FeatureFlagEnforcementGuard + UsageLimitEnforcementGuard. Default 'true'
  // (BẬT). Guard CHỈ áp khi route khai @RequireFeature/@EnforceUsageLimit (no-op nếu không) ⇒ default
  // bật KHÔNG ảnh hưởng route hiện có. Đặt 'false' để tắt hẳn enforcement (emergency rollback). KHÔNG
  // z.coerce.boolean ('false'→true bẫy).
  SAAS_ENFORCEMENT_ENABLED: z.enum(["true", "false"]).default("true"),

  // ── Background worker scheduler (WAVE 4 OPS — gọi processBatch định kỳ) ────
  // Hai worker (OutboxWorker, DbExportWorker) là one-shot `processBatch()`; cần ai đó gọi định kỳ ở prod.
  // WorkerSchedulerService đăng ký 2 interval ĐỘC LẬP gọi processBatch của mỗi worker.
  // WORKERS_SCHEDULER_ENABLED: kill-switch. Default 'true' (BẬT ở dev/prod). KHÔNG z.coerce.boolean
  // ('false'→true bẫy). LƯU Ý: scheduler còn TỰ TẮT khi NODE_ENV==='test' (belt-and-suspenders) — spec
  // worker gọi processBatch trực tiếp nên scheduler KHÔNG được tự tick trong vitest (đua/nhiễu test).
  WORKERS_SCHEDULER_ENABLED: z.enum(["true", "false"]).default("true"),
  // Chu kỳ poll (ms). Cận [250ms, 1h]: chặn footgun cấu hình (vd 1ms → hammer DB) + chặn poll quá thưa
  // làm job kẹt lâu. Mặc định 5s (outbox, độ trễ giao event) / 10s (export, ít gấp hơn → thưa hơn).
  OUTBOX_POLL_MS: z.coerce.number().int().min(250).max(3_600_000).default(5000),
  EXPORT_POLL_MS: z.coerce.number().int().min(250).max(3_600_000).default(10000),

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

  // ── Platform operator bootstrap (god-mode chéo tenant, seed-lúc-khởi-động) ─────────────────────────
  // Khi PLATFORM_OPERATOR_EMAIL được set, OperatorBootstrapService (OnApplicationBootstrap) sẽ UPSERT user
  // này + gán role hệ thống `platform-admin` (…f0) trong công ty PLATFORM_OPERATOR_COMPANY_SLUG → login phát
  // aud='operator' (AC-0b). KHÔNG đụng engine phân quyền (chỉ seed DATA, BẤT BIẾN giữ nguyên). Idempotent.
  // VẮNG → no-op (không tạo gì). Đổi email → boot lại trỏ tài khoản MỚI; KHÔNG tự thu hồi operator cũ
  // (an toàn: không hạ quyền chéo tenant âm thầm lúc boot — gỡ qua RBAC nếu muốn).
  PLATFORM_OPERATOR_EMAIL: z.string().email().optional(),
  // Mật khẩu khởi tạo/cập nhật cho operator (argon2id-hash phía app, KHÔNG bao giờ log — BẤT BIẾN #3).
  // BẮT BUỘC khi có PLATFORM_OPERATOR_EMAIL (ép ở superRefine). Tối thiểu 12 ký tự (tài khoản quyền cao).
  PLATFORM_OPERATOR_PASSWORD: z.string().min(12).optional(),
  // Tên hiển thị operator. Default "Platform Operator".
  PLATFORM_OPERATOR_NAME: z.string().min(1).default("Platform Operator"),
  // Slug công ty "nhà" của operator (users.company_id — login theo companySlug). Công ty PHẢI tồn tại &
  // active TRƯỚC khi seed (seeder KHÔNG tạo công ty). Default "demo".
  PLATFORM_OPERATOR_COMPANY_SLUG: z.string().min(1).default("demo"),

  // ── Super-admin sản phẩm (aud='tenant', FULL mọi quyền TRONG 1 công ty, seed-lúc-khởi-động) ─────────
  // KHÁC operator ở trên: operator = control-plane chéo tenant (aud='operator', CHỈ route @OperatorOnly).
  // Super-admin = NGƯỜI DÙNG THƯỜNG (aud='tenant') giữ role COMPANY-SCOPED chứa TOÀN BỘ catalog quyền →
  // đăng nhập app sản phẩm (web/studio/people) làm được MỌI nghiệp vụ trong công ty đó. Khi
  // PLATFORM_SUPERADMIN_EMAIL được set, SuperAdminBootstrapService (OnApplicationBootstrap) UPSERT user +
  // tạo/đồng bộ role `super-admin` (company-scoped) + grant TẤT CẢ quyền catalog (idempotent, tự phủ quyền
  // module mới mỗi boot) + gán role cho user. Role company-scoped nên RLS WITH CHECK cho ghi runtime —
  // KHÔNG cần migration, KHÔNG escape-hatch. KHÔNG đụng engine phân quyền (chỉ seed DATA). VẮNG → no-op.
  // ⚠️ TRẦN: reveal-secret:platform-account (lộ mật khẩu kênh) vẫn CHỈ qua break-glass per-object (ADR-0010)
  // — không role-grant nào với tới, CỐ Ý. 2FA: role này requires_two_factor=false (tiện dùng); bật ở prod nếu cần.
  PLATFORM_SUPERADMIN_EMAIL: z.string().email().optional(),
  // Mật khẩu khởi tạo/cập nhật cho super-admin (argon2id-hash phía app, KHÔNG bao giờ log — BẤT BIẾN #3).
  // BẮT BUỘC khi có PLATFORM_SUPERADMIN_EMAIL (ép ở superRefine). Tối thiểu 12 ký tự (tài khoản quyền cao).
  PLATFORM_SUPERADMIN_PASSWORD: z.string().min(12).optional(),
  // Tên hiển thị super-admin. Default "Super Admin".
  PLATFORM_SUPERADMIN_NAME: z.string().min(1).default("Super Admin"),
  // Slug công ty của super-admin. Công ty PHẢI tồn tại & active TRƯỚC khi seed. Default "demo".
  PLATFORM_SUPERADMIN_COMPANY_SLUG: z.string().min(1).default("demo"),

  // ── AI Insight (AI-1) — Claude API tóm tắt KPI + chi phí (read-only) ──────────────────────────────
  // ANTHROPIC_API_KEY: khoá Claude API. OPTIONAL để API vẫn boot khi AI chưa cấu hình (mirror DATABASE_URL).
  // AiClient fail-fast (ServiceUnavailable) KHI DÙNG nếu thiếu — KHÔNG fail-open gọi với key rỗng. BẤT BIẾN
  // #3: KHÔNG hardcode, KHÔNG commit giá trị thật vào .env.example (chỉ key rỗng), KHÔNG log key.
  ANTHROPIC_API_KEY: z.string().optional(),
  // AI_MODEL: chọn model mặc định từ allowlist (KHÔNG hậu tố ngày → 404). Default claude-opus-4-8.
  // claude-sonnet-4-6 = lựa chọn rẻ/nhanh hơn. Giá trị ngoài enum bị reject ở boundary (fail-fast cấu hình).
  AI_MODEL: z.enum(["claude-opus-4-8", "claude-sonnet-4-6"]).default("claude-opus-4-8"),

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
  // Fail-fast: bật operator-bootstrap (có EMAIL) thì PHẢI có PASSWORD (không seed god-mode account
  // không mật khẩu / khoá ngầm). Double-guard ở service cũng skip nếu thiếu.
  if (env.PLATFORM_OPERATOR_EMAIL && !env.PLATFORM_OPERATOR_PASSWORD) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PLATFORM_OPERATOR_PASSWORD"],
      message: "bắt buộc khi PLATFORM_OPERATOR_EMAIL được set",
    });
  }
  // Fail-fast: bật super-admin (có EMAIL) thì PHẢI có PASSWORD (mirror operator — không seed full-quyền
  // không mật khẩu). Double-guard ở service cũng skip nếu thiếu.
  if (env.PLATFORM_SUPERADMIN_EMAIL && !env.PLATFORM_SUPERADMIN_PASSWORD) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PLATFORM_SUPERADMIN_PASSWORD"],
      message: "bắt buộc khi PLATFORM_SUPERADMIN_EMAIL được set",
    });
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
