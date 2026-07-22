import { useState } from "react";
import { useBrandingQuery } from "@/hooks/use-branding";

/** Wordmark mặc định — fallback khi công ty chưa đặt logo, đang tải, hoặc ảnh lỗi. */
const WORDMARK = "FUNTIME MEDIA";

/**
 * S5-BRAND-FE-2 — logo công ty trên GlobalTopbar.
 *
 * FAIL-SOFT TUYỆT ĐỐI (vỏ app phải render được trong mọi tình huống):
 *   - chưa tải xong / lỗi / 401 / chưa đặt logo → wordmark, KHÔNG spinner (topbar nhấp nháy mỗi lần tải
 *     trang khó chịu hơn nhiều so với việc thấy wordmark thêm 200ms);
 *   - ảnh 404 / presigned hết hạn giữa chừng → `onError` lật về wordmark thay vì để icon ảnh vỡ.
 *
 * KHÔNG GIẬT LAYOUT: khung cố định `h-7` + `max-w-[160px]`, ảnh `object-contain` — logo cao/thấp bất kỳ
 * đều nằm gọn, chiều cao topbar không đổi giữa lúc chưa tải và sau khi tải.
 *
 * Logo hiển thị trên nền chrome navy (hằng số #0F172A — memory fe-theme-light-dark-system) ở CẢ 2 theme,
 * nên không cần biến thể sáng/tối.
 */
export function BrandLogo() {
  const { data } = useBrandingQuery();
  // Lưu URL ĐÃ HỎNG (không phải cờ boolean): cờ boolean sẽ kẹt `true` sau một lần lỗi ⇒ logo MỚI (URL
  // presigned tươi sau refetch, hoặc admin vừa đổi ảnh) không bao giờ được thử lại.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const logoUrl = data?.logo?.url ?? null;
  const showImage = logoUrl !== null && logoUrl !== failedUrl;

  if (!showImage) {
    return <span className="brand-gradient-text font-display text-base font-bold">{WORDMARK}</span>;
  }

  return (
    <img
      src={logoUrl}
      alt={WORDMARK}
      className="h-7 max-w-[160px] object-contain"
      onError={() => setFailedUrl(logoUrl)}
    />
  );
}
