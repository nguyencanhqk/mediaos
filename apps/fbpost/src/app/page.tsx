"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Alert, Section, Spinner, StatusBadge } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client-api";
import { formatDateTime } from "@/lib/schedule";
import type { PageAccount, Post, PostStatus } from "@/lib/types";
import { POST_STATUS_LABELS, POST_TYPE_LABELS } from "@/lib/types";

/** So the hien thi moi lan, tranh dung hinh khi lich co hang tram bai. */
const PAGE_SIZE = 60;

const STATUS_FILTERS: PostStatus[] = ["queued", "scheduled", "published", "failed", "cancelled"];

export default function QueuePage() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [pages, setPages] = useState<PageAccount[]>([]);
  const [pageFilter, setPageFilter] = useState<number | "all">("all");
  const [statusFilter, setStatusFilter] = useState<PostStatus | "all">("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [postList, pageList] = await Promise.all([
        apiGet<Post[]>("/api/posts"),
        apiGet<PageAccount[]>("/api/pages"),
      ]);
      setPosts(postList);
      setPages(pageList);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    // Tu lam moi de thay bai trong hang doi chuyen trang thai.
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    if (posts === null) return [];
    return posts.filter(
      (post) =>
        (pageFilter === "all" || post.pageRef === pageFilter) &&
        (statusFilter === "all" || post.status === statusFilter),
    );
  }, [posts, pageFilter, statusFilter]);

  const runAction = async (id: number, action: "publish" | "publishNow" | "cancel" | "delete") => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      if (action === "publish") {
        await apiSend(`/api/posts/${id}/publish`, "POST");
        setNotice("Đã gửi lại bài.");
      } else if (action === "publishNow") {
        await apiSend(`/api/posts/${id}/publish?now=1`, "POST");
        setNotice("Đã đăng bài ngay.");
      } else if (action === "cancel") {
        await apiSend(`/api/posts/${id}`, "PATCH");
        setNotice("Đã huỷ bài trong hàng đợi.");
      } else {
        const result = await apiSend<{ warnedFacebookStillScheduled: boolean }>(
          `/api/posts/${id}`,
          "DELETE",
        );
        setNotice(
          result.warnedFacebookStillScheduled
            ? "Đã xoá khỏi danh sách. Lưu ý: bài vẫn nằm trong lịch của Facebook — muốn huỷ hẳn thì vào Meta Business Suite."
            : "Đã xoá bài.",
        );
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (posts === null) {
    return (
      <div className="py-10">
        <Spinner label="Đang tải danh sách bài…" />
      </div>
    );
  }

  const usablePages = pages.filter((page) => page.isActive && page.canPost);
  const waitingHandoff = posts.filter(
    (post) => post.status === "queued" && post.scheduleMode !== "local",
  ).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Hàng đợi bài đăng</h1>
          <p className="hint mt-1">
            {usablePages.length > 0
              ? `${usablePages.length} Page đang sẵn sàng • ${posts.length} bài trong danh sách`
              : "Chưa có Page nào sẵn sàng nhận bài."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/plan" className="btn btn-ghost">
            Lên lịch tự động
          </Link>
          <Link href="/compose" className="btn btn-primary">
            Soạn bài mới
          </Link>
        </div>
      </div>

      {pages.length === 0 && (
        <Alert tone="warning">
          Chưa kết nối Page nào.{" "}
          <Link href="/settings" className="font-semibold underline">
            Vào trang Cài đặt
          </Link>{" "}
          để kết nối tài khoản Facebook trước khi đăng bài.
        </Alert>
      )}
      {waitingHandoff > 0 && (
        <Alert tone="info">
          {waitingHandoff} bài đang chờ được gửi lên Facebook. Phần mềm gửi dần, tối đa 8 bài mỗi
          phút — cứ để phần mềm chạy, danh sách sẽ tự cập nhật.
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="info">{notice}</Alert>}

      {posts.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="pageFilter">
              Lọc theo Page
            </label>
            <select
              id="pageFilter"
              className="field"
              value={pageFilter}
              onChange={(e) => {
                setPageFilter(e.target.value === "all" ? "all" : Number(e.target.value));
                setVisibleCount(PAGE_SIZE);
              }}
            >
              <option value="all">Tất cả Page</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="statusFilter">
              Lọc theo trạng thái
            </label>
            <select
              id="statusFilter"
              className="field"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value === "all" ? "all" : (e.target.value as PostStatus));
                setVisibleCount(PAGE_SIZE);
              }}
            >
              <option value="all">Tất cả trạng thái</option>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {POST_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>
          <p className="hint pb-2.5">{filtered.length} bài khớp bộ lọc</p>
        </div>
      )}

      {posts.length === 0 ? (
        <Section title="Chưa có bài nào">
          <p className="hint">
            Bấm <strong>Soạn bài mới</strong> để đăng ngay, dùng{" "}
            <Link href="/plan" className="font-semibold underline">
              Lên lịch tự động
            </Link>{" "}
            để rải nhiều nội dung lên nhiều Page, hoặc{" "}
            <Link href="/import" className="font-semibold underline">
              nhập hàng loạt từ file CSV/Excel
            </Link>
            .
          </p>
        </Section>
      ) : filtered.length === 0 ? (
        <Section title="Không có bài nào khớp bộ lọc">
          <p className="hint">Đổi lại bộ lọc Page hoặc trạng thái ở trên.</p>
        </Section>
      ) : (
        <>
          <ul className="space-y-3">
            {filtered.slice(0, visibleCount).map((post) => (
              <li key={post.id} className="card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <StatusBadge status={post.status} />
                      <span
                        className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                        style={{
                          backgroundColor: "var(--color-brand-50)",
                          color: "var(--color-brand-700)",
                        }}
                      >
                        {post.pageName || `Page #${post.pageRef}`}
                      </span>
                      <span className="hint">{POST_TYPE_LABELS[post.type]}</span>
                      {post.scheduledAt && (
                        <span className="hint">• Hẹn: {formatDateTime(post.scheduledAt)}</span>
                      )}
                      {post.scheduleMode === "local" && post.status === "queued" && (
                        <span className="hint">• Cần giữ phần mềm chạy</span>
                      )}
                      {post.planId && <span className="hint">• Kế hoạch #{post.planId}</span>}
                    </div>

                    <p className="line-clamp-3 text-sm whitespace-pre-wrap">
                      {post.message || post.link || "(không có nội dung)"}
                    </p>

                    {post.mediaIds.length > 0 && (
                      <p className="hint mt-1">{post.mediaIds.length} file đính kèm</p>
                    )}

                    {post.error && (
                      <p className="mt-2 text-xs" style={{ color: "#b4242a" }}>
                        {post.error}
                      </p>
                    )}

                    {post.fbPermalink && (
                      <a
                        href={post.fbPermalink}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-xs font-semibold underline"
                        style={{ color: "var(--color-brand-500)" }}
                      >
                        Xem trên Facebook
                      </a>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {(post.status === "failed" ||
                      post.status === "cancelled" ||
                      post.status === "draft") && (
                      <button
                        className="btn btn-ghost"
                        disabled={busyId === post.id}
                        onClick={() => void runAction(post.id, "publish")}
                      >
                        {post.status === "draft" ? "Gửi đi" : "Thử lại"}
                      </button>
                    )}
                    {post.status === "queued" && (
                      <>
                        <button
                          className="btn btn-ghost"
                          disabled={busyId === post.id}
                          onClick={() => void runAction(post.id, "publishNow")}
                        >
                          Đăng ngay
                        </button>
                        <button
                          className="btn btn-ghost"
                          disabled={busyId === post.id}
                          onClick={() => void runAction(post.id, "cancel")}
                        >
                          Huỷ
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-danger"
                      disabled={busyId === post.id || post.status === "publishing"}
                      onClick={() => void runAction(post.id, "delete")}
                    >
                      Xoá
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {filtered.length > visibleCount && (
            <button
              className="btn btn-ghost w-full"
              onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
            >
              Xem thêm {Math.min(PAGE_SIZE, filtered.length - visibleCount)} bài (còn{" "}
              {filtered.length - visibleCount})
            </button>
          )}
        </>
      )}
    </div>
  );
}
