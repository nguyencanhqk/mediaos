"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Section, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client-api";
import type { PageAccount } from "@/lib/types";

/**
 * Danh sach Page dung de dang bai.
 *
 * Tat ca Page ma tai khoan quan ly deu duoc nap ve mot lan; nguoi dung
 * bat/tat tung Page tuy dot chien dich, khong phai lay lai token.
 */
export default function PagesPage() {
  const [pages, setPages] = useState<PageAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPages(await apiGet<PageAccount[]>("/api/pages"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setBusy("refresh");
    setError(null);
    setNotice(null);
    try {
      const result = await apiSend<{
        added: number;
        updated: number;
        outcomes: { accountName: string; error: string | null }[];
        pages: PageAccount[];
      }>("/api/pages", "POST");
      setPages(result.pages);

      const failed = result.outcomes.filter((o) => o.error);
      setNotice(
        `Đã đồng bộ ${result.outcomes.length} tài khoản: thêm mới ${result.added} Page, cập nhật ${result.updated} Page.`,
      );
      if (failed.length > 0) {
        setError(
          `Không đồng bộ được ${failed.length} tài khoản: ${failed
            .map((o) => `${o.accountName} (${o.error})`)
            .join("; ")}`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (page: PageAccount) => {
    setBusy(`toggle-${page.id}`);
    setError(null);
    setNotice(null);
    try {
      await apiSend(`/api/pages/${page.id}`, "PATCH", { isActive: !page.isActive });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (page: PageAccount, force = false) => {
    setBusy(`delete-${page.id}`);
    setError(null);
    setNotice(null);
    try {
      const result = await apiSend<{ abandonedPosts: number }>(
        `/api/pages/${page.id}${force ? "?force=1" : ""}`,
        "DELETE",
      );
      await load();
      setNotice(
        result.abandonedPosts > 0
          ? `Đã gỡ Page "${page.name}". ${result.abandonedPosts} bài chưa gửi của Page này sẽ không đăng được nữa.`
          : `Đã gỡ Page "${page.name}".`,
      );
    } catch (e) {
      const message = (e as Error).message;
      // Server chan lan dau khi Page con bai cho - hoi lai roi go that su.
      if (message.includes("còn") && window.confirm(`${message}\n\nVẫn gỡ Page này?`)) {
        await remove(page, true);
        return;
      }
      setError(message);
    } finally {
      setBusy(null);
    }
  };

  if (pages === null) {
    return (
      <div className="py-10">
        <Spinner label="Đang tải danh sách Page…" />
      </div>
    );
  }

  const usableCount = pages.filter((page) => page.isActive && page.canPost).length;
  const accountCount = new Set(pages.map((page) => page.accountId)).size;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Page đã kết nối</h1>
          <p className="hint mt-1">
            {pages.length === 0
              ? "Chưa có Page nào."
              : `${usableCount}/${pages.length} Page đang sẵn sàng nhận bài, thuộc ${accountCount} tài khoản.`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => void refresh()} disabled={busy !== null}>
          {busy === "refresh" ? "Đang đồng bộ…" : "Đồng bộ tất cả tài khoản"}
        </button>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {pages.length === 0 ? (
        <Section title="Chưa kết nối Page nào">
          <p className="hint">
            Vào{" "}
            <Link href="/settings" className="font-semibold underline">
              trang Cài đặt
            </Link>{" "}
            để kết nối tài khoản Facebook. Sau bước đó, toàn bộ Page bạn quản lý sẽ tự xuất hiện ở
            đây.
          </p>
        </Section>
      ) : (
        <Section
          title="Danh sách Page"
          description="Tắt một Page để tạm thời loại nó khỏi mọi lượt chọn khi soạn bài và lên lịch. Bài đã hẹn của Page đó vẫn giữ nguyên."
        >
          <ul className="space-y-2">
            {pages.map((page) => (
              <li
                key={page.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{page.name}</p>
                    {!page.canPost && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: "#fdecec", color: "#b4242a" }}
                      >
                        Không có quyền đăng
                      </span>
                    )}
                    {page.canPost && !page.isActive && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: "#eceef1", color: "#6b7076" }}
                      >
                        Đang tắt
                      </span>
                    )}
                  </div>
                  <p className="hint">
                    {page.accountName ? `Tài khoản ${page.accountName} • ` : ""}ID {page.pageId} •
                    Token {page.tokenMasked}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    className="btn btn-ghost"
                    disabled={busy !== null || !page.canPost}
                    onClick={() => void toggle(page)}
                  >
                    {page.isActive ? "Tắt" : "Bật"}
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={busy !== null}
                    onClick={() => void remove(page)}
                  >
                    Gỡ
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Vì sao một Page không có quyền đăng?">
        <p className="hint">
          Facebook chỉ cho phép đăng khi tài khoản của bạn giữ vai trò có quyền tạo nội dung trên
          Page đó, và token phải được cấp quyền cho đúng Page. Nếu thiếu, hãy tạo lại token trong
          Graph API Explorer và nhớ tick chọn Page cần dùng ở bước cấp quyền, rồi bấm{" "}
          <strong>Lấy lại danh sách từ Facebook</strong>.
        </p>
      </Section>
    </div>
  );
}
