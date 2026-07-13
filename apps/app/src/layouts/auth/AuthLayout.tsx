/**
 * AuthLayout — vỏ cho các trang xác thực công khai (Login / Forgot / Reset).
 *
 * Quy tắc (FE05-AUTH-AC-001..004):
 * - KHÔNG load app registry / sidebar / notification.
 * - Desktop: 2 cột (brand panel trái, form phải).
 * - Mobile: chỉ form (brand panel ẩn hoặc thu gọn).
 * - Authenticated user redirect về /home (xử lý ở router guard, không ở đây).
 */
import * as React from "react";
import { cn } from "@mediaos/ui";

interface AuthLayoutProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  /** Ẩn brand panel bên trái (dùng cho mobile hoặc khi cần full-width form). */
  showBrandPanel?: boolean;
}

function AuthBrandPanel() {
  // Brand panel = chrome navy hằng số cả hai theme (gradient phổ luôn đọc được)
  return (
    <div className="hidden lg:flex lg:flex-col lg:items-center lg:justify-center lg:bg-chrome lg:px-12 lg:py-16">
      <div className="mx-auto max-w-sm text-center">
        <div className="brand-gradient-text font-display mb-4 text-4xl font-bold tracking-tight">
          FUNTIME MEDIA
        </div>
        <div className="brand-gradient-line mx-auto mb-6 h-0.5 w-32 rounded-full opacity-80" />
        <p className="text-sm leading-relaxed text-chrome-foreground/70">
          Hệ thống quản lý doanh nghiệp nội bộ. Nhân sự · Chấm công · Nghỉ phép · Công việc.
        </p>
      </div>
    </div>
  );
}

export function AuthLayout({ children, title, subtitle, showBrandPanel = true }: AuthLayoutProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className={cn("grid min-h-screen", showBrandPanel ? "lg:grid-cols-2" : "grid-cols-1")}>
        {showBrandPanel && <AuthBrandPanel />}

        <section className="flex items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md">
            {title && (
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
            )}
            {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
            <div className={cn(title || subtitle ? "mt-6" : "")}>{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
