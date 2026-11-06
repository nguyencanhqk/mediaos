import { Outlet } from "@tanstack/react-router";
import { Toaster } from "@mediaos/ui";

/**
 * Vỏ gốc của app đăng nhập (S20-FE-TOAST-2): mọi trang public + MỘT `<Toaster />` — đích hiển thị của
 * `showApiErrorToast` (main.tsx gắn `configureToast(toast)`). App này không có topbar ⇒ đặt thông báo sát
 * mép trên thay vì chừa chỗ topbar như vỏ nghiệp vụ.
 */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <Toaster className="top-4" />
    </>
  );
}
