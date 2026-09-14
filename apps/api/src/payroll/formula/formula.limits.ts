/**
 * S15-PAYROLL-BE-2 — trần của máy công thức (SPEC-11 §13.6 B · C). Mỗi con số có PHÉP TỰ-KIỂM ngay cạnh
 * nó: đầu vào TỆ NHẤT CÒN HỢP LỆ phải ≤ trần (`security-cap-can-be-mathematically-impossible`).
 */

// ── B. Giới hạn TĨNH — ép lúc LƯU (⇒ PAYROLL-ERR-018) ──────────────────────────────────────────────

/**
 * Ký tự. Công thức thật dài nhất trong benchmark ~180 ⇒ gấp ~2,7. Zod KHÔNG cap độ dài (cap bằng nhau ở
 * Zod ⇒ 400 nuốt 422 `formula-too-long` — `equal-caps-at-zod-and-service-make-dead-error-code`); CHECK
 * `…_formula_len_check ≤ 500` ở DB là lưới CUỐI, không phải cổng đầu.
 */
export const FORMULA_MAX_LENGTH = 500;
/** Độ sâu AST — chặn đệ quy ngoặc làm tràn stack parser TRƯỚC khi tới evaluator. */
export const FORMULA_MAX_DEPTH = 20;
/** Số node AST của MỘT công thức. */
export const FORMULA_MAX_NODES = 200;
/** Số thành phần trong MỘT mẫu. */
export const TEMPLATE_MAX_COMPONENTS = 120;

// ── C. Ngân sách ĐỘNG — ép lúc TÍNH (⇒ PAYROLL-ERR-020), đếm LƯỢT THĂM NODE, KHÔNG đồng hồ ─────────────

/**
 * Mỗi LƯỢT chạy đồ thị.
 * Tự-kiểm: mẫu đầy `TEMPLATE_MAX_COMPONENTS × FORMULA_MAX_NODES = 120 × 200 = 24.000 ≤ 25.000` ✓
 * (nút aggregate tốn `1 + số hạng ≤ 121` mỗi nút × 4 = 484 — vẫn nằm trong biên 1.000).
 */
export const BUDGET_PER_PASS = 25_000;

/**
 * Tổng một DÒNG lương = 30 vòng gross-up + 1 lượt cuối (§13.8).
 * Tự-kiểm: `25.000 × 31 = 775.000` và mẫu đầy `24.000 × 31 = 744.000 ≤ 775.000` ✓.
 * 🔴 KHÔNG gộp hai trần làm một: trần chung 25.000 cho cả 31 lượt làm MỌI hồ sơ NET vượt từ vòng 2
 * ⇒ PAY-DEC-015 bất khả thi về toán học mà mọi ca âm vẫn xanh.
 */
export const BUDGET_PER_LINE = 775_000;
