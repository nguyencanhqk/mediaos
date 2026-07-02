import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SignalBar } from "@/components/SignalBar";
import { BRAND_SYSTEM_LABEL, BRAND_WORDMARK } from "@/lib/brand";

/**
 * AuthShell — vỏ "phòng điều khiển" dùng chung cho MỌI trang apps/auth (login, forgot/reset password,
 * session-expired). Tách khỏi login.tsx để forgot/reset/session-expired dùng lại đúng ngôn ngữ thiết kế
 * (BrandPanel bên trái + console card bên phải) thay vì tự vẽ lại — tránh trôi thiết kế (DRY).
 */

/** Bảng nhận diện bên trái — "bàn điều khiển": wordmark + tagline + thanh tín hiệu on-air + trạng thái. */
function BrandPanel() {
  const { t } = useTranslation("auth");
  return (
    <section className="flex flex-1 flex-col justify-between gap-10 lg:max-w-md">
      <div className="space-y-2">
        <h1 className="brand-gradient-text font-display text-4xl font-bold tracking-tight">
          {BRAND_WORDMARK}
        </h1>
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.25em] text-muted-foreground">
          {BRAND_SYSTEM_LABEL}
        </p>
      </div>

      <div className="space-y-5">
        <p className="font-display text-xl font-medium text-foreground/90">{t("login.tagline")}</p>
        <SignalBar />
      </div>

      <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <span className="live-dot inline-block size-2 rounded-full bg-brand shadow-[0_0_8px] shadow-brand" />
        <span className="tracking-widest text-foreground/80">{t("login.onAir")}</span>
        <span aria-hidden>·</span>
        <span>{t("login.sessionNote")}</span>
      </div>
    </section>
  );
}

interface AuthShellProps {
  heading: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}

/** Console card bên phải + BrandPanel bên trái, dùng chung khung "control-room". */
export function AuthShell({ heading, subtitle, children }: AuthShellProps) {
  return (
    <div className="control-room-bg min-h-screen w-full">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col items-center justify-center gap-12 px-6 py-12 lg:flex-row lg:items-stretch lg:gap-20 lg:py-0">
        <BrandPanel />

        <section className="flex w-full max-w-sm items-center lg:flex-1">
          <div className="w-full rounded-xl border border-border bg-card p-7 shadow-2xl shadow-black/40">
            <div className="mb-6 space-y-1">
              <h2 className="font-display text-2xl font-semibold">{heading}</h2>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
