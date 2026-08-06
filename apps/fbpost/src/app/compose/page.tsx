"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MediaInput } from "@/components/media-input";
import { PagePicker } from "@/components/page-picker";
import { Alert, Section, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client-api";
import { decideScheduleMode, localInputToUnix } from "@/lib/schedule";
import type { MediaFile, PageAccount, PostStatus, PostType } from "@/lib/types";
import { POST_TYPE_LABELS } from "@/lib/types";

const TYPES: PostType[] = ["text", "photo", "video", "reel"];

interface TargetResult {
  pageRef: number;
  pageName: string;
  postId: number;
  status: PostStatus;
  error: string | null;
}

interface CreateResult {
  results: TargetResult[];
  decision: { mode: string; reason: string };
  queued: boolean;
  okCount: number;
}

export default function ComposePage() {
  const router = useRouter();

  const [pages, setPages] = useState<PageAccount[] | null>(null);
  const [pageRefs, setPageRefs] = useState<number[]>([]);
  const [type, setType] = useState<PostType>("text");
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleValue, setScheduleValue] = useState("");
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [label, setLabel] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<PageAccount[]>("/api/pages");
      setPages(data);
      // Mac dinh chon het cac Page dung duoc - truong hop hay gap nhat
      // la dang cung mot bai len tat ca Page.
      setPageRefs(data.filter((page) => page.isActive && page.canPost).map((page) => page.id));
    } catch (e) {
      setError((e as Error).message);
      setPages([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scheduledAt = scheduleEnabled ? localInputToUnix(scheduleValue) : null;

  // Cho nguoi dung thay truoc ai se giu lich truoc khi bam dang.
  const decision = useMemo(
    () => decideScheduleMode(scheduledAt, type, Math.floor(Date.now() / 1000)),
    [scheduledAt, type],
  );

  const needsMedia = type !== "text";
  const singleMediaOnly = type === "video" || type === "reel";

  const resetForm = () => {
    setMessage("");
    setLink("");
    setTitle("");
    setMedia([]);
    setScheduleEnabled(false);
    setScheduleValue("");
    setLabel("");
  };

  const submit = async () => {
    setError(null);
    setResult(null);

    if (pageRefs.length === 0) {
      setError("Chọn ít nhất một Page để đăng.");
      return;
    }
    if (scheduleEnabled && scheduledAt === null) {
      setError("Chưa chọn thời gian hẹn hợp lệ.");
      return;
    }
    if (needsMedia && media.length === 0) {
      setError(`Bài loại "${POST_TYPE_LABELS[type]}" cần có file đính kèm.`);
      return;
    }
    if (type === "text" && !message.trim() && !link.trim()) {
      setError("Nhập nội dung hoặc link cho bài viết.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await apiSend<CreateResult>("/api/posts", "POST", {
        pageRefs,
        type,
        message,
        link: type === "text" ? link.trim() || null : null,
        title: singleMediaOnly ? title.trim() || null : null,
        mediaIds: media.map((m) => m.id),
        scheduledAt,
        saveToLibrary,
        label: label.trim() || null,
      });

      setResult(created);
      if (created.okCount > 0) resetForm();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (pages === null) {
    return (
      <div className="py-10">
        <Spinner label="Đang tải danh sách Page…" />
      </div>
    );
  }

  const failures = result?.results.filter((r) => r.error) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Soạn bài</h1>
        <p className="hint mt-1">
          Viết một lần, chọn bao nhiêu Page tuỳ ý — mỗi Page nhận một bài riêng.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {result && (
        <Alert tone={failures.length === 0 ? "success" : "warning"}>
          {result.queued ? (
            <>
              Đã đưa {result.results.length} bài vào hàng đợi. Phần mềm đang gửi dần lên Facebook
              (tối đa 8 bài mỗi phút) —{" "}
              <Link href="/" className="font-semibold underline">
                xem hàng đợi
              </Link>
              .
            </>
          ) : (
            <>
              Thành công {result.okCount}/{result.results.length} Page.
              {failures.length > 0 && (
                <ul className="mt-1.5 list-disc pl-5">
                  {failures.map((item) => (
                    <li key={item.pageRef}>
                      {item.pageName}: {item.error}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Alert>
      )}

      <Section
        title={`Đăng lên Page (${pageRefs.length})`}
        description="Bỏ tick những Page không muốn đăng lần này."
      >
        <PagePicker pages={pages} selected={pageRefs} onChange={setPageRefs} />
      </Section>

      <Section title="Loại nội dung">
        <div className="flex flex-wrap gap-2">
          {TYPES.map((value) => (
            <button
              key={value}
              className="btn"
              style={{
                backgroundColor: type === value ? "var(--color-brand-500)" : "transparent",
                color: type === value ? "#fff" : "var(--text)",
                borderColor: type === value ? "var(--color-brand-500)" : "var(--border)",
              }}
              onClick={() => {
                setType(value);
                if (value === "text") setMedia([]);
              }}
            >
              {POST_TYPE_LABELS[value]}
            </button>
          ))}
        </div>
        {type === "reel" && (
          <p className="hint mt-3">
            Reels yêu cầu video dọc tỷ lệ 9:16, dài 3–90 giây, tối thiểu 540×960, định dạng MP4.
          </p>
        )}
      </Section>

      <Section title="Nội dung">
        <label className="label" htmlFor="message">
          {type === "text" ? "Nội dung bài viết" : "Chú thích"}
        </label>
        <textarea
          id="message"
          className="field"
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Nhập nội dung bài đăng…"
        />

        {type === "text" && (
          <div className="mt-3">
            <label className="label" htmlFor="link">
              Link đính kèm (không bắt buộc)
            </label>
            <input
              id="link"
              className="field"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
            />
          </div>
        )}

        {singleMediaOnly && (
          <div className="mt-3">
            <label className="label" htmlFor="title">
              Tiêu đề video (không bắt buộc)
            </label>
            <input
              id="title"
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
        )}
      </Section>

      {needsMedia && (
        <Section
          title={type === "photo" ? "Ảnh" : "Video"}
          description={
            type === "photo"
              ? "Chọn một hoặc nhiều ảnh. Nhiều ảnh sẽ đăng thành một bài album."
              : "Chọn một file video."
          }
        >
          <MediaInput type={type} media={media} onChange={setMedia} onError={setError} />
        </Section>
      )}

      <Section title="Thời điểm đăng">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="radio"
              checked={!scheduleEnabled}
              onChange={() => setScheduleEnabled(false)}
            />
            Đăng ngay
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="radio"
              checked={scheduleEnabled}
              onChange={() => setScheduleEnabled(true)}
            />
            Hẹn giờ
          </label>
        </div>

        {scheduleEnabled && (
          <div className="mt-3 max-w-xs">
            <input
              type="datetime-local"
              className="field"
              value={scheduleValue}
              onChange={(e) => setScheduleValue(e.target.value)}
            />
          </div>
        )}

        {scheduleEnabled && scheduledAt !== null && (
          <div className="mt-3">
            <Alert tone={decision.mode === "facebook" ? "info" : "warning"}>
              {decision.reason}
            </Alert>
          </div>
        )}

        <p className="hint mt-3">
          Cần rải nhiều nội dung theo nhiều khung giờ?{" "}
          <Link href="/plan" className="font-semibold underline">
            Dùng trang Lên lịch
          </Link>{" "}
          để phần mềm tự xếp lịch cho cả tuần.
        </p>
      </Section>

      <Section title="Lưu vào thư viện">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={saveToLibrary}
            onChange={(e) => setSaveToLibrary(e.target.checked)}
          />
          Lưu nội dung này vào thư viện để dùng lại cho các Page khác
        </label>
        {saveToLibrary && (
          <div className="mt-3 max-w-md">
            <label className="label" htmlFor="label">
              Nhãn để dễ tìm (không bắt buộc)
            </label>
            <input
              id="label"
              className="field"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VD: Khuyến mãi tháng 8 — bài 1"
            />
          </div>
        )}
      </Section>

      <div className="flex gap-3">
        <button
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={submitting || pageRefs.length === 0}
        >
          {submitting
            ? "Đang xử lý…"
            : scheduleEnabled
              ? `Hẹn lịch cho ${pageRefs.length} Page`
              : `Đăng ngay lên ${pageRefs.length} Page`}
        </button>
        <button className="btn btn-ghost" onClick={resetForm} disabled={submitting}>
          Xoá form
        </button>
      </div>
    </div>
  );
}
