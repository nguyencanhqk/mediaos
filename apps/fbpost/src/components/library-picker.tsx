"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/lib/client-api";
import type { MediaFile, MediaKind } from "@/lib/types";
import { Alert, Spinner } from "./ui";

/**
 * Chon file tu KHO VIDEO doc theo thu muc (o dia chia se trong LAN hoac thu muc tren may chu).
 *
 * Vi sao co man nay ben canh o upload: upload qua trinh duyet dinh hai tran cung — 96MB cua
 * middleware Next va 100MB cua proxy Cloudflare. Video nang di duong nay thi khong qua HTTP chut
 * nao: may chu tu chep file tu o chia se vao kho, nen khong con tran nao.
 */

interface LibraryEntry {
  name: string;
  relativePath: string;
}

interface LibraryFileEntry extends LibraryEntry {
  size: number;
  modifiedAt: number;
  kind: MediaKind;
}

interface LibraryListing {
  roots: { key: string; label: string }[];
  rootKey: string;
  relativePath: string;
  breadcrumbs: LibraryEntry[];
  directories: LibraryEntry[];
  files: LibraryFileEntry[];
}

interface ImportResult {
  path: string;
  media: MediaFile | null;
  error: string | null;
}

/** Moi lan bam nap toi da 50 file — trung voi gioi han phia may chu. */
const MAX_PER_BATCH = 50;

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface LibraryPickerProps {
  /** Chi cho chon dung mot file (bai video/reel chi nhan mot). */
  singleOnly?: boolean;
  /** Loc theo loai — bai anh khong nen thay video va nguoc lai. */
  kind?: MediaKind;
  onPicked: (media: MediaFile[]) => void;
  onClose: () => void;
}

export function LibraryPicker({ singleOnly, kind, onPicked, onClose }: LibraryPickerProps) {
  const [listing, setListing] = useState<LibraryListing | null>(null);
  const [rootKey, setRootKey] = useState("");
  const [dir, setDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<ImportResult[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(rootKey ? { root: rootKey, dir } : { dir });
      setListing(await apiGet<LibraryListing>(`/api/library?${params.toString()}`));
    } catch (e) {
      setError((e as Error).message);
      setListing(null);
    } finally {
      setLoading(false);
    }
  }, [rootKey, dir]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDir = (relativePath: string) => {
    setSelected([]);
    setDir(relativePath);
  };

  const toggle = (relativePath: string) => {
    setSelected((current) => {
      if (current.includes(relativePath)) return current.filter((p) => p !== relativePath);
      if (singleOnly) return [relativePath];
      if (current.length >= MAX_PER_BATCH) return current;
      return [...current, relativePath];
    });
  };

  const handleImport = async () => {
    if (selected.length === 0) return;
    setImporting({ done: 0, total: selected.length });
    setFailures([]);
    try {
      // Goi mot request cho ca me: may chu chep TUAN TU va tra ve ket qua tung file. Chia nho
      // thanh nhieu request de "chay thanh tien do" chi lam nhieu ket noi song song tren cung mot
      // duong LAN, khong nhanh hon.
      const results = await apiSend<ImportResult[]>("/api/library/import", "POST", {
        items: selected.map((p) => ({ root: listing?.rootKey ?? rootKey, path: p })),
      });
      const media = results.map((r) => r.media).filter((m): m is MediaFile => m !== null);
      const failed = results.filter((r) => r.media === null);
      setFailures(failed);
      if (media.length > 0) onPicked(media);
      // Con file hong thi GIU man nay lai de nguoi dung doc duoc loi; xong sach thi dong.
      if (failed.length === 0) onClose();
      else setSelected([]);
    } catch (e) {
      setFailures([{ path: "", media: null, error: (e as Error).message }]);
    } finally {
      setImporting(null);
    }
  };

  const files = kind ? (listing?.files ?? []).filter((f) => f.kind === kind) : (listing?.files ?? []);
  const noRoots = listing !== null && listing.roots.length === 0;

  return (
    <div className="mt-3 rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold">Kho video</h3>
        <button type="button" className="btn btn-ghost text-sm" onClick={onClose}>
          Đóng
        </button>
      </div>

      {noRoots ? (
        <Alert tone="warning">
          Chưa có kho video nào. Mở tab <strong>Kho video</strong> để thêm thư mục.
        </Alert>
      ) : (
        <>
          {listing && listing.roots.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1">
              {listing.roots.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium"
                  style={{
                    backgroundColor:
                      r.key === listing.rootKey ? "var(--color-brand-50)" : "transparent",
                    color: r.key === listing.rootKey ? "var(--color-brand-700)" : "var(--text-muted)",
                  }}
                  onClick={() => {
                    setSelected([]);
                    setDir("");
                    setRootKey(r.key);
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          )}

          {listing && (
            <nav className="hint mb-2 flex flex-wrap items-center gap-1">
              {listing.breadcrumbs.map((crumb, i) => (
                <span key={crumb.relativePath || "__root"} className="flex items-center gap-1">
                  {i > 0 && <span aria-hidden>/</span>}
                  <button
                    type="button"
                    className="underline-offset-2 hover:underline"
                    onClick={() => openDir(crumb.relativePath)}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
          )}

          {error && <Alert tone="error">{error}</Alert>}
          {loading && <Spinner label="Đang đọc thư mục…" />}

          {!loading && listing && (
            <div
              className="max-h-80 overflow-y-auto rounded-lg border"
              style={{ borderColor: "var(--border)" }}
            >
              {listing.directories.map((d) => (
                <button
                  key={d.relativePath}
                  type="button"
                  className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm"
                  style={{ borderColor: "var(--border)" }}
                  onClick={() => openDir(d.relativePath)}
                >
                  <span aria-hidden>📁</span>
                  <span className="font-medium">{d.name}</span>
                </button>
              ))}

              {files.map((f) => {
                const checked = selected.includes(f.relativePath);
                return (
                  <label
                    key={f.relativePath}
                    className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <input
                      type={singleOnly ? "radio" : "checkbox"}
                      checked={checked}
                      onChange={() => toggle(f.relativePath)}
                    />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="hint shrink-0">{formatSize(f.size)}</span>
                    <span className="hint hidden shrink-0 sm:inline">
                      {formatDate(f.modifiedAt)}
                    </span>
                  </label>
                );
              })}

              {listing.directories.length === 0 && files.length === 0 && (
                <p className="hint px-3 py-4">Thư mục này không có ảnh/video nào.</p>
              )}
            </div>
          )}

          {failures.length > 0 && (
            <div className="mt-3">
              <Alert tone="error">
                <p className="font-semibold">{failures.length} file không nạp được:</p>
                <ul className="mt-1 list-disc pl-5">
                  {failures.map((f) => (
                    <li key={f.path}>
                      {f.path ? `${f.path}: ` : ""}
                      {f.error}
                    </li>
                  ))}
                </ul>
              </Alert>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary"
              disabled={selected.length === 0 || importing !== null}
              onClick={() => void handleImport()}
            >
              Nạp {selected.length > 0 ? `${selected.length} file` : "file đã chọn"}
            </button>
            {importing && (
              <Spinner
                label={`Đang chép ${importing.total} file từ kho… (video nặng có thể mất vài chục giây)`}
              />
            )}
            {!importing && selected.length >= MAX_PER_BATCH && (
              <span className="hint">Tối đa {MAX_PER_BATCH} file mỗi lần.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
