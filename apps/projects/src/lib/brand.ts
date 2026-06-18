/**
 * Nhận diện thương hiệu — NGUỒN SỰ THẬT DUY NHẤT.
 *
 * Đổi tên / khẩu hiệu / slogan tại đây là đủ cho toàn app
 * (app-shell, trang chủ launcher, tiêu đề tab…). KHÔNG hard-code ở nơi khác.
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
  /** URL ảnh icon-mark gốc trong public/. Trống = dùng SVG dựng sẵn (app Dự án chưa nhúng file ảnh). */
  markSrc: "",
} as const;

export type Brand = typeof BRAND;
