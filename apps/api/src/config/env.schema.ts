import { z } from "zod";

/**
 * Thứ tự file env — DÙNG CHUNG giữa preload (`config/load-env.ts`) và `ConfigModule.forRoot`
 * (`app.module.ts`) để KHÔNG lệch nguồn. File ĐỨNG TRƯỚC thắng (apps/api/.env override ../../.env),
 * khớp đúng precedence của @nestjs/config. Đường dẫn resolve theo `process.cwd()` (= apps/api khi chạy).
 */
export const ENV_FILE_PATHS = [".env", "../../.env"] as const;

/**
 * URL tuỳ chọn với luật "**biến RỖNG = CHƯA SET**" (`""` → `undefined`), thay vì đỏ
 * "Invalid environment variables".
 *
 * Vì sao cần (S6-SEC-DBFENCE-1 / KI-028): hàng rào test đặt `DATABASE_URL=""` một cách CỐ Ý để nói
 * "không có DB đích" — và để CHẶN `config/load-env.ts` nạp đè URL PROD từ `.env` (nó bỏ qua khoá đã
 * `in process.env`, nên phải là chuỗi rỗng chứ không phải khoá vắng mặt). Không có luật này thì
 * `z.string().url()` ném NGAY LÚC IMPORT (`src/db/index.ts` gọi `loadEnv()` ở top-level) ⇒ mọi spec
 * chạm chuỗi import đó đỏ ở bước collect, `describe.skipIf` không cứu được.
 *
 * Cũng vá một cái bẫy PROD có thật: một dòng `DATABASE_URL=` bỏ trống trong `.env` hiện làm API
 * sập lúc boot kèm thông điệp khó lần, thay vì hành xử như "chưa cấu hình".
 */
const optionalUrl = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url().optional(),
  );

/**
 * Secret TUỲ CHỌN có sàn độ dài, với cùng luật "**biến RỖNG = CHƯA SET**" của `optionalUrl()`.
 *
 * Vì sao cần (S10-FND-ENVKEY-1 — đo 13/08/2026, lỗi CÓ THẬT trên master trước WO này):
 * `load-env.ts` gán `process.env[key] = ""` cho một dòng `KEY=` bỏ trống (nó KHÔNG lọc rỗng). Mà
 * `.env.example` CỐ Ý ship giá trị rỗng cho mọi secret tắt-mềm. Ghép hai điều đó với
 * `z.string().min(32).optional()` thì `""` KHÔNG phải `undefined` ⇒ trượt `.min(32)` ⇒ `loadEnv()` NÉM
 * ⇒ **API không boot**. Nghĩa là `cp .env.example .env` — bước cài đặt lần đầu ghi ở CLAUDE.md §7 —
 * làm hỏng chính cái nó dựng lên. Đo bằng cách chạy `.env.example` qua `loadEnv`: ném ở
 * `LMS_SYNC_TOKEN` · `LMS_PROGRESS_TOKEN` · `LMS_NOTI_TOKEN`.
 *
 * Đây đúng lớp bẫy mà `optionalUrl()` phía trên được viết ra để chống — chỉ khác là nó chưa từng được
 * áp cho nhóm secret. `env-example-boots.spec.ts` khoá lại để không tái diễn.
 */
const optionalSecret = (minLength: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(minLength).optional(),
  );

/** UUID tuỳ chọn, cùng luật "RỖNG = CHƯA SET" (xem `optionalSecret`). `LMS_COMPANY_ID=` bỏ trống
 *  trong `.env.example` cũng nằm trong nhóm làm sập boot: `""` không phải uuid hợp lệ. */
const optionalUuid = () =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().uuid().optional(),
  );

/**
 * Validate biến môi trường tại biên hệ thống (coding-style: fail-fast, không tin dữ liệu ngoài).
 * DB URL để OPTIONAL → API vẫn boot khi DB chưa lên (health/db báo "down"), giúp `pnpm dev` chạy không cần docker.
 */
export const envSchema = z
  .object({
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
    DATABASE_URL: optionalUrl(),
    // DATABASE_DIRECT_URL → owner/superuser, direct (migration + DDL).
    DATABASE_DIRECT_URL: optionalUrl(),
    // DATABASE_WORKER_URL → mediaos_worker, direct (outbox worker, G2-4). Fallback: DIRECT_URL.
    DATABASE_WORKER_URL: optionalUrl(),
    // PGBOUNCER_URL → mediaos_app QUA PgBouncer transaction-mode (:6432). Chỉ dùng cho integration test
    // kiểm chứng tenant isolation giữ vững khi connection bị tái dùng qua pooler (GX-4, g2rls). App runtime
    // dùng DATABASE_URL (đã trỏ PgBouncer ở prod). Vắng ⇒ test pgbouncer tự skip (không đỏ giả).
    PGBOUNCER_URL: optionalUrl(),
    VALKEY_URL: optionalUrl(),
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
    // KI-029: kill-switch rollback khẩn của PermissionGuard. 'false' ⇒ guard fail-OPEN cho MỌI route đã
    // gate, chỉ để lại một dòng logger.warn. Trước 2026-07-28 biến này KHÔNG có ở đây lẫn .env.example ⇒
    // zod không validate và không ai biết nó tồn tại — một cửa hậu toàn hệ không nằm trong hồ sơ nào.
    // Khai ở đây để (a) sai giá trị là ĐỎ lúc boot thay vì im lặng, (b) nó hiện diện trong hồ sơ phát hành.
    // Đặt 'false' ở production bị CHẶN BOOT (xem superRefine) — muốn rollback khẩn ở prod thì phải hạ
    // NODE_ENV hoặc gỡ chốt có chủ đích, không thể lỡ tay. KHÔNG z.coerce.boolean ('false'→true bẫy).
    PERMISSION_GUARD_ENABLED: z.enum(["true", "false"]).default("true"),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCKOUT_SEC: z.coerce.number().int().positive().default(900), // khoá tạm 15 phút
    // Bucket THEO TÀI KHOẢN (company|email, mọi IP) — bắt credential-stuffing phân tán nhiều IP lên 1 account.
    // Ngưỡng cao hơn per-IP (mặc định 20) để giảm rủi ro account-lockout DoS; vẫn là backstop, không thay per-IP.
    LOGIN_ACCOUNT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(20),
    // ── S10-AUTH-STEPUP-1: xác thực lại (step-up) — DECISIONS-09 §6 điểm (1) và (9) ────────────
    // CẢ HAI biến đều có `.default()` LẪN `.max()`, cố ý:
    //  · `.default()` vì biến MỚI không mặc định từng giết fixture int-spec — lỗi nổi ở file KHÁC hẳn
    //    dòng khai (env-schema-floor-breaks-test-fixtures), rất tốn giờ để lần ra;
    //  · `.max()` vì mặc định an toàn KHÔNG chặn được cấu hình sai: `.positive()` một mình cho phép
    //    STEP_UP_TTL_SEC=86400 (cửa sổ xác thực lại sống cả ngày = xoá sạch ý nghĩa của step-up) và
    //    STEP_UP_MAX_ATTEMPTS=10000 (biến chính endpoint này thành oracle brute-force TOTP 6 số).
    // TTL 300s = 5 phút: đủ cho một thao tác đọc/ghi dữ liệu nhạy cảm, ngắn hơn nhiều so với phiên.
    // Cửa sổ DÙNG LẠI ĐƯỢC trong TTL nhưng TTL TUYỆT ĐỐI — đường ĐỌC không gia hạn (§6 điểm 6).
    STEP_UP_TTL_SEC: z.coerce.number().int().positive().max(1800).default(300),
    // Số lần gõ sai TOTP trước khi khoá bucket `rl:{envScope}:stepup:{companyId}|{userId}`. Thời gian
    // khoá dùng lại `LOGIN_LOCKOUT_SEC` (LoginRateLimiter nhận `maxAttempts` theo tham số, lockout lấy
    // từ env chung) ⇒ KHÔNG đẻ thêm biến thứ ba cho cùng một khái niệm.
    STEP_UP_MAX_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),

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
    // S2-AUTH-BE-4: URL trang đặt lại mật khẩu (user mở từ email forgot-password). Link = `${URL}?token=<token>`.
    // RỖNG (default) → ResetPasswordMailService no-op (sent:false). KHÔNG ép URL hợp lệ ở đây (dev linh hoạt).
    RESET_PASSWORD_URL: z.string().default(""),

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

    // ── S3-FND-SEEDRUN-1 (runtime per-company master-data seed) ───────────────
    // Khi BẬT, MasterDataSeedBootstrapService (OnApplicationBootstrap) chạy reconcileAllCompanies(): mỗi
    // company × mỗi module-seeder đã đăng ký (ATT/LEAVE/HR) seed master-data (default shift/rule, leave types…)
    // — KHÔNG làm được ở migrate-time (clean DB có 0 company; convention 0445/0008 cấm seed company-scoped).
    // Idempotent (startBatch + markItem dedup) ⇒ chạy mỗi boot vô hại. Default 'true' (BẬT ở dev/prod). KHÔNG
    // z.coerce.boolean ('false'→true bẫy). LƯU Ý: còn TỰ TẮT khi NODE_ENV==='test' (spec gọi runner trực tiếp,
    // tránh đua/nhiễu). Đặt 'false' = emergency rollback (KHÔNG seed lúc boot; gọi reconcile tay nếu cần).
    MASTER_DATA_SEED_ON_BOOT: z.enum(["true", "false"]).default("true"),

    // ── KMS / Envelope encryption (G6-2, plan §6d) ────────────────────────────
    // KMS_PROVIDER chọn DI provider: 'local' (dev, KEK 32B từ file .secrets/) | 'vault' (prod, Vault transit).
    // Default 'local' để app vẫn boot/test mà KHÔNG cần Vault (KEK đọc lazy → fail-fast lúc dùng nếu thiếu file).
    KMS_PROVIDER: z.enum(["local", "vault"]).default("local"),
    // Đường dẫn file KEK 32-byte (LocalKekProvider). ADR-0004 cấm KEK-in-env-host cho prod → chỉ dùng dev/test.
    KMS_LOCAL_KEK_PATH: z.string().min(1).default(".secrets/local-kek.bin"),
    // Vault transit — chỉ bắt buộc khi KMS_PROVIDER='vault' (xem superRefine bên dưới).
    KMS_VAULT_ADDR: optionalUrl(),
    KMS_VAULT_TOKEN: z.string().min(1).optional(),
    // ── Object storage / S3 (B4 task attachments — MinIO/R2 qua @aws-sdk/client-s3) ──────────────
    // OPTIONAL để API vẫn boot khi storage chưa cấu hình (dev không docker). ObjectStorageService
    // fail-fast (StorageNotConfiguredError) KHI DÙNG nếu thiếu — KHÔNG fail-open (không tự bịa endpoint).
    // S3_FORCE_PATH_STYLE=true cho MinIO (bucket-in-path, không virtual-host). Default true.
    S3_ENDPOINT: optionalUrl(),
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

    // ── Bootstrap default company (dựng-từ-trống tự động, S2-FND-SEED-3) ───────────────────────────────
    // Khi DB TRỐNG-sau-migrate (0 company), EnsureDefaultCompanyBootstrapService + SuperAdminBootstrapService
    // gọi hàm ensure_default_company (mig 0469, SECURITY DEFINER · idempotent · N=1 guard) tạo tenant-ROOT từ
    // các biến dưới đây → BỎ bước `psql` tay dựng company + restart (audit §4.2 / DB-10 §17.2). MỌI biến CÓ
    // DEFAULT ⇒ zero-config boot vẫn dựng được company mặc định.
    //
    // MAPPING param → cột `companies` (owner-chốt #4 — code CHECK THẮNG DB-10 §17.1):
    //   BOOTSTRAP_COMPANY_SLUG     → companies.slug     (citext, UNIQUE WHERE deleted_at IS NULL)
    //   BOOTSTRAP_COMPANY_NAME     → companies.name     (text)
    //   BOOTSTRAP_COMPANY_TIMEZONE → companies.timezone (KHÔNG CHECK; mig 0015 default 'Asia/Ho_Chi_Minh')
    //   BOOTSTRAP_COMPANY_LANGUAGE → companies.language (CHECK language IN ('vi','en') — mig 0015)
    //   BOOTSTRAP_COMPANY_CURRENCY → companies.currency (CHECK currency IN ('VND','USD') — mig 0015)
    //
    // ⚠️ LANGUAGE default 'vi' (KHÔNG 'vi-VN'): 'vi-VN' VI PHẠM companies_language_check ⇒ ensure_default_company
    //    ném lỗi CHECK, vỡ boot. Dùng z.enum(['vi','en']) để FAIL-FAST TẠI BIÊN (env sai → loadEnv throw NGAY,
    //    không để function chạm CHECK lúc runtime). CURRENCY z.enum(['VND','USD']) cùng lý do (companies_currency_check).
    //    Slug default 'demo' KHỚP PLATFORM_SUPERADMIN_COMPANY_SLUG default 'demo' ⇒ super-admin resolve trúng
    //    tenant vừa dựng (chuỗi bootstrap khép kín, single-boot).
    BOOTSTRAP_COMPANY_SLUG: z.string().min(1).default("demo"),
    BOOTSTRAP_COMPANY_NAME: z.string().min(1).default("Demo Company"),
    BOOTSTRAP_COMPANY_TIMEZONE: z.string().min(1).default("Asia/Ho_Chi_Minh"),
    BOOTSTRAP_COMPANY_LANGUAGE: z.enum(["vi", "en"]).default("vi"),
    BOOTSTRAP_COMPANY_CURRENCY: z.enum(["VND", "USD"]).default("VND"),

    // ── AI Insight (AI-1) — Claude API tóm tắt KPI + chi phí (read-only) ──────────────────────────────
    // ANTHROPIC_API_KEY: khoá Claude API. OPTIONAL để API vẫn boot khi AI chưa cấu hình (mirror DATABASE_URL).
    // AiClient fail-fast (ServiceUnavailable) KHI DÙNG nếu thiếu — KHÔNG fail-open gọi với key rỗng. BẤT BIẾN
    // #3: KHÔNG hardcode, KHÔNG commit giá trị thật vào .env.example (chỉ key rỗng), KHÔNG log key.
    ANTHROPIC_API_KEY: z.string().optional(),
    // AI_MODEL: chọn model mặc định từ allowlist (KHÔNG hậu tố ngày → 404). Default claude-opus-4-8.
    // claude-sonnet-4-6 = lựa chọn rẻ/nhanh hơn. Giá trị ngoài enum bị reject ở boundary (fail-fast cấu hình).
    AI_MODEL: z.enum(["claude-opus-4-8", "claude-sonnet-4-6"]).default("claude-opus-4-8"),

    // ── Route nội bộ máy-gọi-máy `/internal/v1/**` (InternalGuard) — KI-031 ──────────────────────────
    // Khoá mà bên gọi trình qua header `x-internal-key`. Ba nhóm route sống sau nó: recalculate chấm
    // công thủ công/retry (`attendance-internal.controller`), nạp lại cache dashboard
    // (`internal-dashboard-cache.controller`), và intake sự kiện NOTI (`internal-notifications.controller`).
    // Cả ba ĐÃ đứng sau chuỗi JwtAuthGuard→CompanyGuard→PermissionGuard; khoá này là lớp thứ hai.
    //
    // OPTIONAL là LỰA CHỌN, không phải bỏ sót — đừng "siết cho chặt" thành required: `InternalGuard` đã
    // fail-CLOSED khi biến vắng (403 mọi route `/internal/**`, xem `internal.guard.ts:23`). Ép required
    // chỉ đổi "mất một tính năng" thành "SẬP BOOT cả API" trên mọi máy dev/CI/lane chưa đặt biến — đắt
    // hơn hẳn thứ nó mua được. Cùng posture với LMS_NOTI_TOKEN / ANTHROPIC_API_KEY ngay dưới đây.
    //
    // ⚠️ Cái giá của posture đó: thiếu biến ⇒ 3 nhóm route trên chết 403 mà tín hiệu duy nhất là một dòng
    // warn lúc có request đầu tiên. Đo 13/08/2026: KHÔNG file .env nào trong repo đặt nó ⇒ ba nhóm route
    // đó đang tắt trên chính máy này. Khai ở đây để nó CÓ MẶT trong hồ sơ cấu hình — đúng lý do KI-029
    // buộc phải khai PERMISSION_GUARD_ENABLED: một biến không nằm trong hồ sơ nào là một biến không ai biết.
    //
    // `.min(32)`: khoá do CHÍNH TA sinh (khác CLOUDFLARE_TURN_* — khoá bên thứ ba, độ dài do họ quy định)
    // nên áp được sàn độ dài. An toàn với deployment hiện có vì chưa nơi nào đặt giá trị (đã đo).
    // `optionalSecret(32)` chứ không `z.string().min(32).optional()`: xem docblock helper — dòng
    // `INTERNAL_API_KEY=` bỏ trống trong `.env` phải đọc là CHƯA SET, không phải "khoá dài 0 ký tự".
    INTERNAL_API_KEY: optionalSecret(32),

    // ── Tích hợp LMS (fmc-app) — cầu SSO Giai đoạn A ─────────────────────────────────────────────────
    // Shared secret HMAC với LMS (MEDIAOS_SSO_SECRET phía LMS). OPTIONAL để API boot khi chưa cấu hình —
    // endpoint sso-link fail-fast 503 khi dùng (mirror ANTHROPIC_API_KEY). BẤT BIẾN #3: không hardcode/log.
    LMS_SSO_SECRET: optionalSecret(32),
    // Gốc public của LMS (vd https://lms.example.com) — đích redirect SSO.
    LMS_BASE_URL: optionalUrl(),
    // ── S5-LMS-BE-1: auto-sync tài khoản MediaOS→LMS (Giai đoạn B) ──
    // Bearer token server-to-server tới LMS POST /api/admin/sync-users (= MEDIAOS_SYNC_TOKEN phía LMS).
    // OPTIONAL: thiếu → bridge/job auto-sync TẮT (warn 1 lần, KHÔNG chặn boot; mirror posture SSO). BẤT BIẾN #3.
    LMS_SYNC_TOKEN: optionalSecret(32),
    // ── S5-LMS-BE-3: đọc tiến độ học MediaOS←LMS (GET /me/training) ──
    // Bearer token CHỈ-ĐỌC tới LMS GET /api/mediaos/progress (= MEDIAOS_PROGRESS_TOKEN phía LMS, xem
    // docs/plans/S5-LMS-APP-3.md §7.1). TÁCH BIỆT khỏi LMS_SYNC_TOKEN (quyền GHI: tạo/khoá tài khoản LMS) —
    // security review APP-3 HIGH-2: đường ĐỌC mở ra internet KHÔNG được mang quyền GHI, KHÔNG fallback.
    // OPTIONAL: thiếu → /me/training trả 503 (tắt mềm, không chặn boot). BẤT BIẾN #3: không hardcode/log.
    LMS_PROGRESS_TOKEN: optionalSecret(32),
    // COMPANY GATE: id công ty DUY NHẤT được sync sang LMS (LMS là hệ 1-công-ty = funtime; endpoint LMS
    // khoá thuần theo email, KHÔNG company-scope). Thiếu → auto-sync TẮT (fail-closed isolation). Producer/
    // bridge/job CHỈ sync khi companyId === LMS_COMPANY_ID ⇒ tenant khác KHÔNG rò email sang LMS (BẤT BIẾN #1).
    LMS_COMPANY_ID: optionalUuid(),
    // ── S5-LMS-NOTI-1: LMS→MediaOS đẩy thông báo học tập vào module NOTI (chiều NGƯỢC 3 token trên) ──
    // Bearer token mà LMS trình khi gọi POST /internal/v1/notifications/lms-events (= MEDIAOS_NOTI_TOKEN
    // phía LMS). TÁCH BIỆT khỏi LMS_SYNC_TOKEN/LMS_PROGRESS_TOKEN (đó là token MediaOS dùng để GỌI SANG
    // LMS; cái này là token LMS dùng để GỌI VÀO MediaOS — lộ một cái không được kéo theo cái kia).
    // OPTIONAL: thiếu → LmsServiceIntakeGuard trả 403 fail-closed (kênh TẮT, không chặn boot). BẤT BIẾN #3.
    // company_id của thông báo lấy từ LMS_COMPANY_ID ở trên — KHÔNG BAO GIỜ từ body request.
    LMS_NOTI_TOKEN: optionalSecret(32),

    // ── S9-SOCIAL-BE-1: app vệ tinh SOCIAL (fbpost — đăng bài Facebook Page), cầu SSO ────────────────
    // Shared secret HMAC với fbpost (= MEDIAOS_SSO_SECRET phía fbpost). OPTIONAL để API boot khi chưa
    // cấu hình — endpoint sso-link fail-fast 503 khi dùng (mirror posture LMS). BẤT BIẾN #3.
    // TÁCH BIỆT khỏi LMS_SSO_SECRET: lộ khoá của một app vệ tinh KHÔNG được kéo theo app còn lại.
    SOCIAL_SSO_SECRET: optionalSecret(32),
    // Gốc public của fbpost (vd https://social.example.com) — đích redirect SSO.
    SOCIAL_BASE_URL: optionalUrl(),
    // COMPANY GATE (DECISIONS-08 SOCIAL-DEC-002): id công ty DUY NHẤT được dùng fbpost. fbpost chạy
    // SQLite KHÔNG có company_id ⇒ BẤT BIẾN #1 được giữ Ở CẦU, không ở bảng: SocialSsoService chỉ mint
    // token khi companyId === SOCIAL_COMPANY_ID. Thiếu biến này → endpoint 503 (fail-closed), KHÔNG
    // phải "cho mọi công ty" — vắng cấu hình không bao giờ được nới thành cho phép.
    SOCIAL_COMPANY_ID: optionalUuid(),

    // ── S7-CALL-BE-1: cuộc gọi thoại/hình — máy chủ TURN (CHAT-API-029 · DECISIONS-07 §5) ───────────
    // Tài khoản **Cloudflare TURN** dùng chung với LMS: MediaOS KHÔNG tự dựng TURN server. Credential
    // gửi xuống client do SERVER sinh, hạn ngắn, dẫn xuất từ hai biến này — secret gốc KHÔNG BAO GIỜ
    // rời server, không vào DB, không vào DTO, KHÔNG vào log (BẤT BIẾN #3, xem `ChatCallIceService`).
    //
    // OPTIONAL — và đây là lựa chọn, không phải lười: thiếu cấu hình thì `GET /chat/calls/ice-config`
    // rơi về STUN công cộng chứ KHÔNG chặn boot. Cuộc gọi trong cùng LAN/VPN vẫn chạy; một biến môi
    // trường chưa đặt không được biến cả API thành không khởi động được.
    // ⚠️ KHÔNG có `.min(32)` như các shared-secret khác: đây là khoá do Cloudflare cấp, độ dài của họ
    // quy định — áp trần độ dài của mình lên khoá bên thứ ba là tự chặn một giá trị hợp lệ.
    CLOUDFLARE_TURN_KEY_ID: optionalSecret(1),
    CLOUDFLARE_TURN_API_TOKEN: optionalSecret(1),

    // ── S7-CALL-BE-FIX-1 (MEDIUM-3 vế TẦN SUẤT): trần số LỜI MỜI gọi / phút / người ──────────────────
    // Mỗi `POST /chat/rooms/:id/calls` ghi `1 + N` hàng APPEND-ONLY vào `chat_call_participants` (N =
    // thành viên đang hoạt động, đã cắt trần bởi `CHAT_CALL_MAX_INVITEES`) và bảng đó KHÔNG có job dọn.
    // `CHAT_CALL_MAX_INVITEES` chặn KÍCH THƯỚC một lần ghi; biến này chặn SỐ LẦN ghi. Thiếu vế thứ hai
    // thì một vòng lặp mời-huỷ-mời vẫn bơm được không giới hạn.
    //
    // CÓ env (khác `CHAT_CALL_MAX_INVITEES` là hằng cứng) vì đây là ngưỡng CHỐNG LẠM DỤNG, không phải
    // rule nghiệp vụ: mặc định phải chặt cho production, còn integration-test cần nới để 20+ lời mời của
    // một fixture-user không đụng trần (mirror `LOGIN_MAX_ATTEMPTS`). Đổi giá trị KHÔNG đổi hợp đồng API.
    // Ngưỡng 10 nằm rất trên nhịp thật (gọi lại sau 45s đổ chuông ≈ 1–2 lần/phút) và rất dưới nhịp máy.
    CHAT_CALL_INVITE_MAX_PER_MIN: z.coerce.number().int().positive().default(10),

    // ── S10-CHAT-CALLSWEEP-1 (KI-063): ngưỡng gặt cuộc gọi `active` mồ côi ───────────────────────────
    // HAI nhánh, HAI ngưỡng — cố ý không gộp (docs/plans/S10-CHAT-CALLSWEEP-1.md §2):
    //  · ORPHAN_GRACE: gặt khi mọi hàng participant đã mang kết cục HẤP THỤ (⇒ không ai còn trong cuộc
    //    gọi) **VÀ** cuộc gọi đã bắt đầu quá ngưỡng này.
    //    ⚠️ Neo là `chat_calls.started_at` — **TUỔI CUỘC GỌI**, KHÔNG phải "thời gian kể từ khi người
    //    cuối cùng ngã ngũ". Với một cuộc gọi đã nói chuyện lâu hơn ngưỡng, ân hạn thực tế bằng **0**:
    //    nhịp scheduler kế tiếp sau khi người cuối cùng ngã ngũ là gặt. Vô hại theo thiết kế hiện tại
    //    (bốn kết cục hấp thụ là CHUNG CUỘC, không có đường quay lại), nhưng đừng đọc biến này như một
    //    cửa sổ chờ-người-quay-lại. Muốn đúng nghĩa đó thì phải neo vào
    //    `MAX(coalesce(left_at, invited_at))` của bảng participants — thay đổi vị từ, không phải đổi số.
    //  · ACTIVE_MAX: trần thọ tuyệt đối. Lưới an toàn cho hình dạng KHÔNG đoán trước (nhánh `!ok` của
    //    closeCallParticipationOnRoomExit để lại một hàng "còn treo" vĩnh viễn ⇒ vị từ mồ côi im lặng).
    //
    // CẢ HAI có `.default()` LẪN `.max()`, cùng lý do đã viết ở khối STEP_UP_* bên trên:
    //  · `.default()` — biến MỚI không mặc định giết fixture int-spec ở một file KHÁC hẳn chỗ gán.
    //  · `.max()` — `.positive()` một mình cho phép `CHAT_CALL_ACTIVE_MAX_MS=999999999999`, tức TẮT LẶNG LẼ
    //    chính lưới an toàn này mà không có gì đỏ. Trần an toàn phải là thứ ép được, không phải quy ước.
    //
    // ⚠️ **CẢ HAI cũng có `.min()`, và đó là vế NGUY HIỂM HƠN `.max()`.** `.positive()` nhận `=1`:
    // `CHAT_CALL_ACTIVE_MAX_MS=1` cho một nhịp sau gặt **MỌI cuộc gọi đang nói chuyện** và ghi kết cục
    // HẤP THỤ vào `chat_call_participants` — bảng KHÔNG có `DELETE` grant (BẤT BIẾN #2) ⇒ **không hoàn
    // tác được**. `.max()` chỉ tắt lưới an toàn; `.min()` chặn một cấu hình rác PHÁ DỮ LIỆU.
    // Sàn cố ý nằm DƯỚI mọi giá trị fixture đang dùng (int-spec sweep: 60_000 / 3_600_000;
    // env.schema.spec: 45_000) — memory `env-schema-floor-breaks-test-fixtures`.
    CHAT_CALL_ORPHAN_GRACE_MS: z.coerce.number().int().min(30_000).max(3_600_000).default(120_000),
    CHAT_CALL_ACTIVE_MAX_MS: z.coerce
      .number()
      .int()
      .min(600_000)
      .max(86_400_000)
      .default(43_200_000),

    // ⚠️ ALLOW_SUPERUSER_ROTATION (KHÔNG validate qua zod — CỐ Ý): SecretRotationService đọc THẲNG
    // `process.env.ALLOW_SUPERUSER_ROTATION === 'true'` để fail-closed tuyệt đối (mọi giá trị ≠ 'true', kể cả
    // unset → CHẶN rotation bằng role BYPASS RLS). Không dùng z.coerce.boolean() vì nó coi 'false' → true (bẫy).
    // Chỉ bật ở harness test seed/teardown bằng superuser; KHÔNG đặt ở staging/prod.
  })
  .superRefine((env, ctx) => {
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
    // KI-029 — fail-LOUD: tắt PermissionGuard ở production là mở toang mọi route đã gate. Nếu điều đó
    // xảy ra thì nó phải DỪNG BOOT, không phải chạy tiếp với một dòng warn lẫn trong log. Chốt này chỉ
    // ràng ở production: dev/test vẫn tắt được (reviewer dùng chính cờ này để tái lập vế RED của gate).
    if (env.NODE_ENV === "production" && env.PERMISSION_GUARD_ENABLED === "false") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PERMISSION_GUARD_ENABLED"],
        message:
          "KHÔNG được đặt 'false' khi NODE_ENV=production — tắt PermissionGuard làm mọi route đã gate fail-OPEN cho mọi user đã đăng nhập",
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
