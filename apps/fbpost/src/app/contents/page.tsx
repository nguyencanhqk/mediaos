"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MediaInput } from "@/components/media-input";
import { Alert, Section, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client-api";
import type { Content, MediaFile, PostType } from "@/lib/types";
import { POST_TYPE_LABELS } from "@/lib/types";

/**
 * Thu vien noi dung: danh sach bai chua gan Page va chua gan gio.
 * Tu day chon vai noi dung roi sang trang Len lich de rai len nhieu Page.
 */

const TYPES: PostType[] = ["text", "photo", "video", "reel"];

interface ContentsResponse {
  contents: Content[];
  scheduledCounts: Record<number, number>;
}

interface EditorState {
  id: number | null;
  label: string;
  type: PostType;
  message: string;
  link: string;
  title: string;
  media: MediaFile[];
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  label: "",
  type: "text",
  message: "",
  link: "",
  title: "",
  media: [],
};

export default function ContentsPage() {
  const [data, setData] = useState<ContentsResponse | null>(null);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<ContentsResponse>("/api/contents"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const singleMediaOnly = editor.type === "video" || editor.type === "reel";
  const needsMedia = editor.type !== "text";

  const planHref = useMemo(
    () => (selected.length > 0 ? `/plan?contents=${selected.join(",")}` : "/plan"),
    [selected],
  );

  const startEdit = (content: Content, media: MediaFile[]) => {
    setEditor({
      id: content.id,
      label: content.label ?? "",
      type: content.type,
      message: content.message,
      link: content.link ?? "",
      title: content.title ?? "",
      media,
    });
    setNotice(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadForEdit = async (content: Content) => {
    setBusy(`edit-${content.id}`);
    try {
      // Lay lai thong tin file de hien anh xem truoc trong form.
      const media = await Promise.all(
        content.mediaIds.map((id) => apiGet<MediaFile>(`/api/media/${id}`)),
      );
      startEdit(content, media);
    } catch {
      startEdit(content, []);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError(null);
    setNotice(null);

    if (needsMedia && editor.media.length === 0) {
      setError(`Nội dung loại "${POST_TYPE_LABELS[editor.type]}" cần có file đính kèm.`);
      return;
    }
    if (editor.type === "text" && !editor.message.trim() && !editor.link.trim()) {
      setError("Nhập nội dung hoặc link.");
      return;
    }

    setBusy("save");
    try {
      const payload = {
        label: editor.label.trim() || null,
        type: editor.type,
        message: editor.message,
        link: editor.type === "text" ? editor.link.trim() || null : null,
        title: singleMediaOnly ? editor.title.trim() || null : null,
        mediaIds: editor.media.map((m) => m.id),
      };

      if (editor.id === null) {
        await apiSend("/api/contents", "POST", payload);
        setNotice("Đã thêm nội dung vào thư viện.");
      } else {
        await apiSend(`/api/contents/${editor.id}`, "PATCH", payload);
        setNotice("Đã cập nhật nội dung.");
      }

      setEditor(EMPTY_EDITOR);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (content: Content) => {
    setBusy(`delete-${content.id}`);
    setError(null);
    setNotice(null);
    try {
      await apiSend(`/api/contents/${content.id}`, "DELETE");
      setSelected((current) => current.filter((id) => id !== content.id));
      await load();
      setNotice(
        "Đã xoá nội dung khỏi thư viện. Các bài đã xếp lịch từ nội dung này vẫn giữ nguyên.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (data === null) {
    return (
      <div className="py-10">
        <Spinner label="Đang tải thư viện nội dung…" />
      </div>
    );
  }

  const allSelected = data.contents.length > 0 && selected.length === data.contents.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Thư viện nội dung</h1>
          <p className="hint mt-1">
            Soạn sẵn nội dung ở đây, sau đó rải lên nhiều Page theo lịch tự động.
          </p>
        </div>
        <Link
          href={planHref}
          className="btn btn-primary"
          style={{ opacity: data.contents.length === 0 ? 0.55 : 1 }}
        >
          {selected.length > 0 ? `Lên lịch ${selected.length} nội dung` : "Lên lịch đăng"}
        </Link>
      </div>

      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Section
        title={editor.id === null ? "Thêm nội dung mới" : `Sửa nội dung #${editor.id}`}
        description="Nội dung ở đây chưa gắn với Page hay giờ đăng nào."
      >
        <div className="mb-3 flex flex-wrap gap-2">
          {TYPES.map((value) => (
            <button
              key={value}
              className="btn"
              style={{
                backgroundColor: editor.type === value ? "var(--color-brand-500)" : "transparent",
                color: editor.type === value ? "#fff" : "var(--text)",
                borderColor: editor.type === value ? "var(--color-brand-500)" : "var(--border)",
              }}
              onClick={() =>
                setEditor((current) => ({
                  ...current,
                  type: value,
                  media: value === "text" ? [] : current.media,
                }))
              }
            >
              {POST_TYPE_LABELS[value]}
            </button>
          ))}
        </div>

        <div className="mb-3">
          <label className="label" htmlFor="label">
            Nhãn để dễ tìm (không bắt buộc)
          </label>
          <input
            id="label"
            className="field"
            value={editor.label}
            onChange={(e) => setEditor((current) => ({ ...current, label: e.target.value }))}
            placeholder="VD: Khuyến mãi tháng 8 — bài 1"
          />
        </div>

        <label className="label" htmlFor="message">
          {editor.type === "text" ? "Nội dung bài viết" : "Chú thích"}
        </label>
        <textarea
          id="message"
          className="field"
          rows={5}
          value={editor.message}
          onChange={(e) => setEditor((current) => ({ ...current, message: e.target.value }))}
          placeholder="Nhập nội dung bài đăng…"
        />

        {editor.type === "text" && (
          <div className="mt-3">
            <label className="label" htmlFor="link">
              Link đính kèm (không bắt buộc)
            </label>
            <input
              id="link"
              className="field"
              value={editor.link}
              onChange={(e) => setEditor((current) => ({ ...current, link: e.target.value }))}
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
              value={editor.title}
              onChange={(e) => setEditor((current) => ({ ...current, title: e.target.value }))}
            />
          </div>
        )}

        {needsMedia && (
          <div className="mt-4">
            <label className="label">{editor.type === "photo" ? "Ảnh" : "Video"}</label>
            <MediaInput
              type={editor.type}
              media={editor.media}
              onChange={(media) => setEditor((current) => ({ ...current, media }))}
              onError={setError}
              // File cua noi dung co san co the dang duoc bai da xep lich dung,
              // nen bam Xoa o day chi go khoi noi dung chu khong xoa file.
              removeMode={editor.id === null ? "delete" : "detach"}
            />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy !== null}>
            {busy === "save"
              ? "Đang lưu…"
              : editor.id === null
                ? "Thêm vào thư viện"
                : "Lưu thay đổi"}
          </button>
          {editor.id !== null && (
            <button className="btn btn-ghost" onClick={() => setEditor(EMPTY_EDITOR)}>
              Huỷ sửa
            </button>
          )}
        </div>
      </Section>

      {data.contents.length === 0 ? (
        <Section title="Thư viện đang trống">
          <p className="hint">
            Thêm nội dung ở khung trên, hoặc{" "}
            <Link href="/import" className="font-semibold underline">
              nhập hàng loạt từ file CSV/Excel
            </Link>
            .
          </p>
        </Section>
      ) : (
        <Section
          title={`Danh sách nội dung (${data.contents.length})`}
          description="Tick chọn các nội dung muốn rải lên Page rồi bấm Lên lịch đăng."
        >
          <div className="mb-3">
            <button
              className="btn btn-ghost"
              onClick={() =>
                setSelected(allSelected ? [] : data.contents.map((content) => content.id))
              }
            >
              {allSelected ? "Bỏ chọn tất cả" : `Chọn tất cả (${data.contents.length})`}
            </button>
          </div>

          <ul className="space-y-2">
            {data.contents.map((content) => (
              <li
                key={content.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3.5 py-3"
                style={{
                  borderColor: selected.includes(content.id)
                    ? "var(--color-brand-500)"
                    : "var(--border)",
                }}
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.includes(content.id)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(content.id)
                          ? current.filter((id) => id !== content.id)
                          : [...current, content.id],
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="hint">{POST_TYPE_LABELS[content.type]}</span>
                      {content.mediaIds.length > 0 && (
                        <span className="hint">• {content.mediaIds.length} file</span>
                      )}
                      {(data.scheduledCounts[content.id] ?? 0) > 0 && (
                        <span className="hint">
                          • đã xếp {data.scheduledCounts[content.id]} lượt đăng
                        </span>
                      )}
                    </span>
                    {content.label && (
                      <span className="block text-sm font-semibold">{content.label}</span>
                    )}
                    <span className="line-clamp-2 block text-sm whitespace-pre-wrap">
                      {content.message || content.link || "(không có nội dung)"}
                    </span>
                  </span>
                </label>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    className="btn btn-ghost"
                    disabled={busy !== null}
                    onClick={() => void loadForEdit(content)}
                  >
                    Sửa
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={busy !== null}
                    onClick={() => void remove(content)}
                  >
                    Xoá
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
