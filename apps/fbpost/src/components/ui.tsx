"use client";

import type { PostStatus } from "@/lib/types";
import { POST_STATUS_LABELS } from "@/lib/types";

/** Cac manh giao dien dung lai o nhieu trang. */

export function Alert({
  tone,
  children,
}: {
  tone: "info" | "success" | "error" | "warning";
  children: React.ReactNode;
}) {
  const palette = {
    info: { bg: "#eff4ff", border: "#c5d9fb", text: "#0f4fa8" },
    success: { bg: "#e9f7ef", border: "#bfe6cd", text: "#1a7f42" },
    error: { bg: "#fdecec", border: "#f5c6c7", text: "#b4242a" },
    warning: { bg: "#fff6e5", border: "#f7ddb0", text: "#8a5a05" },
  }[tone];

  return (
    <div
      className="rounded-lg border px-3.5 py-2.5 text-sm leading-relaxed"
      style={{ backgroundColor: palette.bg, borderColor: palette.border, color: palette.text }}
    >
      {children}
    </div>
  );
}

const STATUS_COLORS: Record<PostStatus, { bg: string; text: string }> = {
  draft: { bg: "#eceef1", text: "#4b4f55" },
  queued: { bg: "#fff6e5", text: "#8a5a05" },
  publishing: { bg: "#eff4ff", text: "#0f4fa8" },
  scheduled: { bg: "#e8f1fe", text: "#1465d8" },
  published: { bg: "#e9f7ef", text: "#1a7f42" },
  failed: { bg: "#fdecec", text: "#b4242a" },
  cancelled: { bg: "#eceef1", text: "#6b7076" },
};

export function StatusBadge({ status }: { status: PostStatus }) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
  return (
    <span
      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{ backgroundColor: color.bg, color: color.text }}
    >
      {POST_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <h2 className="text-base font-bold">{title}</h2>
      {description ? <p className="hint mt-1 mb-4">{description}</p> : <div className="mb-4" />}
      {children}
    </section>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {label}
    </span>
  );
}
