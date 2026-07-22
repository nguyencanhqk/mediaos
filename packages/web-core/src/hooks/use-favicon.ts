import { useEffect } from "react";

/**
 * S5-BRAND-FE-2 — đặt favicon ĐỘNG theo thương hiệu công ty.
 *
 * CỐ Ý KHÔNG tự fetch: hook nhận sẵn `url` và CHỈ lo phần DOM (`<link rel="icon">`). Lý do — web-core
 * KHÔNG có `@tanstack/react-query` trong dependencies, và thêm vào chỉ vì hook này sẽ nới hợp đồng của cả
 * package. App nào cũng đã có react-query nên tự truyền URL vào là đủ, và hook vẫn dùng chung được
 * (apps/app + apps/console).
 *
 * FAIL-SOFT: `url` null/undefined/rỗng ⇒ KHÔI PHỤC favicon tĩnh ban đầu (/favicon.svg trong index.html),
 * KHÔNG xoá trắng thẻ link — công ty chưa đặt favicon vẫn phải có icon, không để tab trống.
 *
 * URL presigned có TTL ngắn: ảnh đã tải vào tab thì trình duyệt giữ, hết hạn chỉ ảnh hưởng lần refetch sau
 * (query refetch sẽ cấp URL tươi). Chấp nhận — favicon không đáng để giữ kết nối làm mới liên tục.
 */
export function useFavicon(url: string | null | undefined): void {
  useEffect(() => {
    if (typeof document === "undefined") return; // SSR/test node — no-op

    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return; // index.html không khai favicon → không tự chế thẻ mới

    // Ghi nhớ href TĨNH ban đầu MỘT LẦN để khôi phục khi gỡ favicon (hoặc unmount).
    const staticHref = link.dataset.staticHref ?? link.href;
    if (link.dataset.staticHref === undefined) link.dataset.staticHref = staticHref;

    const staticType = link.dataset.staticType ?? link.type;
    if (link.dataset.staticType === undefined) link.dataset.staticType = staticType;

    if (url) {
      link.href = url;
      // Favicon động là ảnh raster (png/webp — allowlist branding). Bỏ type="image/svg+xml" của thẻ tĩnh,
      // để nguyên sẽ khai SAI kiểu và một số trình duyệt bỏ qua icon.
      link.removeAttribute("type");
    } else {
      link.href = staticHref;
      if (staticType) link.type = staticType;
    }

    return () => {
      // Khôi phục khi unmount (vd đăng xuất → shell tháo) để không giữ URL presigned đã chết.
      link.href = staticHref;
      if (staticType) link.type = staticType;
    };
  }, [url]);
}
