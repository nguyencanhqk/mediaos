/**
 * S16-SOCIAL-FE-3B (L5) — nút «Xuất Excel» của màn Thống kê tương tác (`SOCIAL-API-053`, tệp XLSX).
 *
 * ┌─ KHÔNG CÓ CỔNG QUYỀN RIÊNG ────────────────────────────────────────────────────────────────────────┐
 * │ 052 (xem) và 053 (tải) CÙNG cặp `view:feed-report`, cùng sàn phạm vi (plan M6) ⇒ ai vào được màn thì │
 * │ tải được tệp. Cổng là của ROUTE (`ROUTE_REGISTRY`); thêm `useCan` ở đây chỉ tạo một bản chép thứ hai │
 * │ của cùng cặp. Server vẫn là cổng thật: 403 ra dải lỗi, không tải tệp.                                │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Xuất ĐÚNG thứ đang xem: `params` là tham số của lượt đọc 052 đang hiển thị — nút không tự suy khoảng.
 *
 * Lượt xuất đi qua `useGuardedMutation` (một cơ chế cho mọi lượt gửi của cụm quản trị — bài học PR-A):
 *  · khoá ĐỒNG BỘ ⇒ bấm đúp cùng nhịp vẫn là MỘT lời gọi (mỗi lời gọi 053 ghi một dòng audit);
 *  · hạn chờ 30 giây + `networkMode: "always"` ⇒ yêu cầu treo / mất mạng không khoá nút vô hạn; phản hồi về
 *    SAU hạn bị bỏ qua (không có tệp «tự tải» sau khi đã báo lỗi). `exportEngagement` của web-core không nhận
 *    `signal` nên yêu cầu trên dây KHÔNG bị huỷ — chỉ kết quả của nó bị bỏ.
 *  · mọi lỗi ra dải `AdminErrorNotice` cạnh nút; `message` của server không lên màn.
 *
 * KHÔNG tải tệp hỏng: 2xx mà thân rỗng, hoặc là trang HTML / JSON (proxy, SPA fallback trả 200) ⇒ coi là lỗi.
 *
 * Tên tệp: của server nếu đọc được; `Content-Disposition` bị trình duyệt giấu khi gọi khác origin (API chưa
 * khai `exposedHeaders` — plan M15) ⇒ tên dự phòng `social-tuong-tac-<from>_<to>.xlsx` theo `range` đang xem.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@mediaos/ui";
import { socialStatsApi, type ApiBlobResult, type FeedEngagementParams } from "@mediaos/web-core";
import { triggerBlobDownload } from "@/lib/download-blob";
import { AdminErrorNotice } from "../../admin/components/AdminErrorNotice";
import { useGuardedMutation } from "../../admin/lib/use-guarded-mutation";
import {
  StatsExportFileError,
  describeStatsError,
  type StatsErrorOutcome,
} from "../lib/stats-errors";
import type { StatsDateRange } from "../lib/stats-route-search";

export interface ExportEngagementButtonProps {
  /** Tham số của lượt đọc 052 đang hiển thị — gửi NGUYÊN cho 053. */
  params: FeedEngagementParams;
  /** `range` của response đang hiển thị; `null` = chưa có dữ liệu ⇒ nút khoá. */
  range: StatsDateRange | null;
}

interface ExportRequest {
  params: FeedEngagementParams;
  fallbackFilename: string;
}

interface ExportFailure extends StatsErrorOutcome {
  /** Tham số của lượt xuất đã hỏng — dải lỗi chỉ thuộc về ĐÚNG bộ tham số đó. */
  paramsKey: string;
}

const FALLBACK_PREFIX = "social-tuong-tac";
const FALLBACK_EXTENSION = ".xlsx";
/** Kiểu thân mà một tệp XLSX không bao giờ mang — dấu hiệu proxy / SPA fallback trả 200 thay cho API. */
const NOT_A_FILE_TYPES = ["text/", "application/json"] as const;

function fallbackFilenameFor(range: StatsDateRange): string {
  return `${FALLBACK_PREFIX}-${range.from}_${range.to}${FALLBACK_EXTENSION}`;
}

function isUsableFile(blob: Blob): boolean {
  return blob.size > 0 && !NOT_A_FILE_TYPES.some((type) => blob.type.startsWith(type));
}

/** Nhận diện một bộ tham số (thứ tự khoá cố định) — để biết dải lỗi còn thuộc về thứ đang xem không. */
function paramsKeyOf(params: FeedEngagementParams): string {
  return JSON.stringify([params.from ?? null, params.to ?? null, params.orgUnitId ?? null]);
}

async function fetchExport(request: ExportRequest): Promise<ApiBlobResult> {
  const result = await socialStatsApi.exportEngagement(request.params);
  if (!isUsableFile(result.blob)) throw new StatsExportFileError();
  return result;
}

interface EngagementExport {
  isPending: boolean;
  /** Lỗi của lượt xuất gần nhất, CHỈ khi nó thuộc về đúng bộ tham số đang xem. */
  failure: StatsErrorOutcome | null;
  runExport: () => void;
  dismissFailure: () => void;
}

/** Lượt xuất 053 + dải lỗi của nó. `range: null` (chưa có dữ liệu) ⇒ `runExport` không làm gì. */
function useEngagementExport({ params, range }: ExportEngagementButtonProps): EngagementExport {
  const [failure, setFailure] = React.useState<ExportFailure | null>(null);

  const { isPending, start } = useGuardedMutation<ApiBlobResult, ExportRequest>({
    mutationFn: fetchExport,
    onSuccess: (result, request) => {
      setFailure(null);
      triggerBlobDownload(result.blob, result.filename ?? request.fallbackFilename);
    },
    onError: (error, request) => {
      setFailure({
        ...describeStatsError(error, request.params),
        paramsKey: paramsKeyOf(request.params),
      });
    },
  });

  const runExport = (): void => {
    if (range === null) return;
    if (start({ params, fallbackFilename: fallbackFilenameFor(range) })) setFailure(null);
  };

  // Dải lỗi của một lượt xuất CŨ không được đứng cạnh số liệu của bộ lọc khác.
  const isCurrent = failure !== null && failure.paramsKey === paramsKeyOf(params);
  return {
    isPending,
    failure: isCurrent ? failure : null,
    runExport,
    dismissFailure: () => setFailure(null),
  };
}

export function ExportEngagementButton({
  params,
  range,
}: ExportEngagementButtonProps): React.ReactElement {
  const { t } = useTranslation("social");
  const { isPending, failure, runExport, dismissFailure } = useEngagementExport({ params, range });
  const visibleFailure = isPending ? null : failure;

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending || range === null}
        aria-busy={isPending ? true : undefined}
        onClick={runExport}
        data-testid="stats-export-button"
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
        )}
        {t(isPending ? "admin.stats.export.exporting" : "admin.stats.export.button")}
      </Button>
      {visibleFailure !== null && (
        <AdminErrorNotice
          reason={visibleFailure.reason}
          onRetry={visibleFailure.recovery === "retry" ? runExport : undefined}
          onDismiss={dismissFailure}
        />
      )}
    </div>
  );
}
