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
