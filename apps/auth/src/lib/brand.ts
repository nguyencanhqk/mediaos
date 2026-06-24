/**
 * Hằng số nhận diện Funtime cho trang đăng nhập — hướng "Phòng điều khiển".
 * Đặt riêng khỏi config.ts (env) vì đây là hằng số THỊ GIÁC, không phải cấu hình build.
 */

/** Wordmark in hero (danh từ riêng — không i18n). */
export const BRAND_WORDMARK = "FUNTIME";

/** Nhãn phụ kiểu mono dưới wordmark (Latin, stylized — không i18n). */
export const BRAND_SYSTEM_LABEL = "MEDIA OPERATING SYSTEM";

/**
 * Phổ màu thương hiệu Funtime (teal → đỏ). Chữ ký của trang: thanh "tín hiệu on-air".
 * Cùng dải màu với .brand-gradient-* trong index.css — giữ một nguồn ý niệm.
 */
export const BRAND_SPECTRUM = [
  "#16A085", // teal
  "#1FA9E0", // blue
  "#36A94E", // green
  "#F5B50C", // amber
  "#F0641E", // orange
  "#E8482E", // red
] as const;
