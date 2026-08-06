"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PagePicker } from "@/components/page-picker";
import { Alert, Section, Spinner } from "@/components/ui";
import { apiGet, apiSend, apiUpload } from "@/lib/client-api";
import { formatDateTime } from "@/lib/schedule";
import type { PageAccount, PostType } from "@/lib/types";
import { POST_TYPE_LABELS } from "@/lib/types";

interface PreviewRow {
  rowNumber: number;
  type: PostType;
  message: string;
  link: string | null;
  title: string | null;
  mediaPaths: string[];
  scheduledAt: number | null;
  scheduleMode: string;
  pageNames: string[];
  error: string | null;
}

interface PreviewResult {
  total: number;
  validCount: number;
  rows: PreviewRow[];
}

interface CommitResult {
  mode: "library" | "schedule";
  total: number;
  okCount: number;
  postCount: number;
  results: { rowNumber: number; error: string | null }[];
}

type ImportMode = "library" | "schedule";

const SAMPLE_CSV = `message,type,media,scheduled_at,page
"Chào buổi sáng cả nhà!",text,,10/08/2026 08:00,
"Sản phẩm mới về",photo,C:\\anh\\sp1.jpg|C:\\anh\\sp2.jpg,10/08/2026 12:00,Shop A|Shop B
"Video giới thiệu",video,C:\\video\\gioithieu.mp4,11/08/2026 19:30,Shop A
"Xem bài viết mới",text,,12/08/2026 09:00,`;

export default function ImportPage() {
  const router = useRouter();
  const [pages, setPages] = useState<PageAccount[]>([]);
  const [pageRefs, setPageRefs] = useState<number[]>([]);
  const [mode, setMode] = useState<ImportMode>("schedule");
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<PageAccount[]>("/api/pages");
      setPages(data);
      setPageRefs(data.filter((page) => page.isActive && page.canPost).map((page) => page.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setBusy("preview");
    setError(null);
    setCommitResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      setPreview(await apiUpload<PreviewResult>("/api/import/preview", form));
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    if (!preview) return;
    const validRows = preview.rows.filter((row) => !row.error);
    if (validRows.length === 0) {
      setError("Không có dòng nào hợp lệ để nhập.");
      return;
    }

    setBusy("commit");
    setError(null);
    try {
      const result = await apiSend<CommitResult>("/api/import/commit", "POST", {
        rows: validRows.map((row) => ({
          rowNumber: row.rowNumber,
          type: row.type,
          message: row.message,
          link: row.link,
          title: row.title,
          mediaPaths: row.mediaPaths,
          scheduledAt: row.scheduledAt,
          pageNames: row.pageNames,
        })),
        mode,
        pageRefs,
        saveToLibrary,
      });
      setCommitResult(result);
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Nhập bài hàng loạt từ CSV / Excel</h1>
        <p className="hint mt-1">
          Chuẩn bị sẵn nhiều bài trong một file, xem trước rồi nạp vào thư viện hoặc đẩy thẳng lên
          lịch của nhiều Page.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <Section
        title="Định dạng file"
        description="Dòng đầu tiên là tên cột. Chỉ cột nội dung là bắt buộc, các cột còn lại có thể bỏ trống."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ color: "var(--text-muted)" }}>
                <th className="py-1.5 pr-4 font-semibold">Cột</th>
                <th className="py-1.5 pr-4 font-semibold">Tên chấp nhận</th>
                <th className="py-1.5 font-semibold">Ý nghĩa</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {[
                ["Nội dung", "message, noi_dung, content, caption", "Nội dung bài viết"],
                ["Loại", "type, loai", "text / photo / video / reel — bỏ trống sẽ tự đoán"],
                [
                  "File",
                  "media, file, anh, video",
                  "Đường dẫn file trên máy, nhiều file cách nhau bằng dấu |",
                ],
                [
                  "Thời gian",
                  "scheduled_at, thoi_gian, gio_dang",
                  "VD 10/08/2026 09:00 — bỏ trống là đăng ngay",
                ],
                [
                  "Page",
                  "page, trang, fanpage",
                  "Tên Page cần đăng, nhiều Page cách nhau bằng dấu | — bỏ trống thì dùng các Page chọn bên dưới",
                ],
                ["Link", "link, url", "Link đính kèm cho bài chữ"],
                ["Tiêu đề", "title, tieu_de", "Tiêu đề video / Reels"],
              ].map(([col, aliases, meaning]) => (
                <tr key={col} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="py-2 pr-4 font-medium">{col}</td>
                  <td className="py-2 pr-4">
                    <code className="text-xs">{aliases}</code>
                  </td>
                  <td className="hint py-2">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">Xem file CSV mẫu</summary>
          <pre
            className="mt-2 overflow-x-auto rounded-lg p-3 text-xs"
            style={{ backgroundColor: "var(--surface-muted)" }}
          >
            {SAMPLE_CSV}
          </pre>
        </details>
      </Section>

      <Section title="Nhập vào đâu?">
        <div className="space-y-2">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={mode === "schedule"}
              onChange={() => setMode("schedule")}
            />
            <span>
              <strong>Tạo lịch đăng luôn</strong>
              <span className="hint block">
                Mỗi dòng tạo một bài cho từng Page, theo giờ ghi trong cột thời gian.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="radio"
              className="mt-1"
              checked={mode === "library"}
              onChange={() => setMode("library")}
            />
            <span>
              <strong>Chỉ nạp vào thư viện nội dung</strong>
              <span className="hint block">
                Chưa đăng gì cả. Sau đó dùng trang{" "}
                <Link href="/plan" className="font-semibold underline">
                  Lên lịch
                </Link>{" "}
                để rải theo khung giờ tự động.
              </span>
            </span>
          </label>
        </div>

        {mode === "schedule" && (
          <label className="mt-3 flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={saveToLibrary}
              onChange={(e) => setSaveToLibrary(e.target.checked)}
            />
            Đồng thời lưu một bản vào thư viện để dùng lại sau
          </label>
        )}
      </Section>

      {mode === "schedule" && (
        <Section
          title={`Page mặc định (${pageRefs.length})`}
          description="Dùng cho những dòng không ghi cột page. Dòng có ghi cột page sẽ theo đúng tên trong file."
        >
          <PagePicker pages={pages} selected={pageRefs} onChange={setPageRefs} />
        </Section>
      )}

      <Section title="Chọn file" description="Hỗ trợ .csv và .xlsx.">
        <input
          type="file"
          className="field"
          accept=".csv,.xlsx,.xlsm,.txt"
          onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
        />
        {busy === "preview" && (
          <div className="mt-3">
            <Spinner label="Đang đọc file…" />
          </div>
        )}
      </Section>

      {preview && (
        <Section
          title={`Xem trước — ${preview.validCount}/${preview.total} dòng hợp lệ`}
          description="Các dòng có lỗi sẽ bị bỏ qua khi nhập."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ color: "var(--text-muted)" }}>
                  <th className="py-1.5 pr-3 font-semibold">Dòng</th>
                  <th className="py-1.5 pr-3 font-semibold">Loại</th>
                  <th className="py-1.5 pr-3 font-semibold">Nội dung</th>
                  <th className="py-1.5 pr-3 font-semibold">Page</th>
                  <th className="py-1.5 pr-3 font-semibold">Hẹn giờ</th>
                  <th className="py-1.5 font-semibold">Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.rowNumber}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="py-2 pr-3">{row.rowNumber}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{POST_TYPE_LABELS[row.type]}</td>
                    <td className="max-w-xs truncate py-2 pr-3">
                      {row.message || row.link || "—"}
                    </td>
                    <td className="max-w-[10rem] truncate py-2 pr-3">
                      {row.pageNames.length > 0 ? row.pageNames.join(", ") : "Theo lựa chọn ở trên"}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {formatDateTime(row.scheduledAt)}
                    </td>
                    <td className="py-2">
                      {row.error ? (
                        <span className="text-xs" style={{ color: "#b4242a" }}>
                          {row.error}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: "#1a7f42" }}>
                          {row.scheduleMode === "facebook"
                            ? "Facebook giữ lịch"
                            : row.scheduleMode === "local"
                              ? "Phần mềm giữ lịch"
                              : "Đăng ngay"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="btn btn-primary mt-4"
            onClick={() => void commit()}
            disabled={busy !== null || preview.validCount === 0}
          >
            {busy === "commit"
              ? "Đang nhập…"
              : mode === "library"
                ? `Nạp ${preview.validCount} nội dung vào thư viện`
                : `Tạo lịch từ ${preview.validCount} dòng`}
          </button>
        </Section>
      )}

      {commitResult && (
        <Section title={`Kết quả — ${commitResult.okCount}/${commitResult.total} dòng thành công`}>
          {commitResult.results.filter((r) => r.error).length === 0 ? (
            <Alert tone="success">
              {commitResult.mode === "library" ? (
                <>
                  Đã nạp {commitResult.okCount} nội dung vào{" "}
                  <Link href="/contents" className="font-semibold underline">
                    thư viện
                  </Link>
                  .
                </>
              ) : (
                <>
                  Đã tạo {commitResult.postCount} lượt đăng. Phần mềm đang gửi dần lên Facebook —{" "}
                  <Link href="/" className="font-semibold underline">
                    xem hàng đợi
                  </Link>
                  .
                </>
              )}
            </Alert>
          ) : (
            <ul className="space-y-1.5">
              {commitResult.results
                .filter((r) => r.error)
                .map((r) => (
                  <li key={r.rowNumber} className="text-sm" style={{ color: "#b4242a" }}>
                    Dòng {r.rowNumber}: {r.error}
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}
    </div>
  );
}
