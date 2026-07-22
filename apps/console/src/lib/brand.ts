/**
 * Nhận diện thương hiệu — NGUỒN SỰ THẬT DUY NHẤT.
 *
 * Đổi tên / khẩu hiệu / slogan tại đây là đủ cho toàn app
 * (app-shell, trang chủ launcher, login, tiêu đề tab…). KHÔNG hard-code ở nơi khác.
 *
 * Logo-mark (quả cầu 4 màu) + wordmark gradient cầu vồng dựng bằng SVG ở
 * `src/components/brand/brand-mark.tsx`. Muốn dùng FILE ảnh thật pixel-perfect:
 * đặt file vào `public/brand/` rồi điền `logoSrc` / `markSrc` bên dưới.
 */
export const BRAND = {
  /** Tên hiển thị (góc trái app-shell + trang chủ). */
  name: "Funtime Media Corp",
  /** Tên rút gọn cho nơi hẹp (topbar mobile…). */
  shortName: "Funtime Media",
  /** Khẩu hiệu ngắn dưới tên ở trang chủ. */
  tagline: "Hệ điều hành doanh nghiệp",
  /** Slogan thương hiệu (login, footer). */
  slogan: "Better Videos · Better Life",
  /** Ký tự ngắn cho logo-mark fallback dạng chữ. */
  mark: "FMC",
  /** (Tùy chọn) URL ảnh logo đầy đủ trong public/. Trống = dùng SVG dựng sẵn. */
  logoSrc: "",
  /**
   * URL ảnh icon-mark gốc trong public/. Trống = dùng SVG dựng sẵn (brand-mark.tsx).
   *
   * S5-BRAND-FE-2: ĐẶT LẠI VỀ RỖNG. Giá trị cũ "/brand/logo-mark.png" trỏ file KHÔNG TỒN TẠI
   * (public/brand/ chưa từng có) ⇒ BrandMark render <img> gãy (icon ảnh vỡ) thay vì SVG dựng sẵn.
   * Muốn dùng ảnh thật: đặt file vào public/brand/ RỒI mới điền lại đường dẫn này.
   */
  markSrc: "",
} as const;

export type Brand = typeof BRAND;

/** Nhãn phụ kiểu mono ở hero "Phòng điều khiển" (Latin, stylized — không i18n). */
export const BRAND_SYSTEM_LABEL = "SYSTEM CONTROL PLANE";

/**
 * Phổ màu thương hiệu Funtime (teal → đỏ) — chữ ký "thanh tín hiệu on-air".
 * Cùng dải màu với .brand-gradient-* trong index.css (một nguồn ý niệm) và với apps/auth.
 */
export const BRAND_SPECTRUM = [
  "#16A085", // teal
  "#1FA9E0", // blue
  "#36A94E", // green
  "#F5B50C", // amber
  "#F0641E", // orange
  "#E8482E", // red
] as const;
