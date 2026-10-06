/**
 * S16-SOCIAL-FE-3 (L2) — THẺ của một báo cáo vi phạm trong hàng đợi `SOC-SCREEN-010` (SOCIAL-API-028).
 *
 * Trình bày thuần: chỉ vẽ cái DTO trả, không gọi API. Bấm «Xử lý» gọi `onResolve` — hộp thoại là việc của
 * nơi gọi.
 *
 * ┌─ BỐN ĐIỀU DỄ LÀM SAI ────────────────────────────────────────────────────────────────────────────┐
 * │ 1. `reporter === null` = BỊ CHE theo phạm vi xem (server cố ý, D13-a) ≠ object có                  │
 * │    `employeeId === null` = hồ sơ nhân sự không còn. Hai nhãn khác nhau, không gộp.                 │
 * │ 2. Báo cáo BÌNH LUẬN: `targetSnapshot.author*` / `status` / `deletedAt` / `postId` là của BÀI CHA; │
 * │    chỉ `bodyExcerpt` là của bình luận (plan M2b). DTO không có tác giả bình luận ⇒ câu chữ đi theo │
 * │    `targetType`, và link ngữ cảnh dùng `targetSnapshot.postId` — KHÔNG phải `targetId`.            │
 * │ 3. Avatar chỉ vẽ theo TÊN, không truyền `src` (plan D8): API PROD còn trả cột `avatarUrl` thô.     │
 * │ 4. Cổng: «Xử lý» ⇔ báo cáo đang mở && `manage:feed-report` (`view:feed-report` chỉ được ĐỌC);     │
 * │    link tới bài đang ẩn ⇔ `manage:feed-post` (người khác bấm vào chỉ gặp 404).                     │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Chữ do người dùng nhập (`note` · `resolutionNote` · `bodyExcerpt`) vẽ như văn bản thuần.
 */
import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Avatar, Button, cn } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
import type {
  FeedReportDto,
  FeedReportPersonDto,
  FeedReportTargetSnapshotDto,
} from "@mediaos/contracts";
import { relativeTime } from "../../feed/lib/feed-format";

export interface ReportRowProps {
  report: FeedReportDto;
  /** Bấm «Xử lý» — hộp thoại là việc của nơi gọi. */
  onResolve: (report: FeedReportDto) => void;
}

type ClosedReportStatus = Exclude<FeedReportDto["status"], "open">;
type TargetState = "hidden" | "deleted";

const STATUS_PILL_CLASS: Record<ClosedReportStatus, string> = {
  resolved: "bg-primary/15 text-primary",
  dismissed: "bg-muted text-muted-foreground",
};

const PILL_CLASS = "rounded-full px-2 py-0.5 text-xs font-medium";
const NOTE_CLASS = "mt-2 border-l-2 border-border pl-2 text-sm";
const NOTE_LABEL_CLASS = "block text-xs font-medium text-muted-foreground";
const NOTE_BODY_CLASS = "block whitespace-pre-line break-words text-foreground";

/** Trạng thái của BÀI mà snapshot mang (bài bị báo cáo, hoặc bài CHA của bình luận bị báo cáo). */
function targetStateOf(snapshot: FeedReportTargetSnapshotDto): TargetState | null {
  if (snapshot.deletedAt !== null || snapshot.status === "deleted") return "deleted";
  return snapshot.status === "hidden" ? "hidden" : null;
}

/** Tên + (nếu có) nhãn «hồ sơ không còn» — CÙNG luật cho người báo cáo và người xử lý. */
function PersonIdentity({ person }: { person: FeedReportPersonDto }): React.ReactElement {
  const { t } = useTranslation("social");
  const name = person.fullName?.trim() || t("admin.moderation.row.nameUnknown");
  return (
    <>
      <Avatar name={name} size="sm" />
      <span className="font-medium text-foreground">{name}</span>
      {person.employeeId === null && <span>{t("admin.moderation.row.profileGone")}</span>}
    </>
  );
}

function ReportTarget({ report }: { report: FeedReportDto }): React.ReactElement {
  const { t } = useTranslation("social");
  const snapshot = report.targetSnapshot;

  if (snapshot === null) {
    return (
      <p className="mt-2 rounded-md border border-dashed border-border p-2 text-sm italic text-muted-foreground">
        {t("admin.moderation.row.contentGone")}
      </p>
    );
  }

  const state = targetStateOf(snapshot);
  const authorName = snapshot.authorFullName?.trim() || t("admin.moderation.row.nameUnknown");

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Avatar name={authorName} size="sm" />
        <span data-testid="report-target-identity">
          {t(`admin.moderation.row.identity.${report.targetType}`, { name: authorName })}
        </span>
        {state !== null && (
          <span data-testid="report-target-state" className="font-medium text-destructive">
            {t(`admin.moderation.row.state.${report.targetType}.${state}`)}
          </span>
        )}
      </div>
      {snapshot.bodyExcerpt !== null && (
        <p
          data-testid="report-excerpt"
          className="mt-1 line-clamp-4 whitespace-pre-line break-words text-sm text-foreground"
        >
          {snapshot.bodyExcerpt}
        </p>
      )}
    </div>
  );
}

/** Phần chỉ có ở hàng ĐÃ kết thúc: ai xử lý · khi nào · ghi chú xử lý (nếu server trả). */
function ReportResolution({ report }: { report: FeedReportDto }): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <>
      {(report.resolvedBy !== null || report.resolvedAt !== null) && (
        <p
          data-testid="report-resolved-by"
          className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          {report.resolvedBy !== null && (
            <>
              <span>{t("admin.moderation.row.resolvedByLabel")}</span>
              <PersonIdentity person={report.resolvedBy} />
            </>
          )}
          {report.resolvedAt !== null && (
            <time dateTime={report.resolvedAt}>{relativeTime(report.resolvedAt)}</time>
          )}
        </p>
      )}
      {report.resolutionNote !== null && (
        <blockquote data-testid="report-resolution-note" className={NOTE_CLASS}>
          <span className={NOTE_LABEL_CLASS}>{t("admin.moderation.row.resolutionNoteLabel")}</span>
          <span className={NOTE_BODY_CLASS}>{report.resolutionNote}</span>
        </blockquote>
      )}
    </>
  );
}

export function ReportRow({ report, onResolve }: ReportRowProps): React.ReactElement {
  const { t } = useTranslation("social");
  const canManageReports = useCan("manage", "feed-report");
  const canManagePosts = useCan("manage", "feed-post");

  const snapshot = report.targetSnapshot;
  const targetState = snapshot === null ? null : targetStateOf(snapshot);
  const contextPostId =
    snapshot !== null && targetState !== "deleted" && (targetState !== "hidden" || canManagePosts)
      ? snapshot.postId
      : null;
  const canResolve = report.status === "open" && canManageReports;

  return (
    <article
      data-testid="report-row"
      data-report-id={report.id}
      data-status={report.status}
      className="rounded-lg border border-border bg-card p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span
          data-testid="report-reason"
          className={cn(PILL_CLASS, "bg-destructive/10 text-destructive")}
        >
          {t(`admin.report.reason.${report.reason}`)}
        </span>
        <span
          data-testid="report-target-type"
          className={cn(PILL_CLASS, "bg-muted text-muted-foreground")}
        >
          {t(`admin.moderation.row.targetType.${report.targetType}`)}
        </span>
        {report.status !== "open" && (
          <span
            data-testid="report-status-pill"
            className={cn(PILL_CLASS, STATUS_PILL_CLASS[report.status])}
          >
            {t(`admin.moderation.row.status.${report.status}`)}
          </span>
        )}
        <time dateTime={report.createdAt} className="ml-auto text-xs text-muted-foreground">
          {relativeTime(report.createdAt)}
        </time>
      </header>

      <ReportTarget report={report} />

      <p
        data-testid="report-reporter"
        className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      >
        <span>{t("admin.moderation.row.reporterLabel")}</span>
        {report.reporter === null ? (
          <span className="italic">{t("admin.moderation.row.reporterMasked")}</span>
        ) : (
          <PersonIdentity person={report.reporter} />
        )}
      </p>

      {report.note !== null && (
        <blockquote data-testid="report-note" className={NOTE_CLASS}>
          <span className={NOTE_LABEL_CLASS}>{t("admin.moderation.row.noteLabel")}</span>
          <span className={NOTE_BODY_CLASS}>{report.note}</span>
        </blockquote>
      )}

      {report.status !== "open" && <ReportResolution report={report} />}

      {(contextPostId !== null || canResolve) && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {contextPostId !== null && (
            <Link
              to="/feed/posts/$postId"
              params={{ postId: contextPostId }}
              className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("admin.moderation.row.viewInContext")}
            </Link>
          )}
          {canResolve && (
            <Button type="button" size="sm" onClick={() => onResolve(report)}>
              {t("admin.moderation.row.resolve")}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
