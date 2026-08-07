"use client";

import Link from "next/link";
import type { PageAccount } from "@/lib/types";
import { Alert } from "./ui";

/**
 * Chon cac Page se nhan bai.
 *
 * Page dang tat hoac khong co quyen dang bai van hien ra nhung khong chon duoc,
 * de nguoi dung biet vi sao Page do khong nam trong danh sach.
 */

interface PagePickerProps {
  pages: PageAccount[];
  selected: number[];
  onChange: (selected: number[]) => void;
}

export function PagePicker({ pages, selected, onChange }: PagePickerProps) {
  const usable = pages.filter((page) => page.isActive && page.canPost);

  if (pages.length === 0) {
    return (
      <Alert tone="warning">
        Chưa có Page nào.{" "}
        <Link href="/pages" className="font-semibold underline">
          Vào trang Page
        </Link>{" "}
        để kết nối trước khi đăng bài.
      </Alert>
    );
  }

  const toggle = (id: number) => {
    onChange(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]);
  };

  const allSelected = usable.length > 0 && usable.every((page) => selected.includes(page.id));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <button
          className="btn btn-ghost"
          onClick={() => onChange(allSelected ? [] : usable.map((page) => page.id))}
          disabled={usable.length === 0}
        >
          {allSelected ? "Bỏ chọn tất cả" : `Chọn tất cả (${usable.length})`}
        </button>
        <span className="hint">Đã chọn {selected.length} Page</span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {pages.map((page) => {
          const disabled = !page.isActive || !page.canPost;
          return (
            <li key={page.id}>
              <label
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5"
                style={{
                  borderColor: selected.includes(page.id)
                    ? "var(--color-brand-500)"
                    : "var(--border)",
                  opacity: disabled ? 0.55 : 1,
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.includes(page.id)}
                  disabled={disabled}
                  onChange={() => toggle(page.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{page.name}</span>
                  <span className="hint block truncate">
                    {page.accountName || `ID ${page.pageId}`}
                    {!page.canPost && " — không có quyền đăng bài"}
                    {page.canPost && !page.isActive && " — đang tắt"}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
