import { Outlet } from "@tanstack/react-router";

/**
 * Root layout của apps/web — FS-5: web giờ là LAUNCHER root-domain, chỉ một route "/" full-screen
 * (HomePage tự lo chrome riêng). Không bọc AppShell (sidebar/topbar nghiệp vụ) như product app. Login đã
 * externalize sang apps/auth; guard ở router.tsx.
 */
export function RootLayout() {
  return <Outlet />;
}
