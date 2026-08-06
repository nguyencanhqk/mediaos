import type { Metadata } from "next";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "FB Post — Đăng bài tự động lên Facebook Page",
  description: "Phần mềm soạn, hẹn giờ và đăng bài tự động lên Facebook Page",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        <Nav />
        <main className="mx-auto max-w-5xl px-4 pb-16">{children}</main>
      </body>
    </html>
  );
}
