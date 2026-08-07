"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PagePicker } from "@/components/page-picker";
import { Alert, Section, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/client-api";
import { defaultPlanConfig } from "@/lib/plan/generate";
import { formatDateTime } from "@/lib/schedule";
import type { Content, PageAccount, PlanConfig, PlanPreview } from "@/lib/types";
import { PLAN_DISTRIBUTION_LABELS, POST_TYPE_LABELS, WEEKDAY_LABELS } from "@/lib/types";

/**
 * Len lich dang tu dong.
 *
 * Chon danh sach noi dung + danh sach Page + quy tac rai bai, phan mem
 * sinh ra ma tran "noi dung x Page x thoi diem" de xem truoc, roi tao lich that.
 */

interface ContentsResponse {
  contents: Content[];
  scheduledCounts: Record<number, number>;
}

interface PreviewResponse extends PlanPreview {
  blocked: string | null;
}

interface CommitResponse {
  created: number;
  facebookCount: number;
  localCount: number;
  firstAt: number | null;
  lastAt: number | null;
  warnings: string[];
}

/** So dong toi da hien trong bang xem truoc - danh sach dai chi can thay dau va cuoi. */
const PREVIEW_ROW_LIMIT = 40;

function todayInputValue(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function PlanPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [contents, setContents] = useState<Content[] | null>(null);
  const [pages, setPages] = useState<PageAccount[] | null>(null);
  const [config, setConfig] = useState<PlanConfig>(() =>
    defaultPlanConfig(todayInputValue(), Math.floor(Math.random() * 1_000_000)),
  );
  const [name, setName] = useState("");
  const [slotDraft, setSlotDraft] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [committed, setCommitted] = useState<CommitResponse | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [contentData, pageData] = await Promise.all([
        apiGet<ContentsResponse>("/api/contents"),
        apiGet<PageAccount[]>("/api/pages"),
      ]);
      setContents(contentData.contents);
      setPages(pageData);

      // Noi dung chon san tu trang Thu vien di sang.
      const preselected = (searchParams.get("contents") ?? "")
        .split(",")
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0);

      setConfig((current) => ({
        ...current,
        contentIds: preselected.length > 0 ? preselected : current.contentIds,
        pageRefs:
          current.pageRefs.length > 0
            ? current.pageRefs
            : pageData.filter((page) => page.isActive && page.canPost).map((page) => page.id),
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  // Doi cau hinh thi ban xem truoc cu khong con dung nua.
  const patchConfig = (patch: Partial<PlanConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setPreview(null);
    setCommitted(null);
  };

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    setCommitted(null);
    try {
      setPreview(await apiSend<PreviewResponse>("/api/plans/preview", "POST", config));
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
    } finally {
      setBusy(null);
    }
  };

  const commit = async () => {
    setBusy("commit");
    setError(null);
    try {
      const result = await apiSend<CommitResponse>("/api/plans", "POST", {
        name: name.trim() || `Lịch ngày ${config.startDate}`,
        config,
      });
      setCommitted(result);
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (contents === null || pages === null) {
    return (
      <div className="py-10">
        <Spinner label="Đang tải nội dung và Page…" />
      </div>
    );
  }

  const addSlot = () => {
    const value = slotDraft.trim();
    if (!value || config.slots.includes(value)) return;
    patchConfig({ slots: [...config.slots, value].sort() });
    setSlotDraft("");
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Lên lịch đăng tự động</h1>
        <p className="hint mt-1">
          Chọn nội dung, chọn Page, đặt khung giờ — phần mềm tự xếp toàn bộ lịch đăng cho bạn.
        </p>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      {committed && (
        <Alert tone="success">
          Đã tạo <strong>{committed.created} lượt đăng</strong>, từ{" "}
          {formatDateTime(committed.firstAt)} đến {formatDateTime(committed.lastAt)}.{" "}
          {committed.facebookCount > 0 &&
            `${committed.facebookCount} bài đang được đẩy dần lên Facebook (tối đa 8 bài mỗi phút) — sau khi đẩy xong bạn có thể tắt máy. `}
          {committed.localCount > 0 &&
            `${committed.localCount} bài do phần mềm giữ lịch, cần để phần mềm chạy đến giờ đăng. `}
          <Link href="/" className="font-semibold underline">
            Xem hàng đợi
          </Link>
        </Alert>
      )}

      <Section
        title={`Bước 1 — Chọn nội dung (${config.contentIds.length}/${contents.length})`}
        description="Mỗi khung giờ sẽ lấy ra một nội dung theo đúng thứ tự trong danh sách này."
      >
        {contents.length === 0 ? (
          <Alert tone="warning">
            Thư viện chưa có nội dung nào.{" "}
            <Link href="/contents" className="font-semibold underline">
              Thêm nội dung
            </Link>{" "}
            hoặc{" "}
            <Link href="/import" className="font-semibold underline">
              nhập từ file CSV/Excel
            </Link>
            .
          </Alert>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <button
                className="btn btn-ghost"
                onClick={() =>
                  patchConfig({
                    contentIds:
                      config.contentIds.length === contents.length
                        ? []
                        : contents.map((content) => content.id),
                  })
                }
              >
                {config.contentIds.length === contents.length
                  ? "Bỏ chọn tất cả"
                  : `Chọn tất cả (${contents.length})`}
              </button>
              <Link href="/contents" className="hint font-semibold underline">
                Quản lý thư viện
              </Link>
            </div>

            <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {contents.map((content) => (
                <li key={content.id}>
                  <label
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2"
                    style={{
                      borderColor: config.contentIds.includes(content.id)
                        ? "var(--color-brand-500)"
                        : "var(--border)",
                    }}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={config.contentIds.includes(content.id)}
                      onChange={() =>
                        patchConfig({
                          contentIds: config.contentIds.includes(content.id)
                            ? config.contentIds.filter((id) => id !== content.id)
                            : [...config.contentIds, content.id],
                        })
                      }
                    />
                    <span className="min-w-0">
                      <span className="hint block">{POST_TYPE_LABELS[content.type]}</span>
                      <span className="line-clamp-1 block text-sm">
                        {content.label || content.message || content.link || "(không có nội dung)"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section
        title={`Bước 2 — Chọn Page (${config.pageRefs.length})`}
        description="Thứ tự chọn quyết định Page nào đăng trước khi có độ lệch giờ."
      >
        <PagePicker
          pages={pages}
          selected={config.pageRefs}
          onChange={(pageRefs) => patchConfig({ pageRefs })}
        />
      </Section>

      <Section title="Bước 3 — Quy tắc rải bài">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="startDate">
              Bắt đầu từ ngày
            </label>
            <input
              id="startDate"
              type="date"
              className="field"
              value={config.startDate}
              onChange={(e) => patchConfig({ startDate: e.target.value })}
            />
          </div>

          <div>
            <label className="label" htmlFor="stagger">
              Lệch giờ giữa các Page (phút)
            </label>
            <input
              id="stagger"
              type="number"
              min={0}
              max={720}
              className="field"
              value={config.pageStaggerMinutes}
              onChange={(e) => patchConfig({ pageStaggerMinutes: Number(e.target.value) || 0 })}
            />
            <p className="hint mt-1">
              Tránh đăng cùng một nội dung lên mọi Page đúng cùng một phút.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Khung giờ trong ngày</label>
          <div className="flex flex-wrap items-center gap-2">
            {config.slots.map((slot) => (
              <span
                key={slot}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold"
                style={{
                  backgroundColor: "var(--color-brand-50)",
                  color: "var(--color-brand-700)",
                }}
              >
                {slot}
                <button
                  onClick={() => patchConfig({ slots: config.slots.filter((s) => s !== slot) })}
                  aria-label={`Bỏ khung giờ ${slot}`}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="time"
              className="field max-w-[9rem]"
              value={slotDraft}
              onChange={(e) => setSlotDraft(e.target.value)}
            />
            <button className="btn btn-ghost" onClick={addSlot} disabled={!slotDraft}>
              Thêm khung giờ
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Các thứ được đăng</label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_LABELS.map((label, index) => {
              const active = config.weekdays.includes(index);
              return (
                <button
                  key={label}
                  className="btn"
                  style={{
                    backgroundColor: active ? "var(--color-brand-500)" : "transparent",
                    color: active ? "#fff" : "var(--text)",
                    borderColor: active ? "var(--color-brand-500)" : "var(--border)",
                  }}
                  onClick={() =>
                    patchConfig({
                      weekdays: active
                        ? config.weekdays.filter((day) => day !== index)
                        : [...config.weekdays, index],
                    })
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4">
          <label className="label">Cách rải nội dung lên Page</label>
          <div className="space-y-2">
            {(["broadcast", "rotate"] as const).map((value) => (
              <label key={value} className="flex items-start gap-2.5 text-sm">
                <input
                  type="radio"
                  className="mt-1"
                  checked={config.distribution === value}
                  onChange={() => patchConfig({ distribution: value })}
                />
                <span>{PLAN_DISTRIBUTION_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Thứ tự lấy nội dung</label>
            <select
              className="field"
              value={config.contentOrder}
              onChange={(e) =>
                patchConfig({ contentOrder: e.target.value as PlanConfig["contentOrder"] })
              }
            >
              <option value="sequential">Theo đúng thứ tự trong danh sách</option>
              <option value="shuffle">Xáo trộn ngẫu nhiên</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="maxPosts">
              Giới hạn số bài tạo ra
            </label>
            <input
              id="maxPosts"
              type="number"
              min={1}
              max={1000}
              className="field"
              value={config.maxPosts}
              onChange={(e) => patchConfig({ maxPosts: Number(e.target.value) || 1 })}
            />
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={config.repeatContents}
            onChange={(e) => patchConfig({ repeatContents: e.target.checked })}
          />
          Dùng hết nội dung thì quay lại từ đầu (đăng lặp cho tới khi chạm giới hạn)
        </label>

        <button
          className="btn btn-primary mt-5"
          onClick={() => void runPreview()}
          disabled={busy !== null || config.contentIds.length === 0 || config.pageRefs.length === 0}
        >
          {busy === "preview" ? "Đang tính lịch…" : "Xem trước lịch"}
        </button>
      </Section>

      {preview && (
        <Section
          title={`Bước 4 — Xem trước: ${preview.total} lượt đăng`}
          description={
            preview.total > 0
              ? `Từ ${formatDateTime(preview.firstAt)} đến ${formatDateTime(preview.lastAt)}.`
              : undefined
          }
        >
          {preview.warnings.map((warning) => (
            <div key={warning} className="mb-3">
              <Alert tone="warning">{warning}</Alert>
            </div>
          ))}

          {preview.blocked ? (
            <Alert tone="error">{preview.blocked}</Alert>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-2">
                {preview.perPage.map((entry) => (
                  <span
                    key={entry.pageRef}
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={{ backgroundColor: "var(--surface-muted)", color: "var(--text)" }}
                  >
                    {entry.pageName}: {entry.count} bài
                  </span>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left" style={{ color: "var(--text-muted)" }}>
                      <th className="py-1.5 pr-3 font-semibold">Thời điểm</th>
                      <th className="py-1.5 pr-3 font-semibold">Page</th>
                      <th className="py-1.5 pr-3 font-semibold">Nội dung</th>
                      <th className="py-1.5 font-semibold">Ai giữ lịch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.posts.slice(0, PREVIEW_ROW_LIMIT).map((post, index) => (
                      <tr
                        key={`${post.pageRef}-${post.scheduledAt}-${index}`}
                        className="border-t"
                        style={{ borderColor: "var(--border)" }}
                      >
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatDateTime(post.scheduledAt)}
                        </td>
                        <td className="py-2 pr-3 whitespace-nowrap">{post.pageName}</td>
                        <td className="max-w-xs truncate py-2 pr-3">{post.contentLabel}</td>
                        <td className="py-2 whitespace-nowrap">
                          <span
                            className="text-xs font-semibold"
                            style={{
                              color: post.scheduleMode === "facebook" ? "#1a7f42" : "#8a5a05",
                            }}
                          >
                            {post.scheduleMode === "facebook" ? "Facebook" : "Phần mềm"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {preview.total > PREVIEW_ROW_LIMIT && (
                <p className="hint mt-2">
                  Đang hiện {PREVIEW_ROW_LIMIT} dòng đầu trong tổng số {preview.total} lượt đăng.
                </p>
              )}

              <div className="mt-5 max-w-md">
                <label className="label" htmlFor="planName">
                  Tên kế hoạch
                </label>
                <input
                  id="planName"
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`Lịch ngày ${config.startDate}`}
                />
              </div>

              <button
                className="btn btn-primary mt-4"
                onClick={() => void commit()}
                disabled={busy !== null || preview.total === 0}
              >
                {busy === "commit" ? "Đang tạo lịch…" : `Tạo lịch ${preview.total} bài`}
              </button>
            </>
          )}
        </Section>
      )}
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense
      fallback={
        <div className="py-10">
          <Spinner label="Đang tải…" />
        </div>
      }
    >
      <PlanPageInner />
    </Suspense>
  );
}
