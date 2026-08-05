/**
 * S7-CHAT-FE-3 — màn hình có đủ chỗ cho panel nổi hay không.
 *
 * `ChatDock` ẩn dưới breakpoint `md` (cửa sổ 320px × 26rem không nằm vừa màn hình điện thoại; ở đó lối vào là
 * trang `/chat` full-screen). Nhưng CSS chỉ giấu phần NHÌN THẤY — `ChatBadge` vẫn sẽ gọi `openRoom()` và
 * người dùng trên điện thoại bấm một phòng rồi **không thấy gì xảy ra**. Đó là nút chết, đúng loại lỗi
 * "UI hứa nhưng đường dưới không đọc". Vì thế hành vi và hiển thị phải đọc CÙNG một sự thật.
 */
import { useEffect, useState } from "react";

/** Khớp breakpoint `md` của Tailwind — cùng ngưỡng với `hidden md:flex` trên container của `ChatDock`. */
export const DOCK_VIEWPORT_QUERY = "(min-width: 768px)";

function evaluate(): boolean {
  // Fail-soft giống `resolveSystemTheme` (web-core/lib/theme.ts): môi trường không có `matchMedia`
  // (SSR / jsdom chưa mock) ⇒ coi như CÓ chỗ. Chọn chiều này vì `matchMedia` tồn tại ở mọi trình duyệt
  // thật — fallback chỉ chạm tới test, và mặc định "có dock" giữ đúng hành vi trên desktop.
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(DOCK_VIEWPORT_QUERY).matches;
}

export function useHasDockViewport(): boolean {
  const [hasRoom, setHasRoom] = useState(evaluate);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DOCK_VIEWPORT_QUERY);
    const onChange = (): void => setHasRoom(mql.matches);
    // Đồng bộ NGAY: giữa lần `useState(evaluate)` và lần effect đầu, người dùng có thể đã xoay ngang máy
    // hoặc kéo cửa sổ — giá trị khởi tạo lúc đó đã cũ.
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return hasRoom;
}
