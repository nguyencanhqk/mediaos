"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Hàng đợi" },
  { href: "/contents", label: "Nội dung" },
  { href: "/plan", label: "Lên lịch" },
  { href: "/compose", label: "Soạn bài" },
  { href: "/import", label: "Nhập từ file" },
  { href: "/pages", label: "Page" },
  { href: "/settings", label: "Cài đặt" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="card sticky top-0 z-10 mb-6 rounded-none border-x-0 border-t-0">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-base font-bold text-[var(--color-brand-500)]">
          FB Post
        </Link>
        <nav className="flex flex-wrap gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: active ? "var(--color-brand-50)" : "transparent",
                  color: active ? "var(--color-brand-700)" : "var(--text-muted)",
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
