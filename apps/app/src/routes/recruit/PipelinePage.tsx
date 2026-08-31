import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, RefreshCw } from "lucide-react";
import { recruitApi, recruitKeys, useCan, useCanExact } from "@mediaos/web-core";
import type { CandidateListItemResponseDto, CandidateStageDto } from "@mediaos/contracts";
import { Badge, Button, EmptyState, Input, PageHeader, Select, Skeleton } from "@mediaos/ui";
import { RECRUIT_COLLAPSED_STAGES, RECRUIT_ENGINE_PAIRS, RECRUIT_STAGE_COLUMNS } from "./constants";
import { CandidateStageBadge } from "./components/StatusBadges";
import { MoveStageDialog } from "./components/MoveStageDialog";
import { parseRecruitError, recruitErrorI18nKey } from "./recruit-errors";
import { useDebouncedValue } from "./use-debounced-value";

interface PipelinePageProps {
  onOpenCandidate: (id: string) => void;
  onCreateCandidate: () => void;
}

const STAGE_PAGE_SIZE = 50;

/**
 * Một ô CSV bắt đầu bằng `=`/`+`/`-`/`@` bị Excel/Sheets diễn giải thành CÔNG THỨC khi mở file — dữ
 * liệu người dùng nhập (fullName/source…) có thể chứa các ký tự này. Prefix `'` vô hiệu hoá công thức
 * mà KHÔNG đổi giá trị hiển thị (CSV formula injection — OWASP CSV Injection).
 */
function neutralizeCsvFormula(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

/** Dựng + tải file CSV — export đi qua `apiFetch` (mảng trần), CSV dựng ở CLIENT (KHÔNG apiFetchBlob). */
function downloadCandidatesCsv(rows: readonly CandidateListItemResponseDto[]): void {
  const header = ["fullName", "email", "phone", "source", "stage", "jobOpeningId"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.fullName,
      r.email ?? "",
      r.phone ?? "",
      r.source ?? "",
      r.stage,
      r.jobOpeningId,
    ].map((c) => neutralizeCsvFormula(String(c)));
    lines.push(cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  // KHÔNG có `document`/`URL` (SSR/test node chưa hỗ trợ) ⇒ no-op an toàn, KHÔNG ném (khuôn
  // routes/hr/employees/download-blob.ts — bản sao cục bộ, giữ cô lập feature).
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  a.rel = "noopener";
  // PHẢI append vào document TRƯỚC khi click — Firefox/Safari không kích hoạt download trên anchor
  // chưa gắn vào DOM. Defer revoke qua setTimeout: revoke NGAY SAU click có thể huỷ object URL trước khi
  // trình duyệt kịp bắt đầu tải (race, đặc biệt file lớn).
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * REC-SCREEN-002 (S12-RECRUIT-FE-1) — kanban pipeline ứng viên, 6 cột stage cố định. Hired/Rejected
 * thu gọn mặc định (`RECRUIT_COLLAPSED_STAGES`) — chỉ tải danh sách của cột đang MỞ (một truy vấn/cột
 * mở), cột đóng chỉ hiện số đếm từ `GET /candidates/summary`.
 *
 * `view`/`create`/`export`/`move-stage`:`candidate` là SENSITIVE (7 cặp, mig 0560) ⇒ gate bằng
 * `useCanExact` — wildcard `*:*` KHÔNG kế thừa các cặp này.
 */
export function PipelinePage({ onOpenCandidate, onCreateCandidate }: PipelinePageProps) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();

  const canView = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateList.action,
    RECRUIT_ENGINE_PAIRS.candidateList.resourceType,
  );
  const canCreate = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateCreate.action,
    RECRUIT_ENGINE_PAIRS.candidateCreate.resourceType,
  );
  const canExport = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateExport.action,
    RECRUIT_ENGINE_PAIRS.candidateExport.resourceType,
  );
  const canMoveStage = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateMoveStage.action,
    RECRUIT_ENGINE_PAIRS.candidateMoveStage.resourceType,
  );
  const canViewJobs = useCan(
    RECRUIT_ENGINE_PAIRS.jobOpeningList.action,
    RECRUIT_ENGINE_PAIRS.jobOpeningList.resourceType,
  );

  const [jobOpeningId, setJobOpeningId] = useState("");
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(RECRUIT_COLLAPSED_STAGES);
  const [moveTarget, setMoveTarget] = useState<CandidateListItemResponseDto | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: recruitKeys.jobs.list({ scope: "pipeline-filter" }),
    queryFn: () => recruitApi.listJobOpenings({ per_page: 100 }),
    enabled: canViewJobs,
    staleTime: 60_000,
  });
  const jobTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of jobsQuery.data?.data ?? []) map.set(j.id, j.title);
    return map;
  }, [jobsQuery.data]);

  const summaryQuery = useQuery({
    queryKey: recruitKeys.candidates.summary(),
    queryFn: () => recruitApi.getCandidateSummary(),
    enabled: canView,
    staleTime: 60_000,
  });

  const debouncedQ = useDebouncedValue(q, 300);
  const hasFilters = jobOpeningId !== "" || debouncedQ !== "";
  const baseParams = useMemo(
    () => ({
      ...(jobOpeningId ? { jobOpeningId } : {}),
      ...(debouncedQ ? { q: debouncedQ } : {}),
    }),
    [jobOpeningId, debouncedQ],
  );

  const toggleCollapse = (stage: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: recruitKeys.candidates.allOf() });
  };

  const runExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const rows = await recruitApi.exportCandidates(baseParams);
      downloadCandidatesCsv(rows);
    } catch (err) {
      // Trước đây try/finally KHÔNG catch — ERR-015 (vượt trần export) hay 403 rơi vào im lặng, người
      // dùng chỉ thấy nút hết "đang tải" mà không hiểu vì sao không có file (mục 4 review-gate).
      const info = parseRecruitError(err);
      setExportError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("pipeline.title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw className="mr-2 size-4" />
              {t("states.retry")}
            </Button>
            {canExport && (
              <Button
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={() => void runExport()}
              >
                <Download className="mr-2 size-4" />
                {t("pipeline.exportCsv")}
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={onCreateCandidate}>
                <Plus className="mr-2 size-4" />
                {t("pipeline.addCandidate")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Input
            placeholder={t("pipeline.searchPlaceholder")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Select
          className="w-56"
          value={jobOpeningId}
          onChange={(e) => setJobOpeningId(e.target.value)}
          aria-label={t("pipeline.filterJob")}
        >
          <option value="">{t("pipeline.filterAllJobs")}</option>
          {(jobsQuery.data?.data ?? []).map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </Select>
      </div>

      {exportError && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {exportError}
        </p>
      )}

      {!canView ? (
        <EmptyState title={t("states.error")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {RECRUIT_STAGE_COLUMNS.map((stage) => (
            <StageColumn
              key={stage}
              stage={stage}
              // Đếm từ `/candidates/summary` KHÔNG áp filter jobOpeningId/q ⇒ lệch với cards khi có
              // filter (mục 12 review-gate). Vá: chỉ dùng số summary khi KHÔNG có filter (rẻ, đúng cho
              // ca phổ biến, khớp collapse-optimization); có filter thì cột MỞ tự tính từ
              // `pagination.total` của chính truy vấn đã lọc, cột ĐÓNG không hiện số (honest hơn hiện số
              // sai — "bỏ hẳn số summary ở header cột" khi filter, theo đúng gợi ý review).
              summaryCount={hasFilters ? undefined : (summaryQuery.data?.byStage[stage] ?? 0)}
              params={{ ...baseParams, stage: [stage], per_page: STAGE_PAGE_SIZE }}
              isCollapsed={collapsed.has(stage)}
              onToggle={() => toggleCollapse(stage)}
              jobTitleById={jobTitleById}
              onOpenCandidate={onOpenCandidate}
              onMoveStage={canMoveStage ? setMoveTarget : undefined}
            />
          ))}
        </div>
      )}

      <MoveStageDialog
        open={moveTarget !== null}
        onClose={() => setMoveTarget(null)}
        candidate={moveTarget}
        onDone={() => {}}
      />
    </div>
  );
}

function StageColumn({
  stage,
  summaryCount,
  params,
  isCollapsed,
  onToggle,
  jobTitleById,
  onOpenCandidate,
  onMoveStage,
}: {
  stage: CandidateStageDto;
  /** `undefined` = có filter đang bật, chưa có số đáng tin cho cột ĐÓNG (xem ghi chú gọi component). */
  summaryCount: number | undefined;
  params: Record<string, unknown>;
  isCollapsed: boolean;
  onToggle: () => void;
  jobTitleById: Map<string, string>;
  onOpenCandidate: (id: string) => void;
  onMoveStage: ((candidate: CandidateListItemResponseDto) => void) | undefined;
}) {
  const { t } = useTranslation("recruit");
  const query = useQuery({
    queryKey: recruitKeys.candidates.list(params),
    queryFn: () => recruitApi.listCandidates(params),
    enabled: !isCollapsed,
  });
  // Cột MỞ: số THẬT theo filter hiện hành (pagination.total của chính truy vấn). Cột ĐÓNG: chỉ có số
  // khi KHÔNG filter (summaryCount); có filter mà đóng thì không có nguồn rẻ nào đáng tin ⇒ hiện "—".
  const displayCount = isCollapsed ? summaryCount : (query.data?.pagination?.total ?? summaryCount);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <CandidateStageBadge stage={stage} />
        <span className="text-xs text-muted-foreground">{displayCount ?? "—"}</span>
      </button>

      {!isCollapsed && (
        <div className="max-h-[70vh] space-y-2 overflow-y-auto px-2 pb-2">
          {query.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (query.data?.data ?? []).length === 0 ? (
            <p className="px-1 py-3 text-center text-xs text-muted-foreground">
              {t("pipeline.emptyColumn")}
            </p>
          ) : (
            (query.data?.data ?? []).map((c) => (
              <div key={c.id} className="rounded-md border border-border bg-background p-2 text-sm">
                <button
                  type="button"
                  className="block w-full truncate text-left font-medium hover:underline"
                  onClick={() => onOpenCandidate(c.id)}
                >
                  {c.fullName}
                </button>
                <p className="truncate text-xs text-muted-foreground">
                  {c.source ?? "—"} · {jobTitleById.get(c.jobOpeningId) ?? "—"}
                </p>
                {c.piiMasked && (
                  <Badge variant="muted" className="mt-1">
                    {t("pipeline.piiMaskedBadge")}
                  </Badge>
                )}
                {onMoveStage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-6 px-1 text-xs"
                    onClick={() => onMoveStage(c)}
                  >
                    {t("pipeline.moveStage")}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
