/**
 * Giá trị giả cho các biến "trông giống secret" mà test cần để dựng client — S6-SEC-ROTATE-1 (KI-043).
 *
 * VÌ SAO KHÔNG VIẾT THẲNG CHUỖI TRONG SPEC
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * 1. Năm spec từng dùng `process.env.S3_SECRET_KEY ??= "changeme_dev_only"` — CÙNG chuỗi với mật khẩu
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
