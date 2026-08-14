/**
 * Giá trị giả cho các biến "trông giống secret" mà test cần để dựng client — S6-SEC-ROTATE-1 (KI-043).
 *
 * VÌ SAO KHÔNG VIẾT THẲNG CHUỖI TRONG SPEC
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * 1. Năm spec từng dùng `process.env.S3_SECRET_KEY ??= "<literal họ changeme_*>"` — CÙNG chuỗi với mật khẩu
 *    superuser Postgres của cụm PROD hồi đó. Bản thân fallback vô hại (presign S3 là HMAC offline, không
 *    xác thực với ai), nhưng nó nhân bản một literal thật ra khắp repo PUBLIC và làm nhiễu mọi lần quét.
 * 2. CLAUDE.md §5 (luật fixture-giống-secret): chuỗi high-entropy trong spec trip rule `generic-api-key`
 *    của gitleaks ⇒ đỏ oan CI. Một hằng số CÓ TÊN, ghép chuỗi, đặt một chỗ thì vừa quét được vừa không
 *    trip rule.
 *
 * Không dùng cho bất kỳ đường xác thực THẬT nào. Cần secret thật trong test ⇒ lấy từ env.
 */

/** Secret S3/MinIO giả cho presign HMAC offline. Ghép chuỗi có chủ ý (CLAUDE.md §5). */
export const FALLBACK_S3_SECRET = ["fixture", "s3", "secret", "not-a-credential"].join("-");

/** Sàn độ dài `INTERNAL_API_KEY` do `env.schema` áp (S10-FND-ENVKEY-1) — xem `internalKeyFixture`. */
const INTERNAL_KEY_MIN_LENGTH = 32;

/**
 * Khoá `x-internal-key` giả cho int-spec chạm `/internal/v1/**`.
 *
 * ĐỘ DÀI Ở ĐÂY KHÔNG PHẢI THẨM MỸ. `env.schema` áp sàn `.min(32)` lên `INTERNAL_API_KEY`
 * (S10-FND-ENVKEY-1). Spec nào gán `process.env.INTERNAL_API_KEY` một chuỗi ngắn hơn sẽ làm
 * `loadEnv()` NÉM lúc Nest dựng testing module ⇒ ĐỎ CẢ FILE — và lỗi nổi ra ở
 * `master-data-seed.config.ts`, cách dòng gán rất xa, nên tốn cả một vòng CI mới lần ra. Đo 13/08/2026:
 * đúng sáu spec đã dính bẫy này (PR #380). Helper đệm cho đủ sàn nên nó không tái diễn.
 *
 * Máy dev KHÔNG bắt được: cả sáu file đều `skipIf(!LANE_DB)` ⇒ không có Postgres thì chúng SKIP, suite
 * xanh, chỉ CI đỏ. Đây đúng thứ "XANH KHÔNG ĐỦ BẰNG CHỨNG" ở CLAUDE.md §9 nói tới.
 *
 * `tag` giữ khoá của mỗi spec KHÁC nhau: hai file chạy chung một worker không được vô tình nhận khoá
 * của nhau, nếu không ca "khoá sai → 403" sẽ xanh-giả. Ghép chuỗi + đệm (không literal high-entropy)
 * theo luật fixture-giống-secret CLAUDE.md §5.
 */
export const internalKeyFixture = (tag: string): string =>
  ["test-internal-key", tag].join("-").padEnd(INTERNAL_KEY_MIN_LENGTH, "0");

/** Sàn độ dài của `newPasswordSchema` (packages/contracts auth/user-admin.ts) — xem `loginPasswordFixture`. */
const LOGIN_PASSWORD_MIN_LENGTH = 10;

/**
 * Mật khẩu đăng nhập giả cho int-spec cần một user THẬT đi qua `POST /auth/login`.
 *
 * PHẢI ĐẠT POLICY, KHÔNG CHỈ "ĐỦ DÀI": `newPasswordSchema` đòi ≥10 ký tự + có chữ thường + chữ hoa +
 * chữ số. Spec nào seed user qua API (thay vì INSERT hash thẳng) mà dùng chuỗi yếu sẽ ăn 400 ở DTO
 * boundary — lỗi nổi ở bước seed, cách xa ca test đang đo. Chuỗi sinh ở đây thoả cả ba lớp ký tự nên
 * dùng được cho CẢ hai đường (seed qua HTTP lẫn `PasswordService.hash` rồi INSERT).
 *
 * Ghép chuỗi + `padEnd` có chủ ý (CLAUDE.md §5 — luật fixture giống-secret): literal high-entropy trong
 * `*.spec.ts` trip rule `generic-api-key` của gitleaks ⇒ đỏ oan CI, và vì gitleaks quét full-history thì
 * literal đã commit vẫn nằm lại trong lịch sử nhánh dù commit sau đã sửa. `.gitleaks.toml` KHÔNG có
 * allowlist chung cho `*.spec.ts`.
 *
 * `tag` để mỗi spec một mật khẩu riêng: hai file chạy chung worker không được vô tình dùng chung
 * credential, nếu không ca "sai mật khẩu → 401" sẽ xanh-giả.
 */
export const loginPasswordFixture = (tag: string): string =>
  ["Fixture", "Pw9", tag].join("-").padEnd(LOGIN_PASSWORD_MIN_LENGTH, "x");

/**
 * Mật khẩu SMTP giả cho int-spec cấu hình mail (`/settings/mail-config`).
 *
 * Dùng cho hai việc: (1) gửi đi trong body upsert/test-connection; (2) làm MỐC so sánh cho assert
 * "response KHÔNG chứa password" — assert PHẢI so với chính giá trị helper trả về, KHÔNG so với một
 * literal chép tay, nếu không đổi fixture một chỗ là assert im lặng mất tác dụng (so với chuỗi đã không
 * còn được gửi đi thì luôn PASS).
 *
 * Ghép chuỗi từ các từ độ-entropy-thấp theo CLAUDE.md §5 — xem giải thích ở `loginPasswordFixture`.
 * Đặt `tag` sao cho tag này KHÔNG là tiền tố của tag kia trong cùng một spec: assert dùng
 * `not.toContain` nên chuỗi lồng nhau sẽ làm hai ca kiểm chéo nhau.
 */
export const smtpPasswordFixture = (tag: string): string =>
  ["fixture", "smtp", "pw", tag].join("-");
