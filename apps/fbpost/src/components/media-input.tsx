"use client";

import { useState } from "react";
import { apiSend, apiUpload } from "@/lib/client-api";
import type { MediaFile, PostType } from "@/lib/types";
import { LibraryPicker } from "./library-picker";
import { Spinner } from "./ui";

/** O chon file dung chung cho trang Soan bai va trang Thu vien noi dung. */

const ACCEPT_BY_TYPE: Record<PostType, string> = {
  text: "",
  photo: "image/*",
  video: "video/*",
  reel: "video/*",
};

interface MediaInputProps {
  type: PostType;
  media: MediaFile[];
  onChange: (media: MediaFile[]) => void;
  onError: (message: string) => void;
  /**
   * Bam Xoa thi lam gi voi file:
   * - 'delete': xoa han khoi kho (dung khi file vua upload cho bai dang moi)
   * - 'detach': chi bo khoi danh sach (dung khi sua noi dung co san, vi file
   *   co the dang duoc cac bai da xep lich su dung)
   */
  removeMode?: "delete" | "detach";
}

export function MediaInput({
  type,
  media,
  onChange,
  onError,
  removeMode = "delete",
}: MediaInputProps) {
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const singleOnly = type === "video" || type === "reel";

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append("files", file));
      const saved = await apiUpload<MediaFile[]>("/api/media", form);
      onChange(singleOnly ? saved.slice(0, 1) : [...media, ...saved]);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const removeMedia = (id: number) => {
    onChange(media.filter((m) => m.id !== id));
    if (removeMode === "delete") {
      void apiSend(`/api/media/${id}`, "DELETE").catch(() => undefined);
    }
  };

  return (
    <>
      <input
        type="file"
        className="field"
        accept={ACCEPT_BY_TYPE[type]}
        multiple={!singleOnly}
        onChange={(e) => void handleUpload(e.target.files)}
      />
      {uploading && (
        <div className="mt-3">
          <Spinner label="Đang tải file lên…" />
        </div>
      )}

      {type !== "text" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost text-sm"
            onClick={() => setPickerOpen((open) => !open)}
          >
            {pickerOpen ? "Ẩn kho video" : "Chọn từ kho video"}
          </button>
          {/* Noi ro tran o day, canh chinh o upload — nguoi dung gap loi la gap ngay tai day. */}
          <span className="hint">
            File nặng hơn 96 MB phải lấy từ kho video (tải qua trình duyệt sẽ bị chặn).
          </span>
        </div>
      )}

      {pickerOpen && (
        <LibraryPicker
          singleOnly={singleOnly}
          kind={type === "photo" ? "image" : "video"}
          onPicked={(picked) => onChange(singleOnly ? picked.slice(0, 1) : [...media, ...picked])}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {media.length > 0 && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {media.map((item) => (
            <li
              key={item.id}
              className="overflow-hidden rounded-lg border"
              style={{ borderColor: "var(--border)" }}
            >
              {item.kind === "image" ? (
                // Anh xem truoc lay tu chinh may chu nay (/api/media/:id/file) nen khong qua
                // next/image: file cuc bo, kich thuoc nho, khong can toi uu CDN.
                <img
                  src={`/api/media/${item.id}/file`}
                  alt={item.originalName}
                  className="h-32 w-full object-cover"
                />
              ) : (
                <video src={`/api/media/${item.id}/file`} className="h-32 w-full object-cover" />
              )}
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="hint truncate">{item.originalName}</span>
                <button
                  className="text-xs font-semibold"
                  style={{ color: "#d9484d" }}
                  onClick={() => removeMedia(item.id)}
                >
                  Xoá
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
