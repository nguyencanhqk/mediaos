import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, RefreshCw } from "lucide-react";
import { recruitApi, recruitKeys, useCan, useCanExact } from "@mediaos/web-core";
import type { InterviewResponseDto, InterviewStatusDto } from "@mediaos/contracts";
import { Button, DataTable, Dialog, EmptyState, PageHeader, PaginationFooter, Select } from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS, RECRUIT_PAGE_SIZE } from "./constants";
import { InterviewStatusBadge } from "./components/StatusBadges";
import { InterviewFormDialog } from "./components/InterviewFormDialog";
import { InterviewFeedbackPanel } from "./components/InterviewFeedbackPanel";
import { ChangeInterviewStatusDialog } from "./components/ChangeInterviewStatusDialog";
import { localDayStartIso, localDayEndIso } from "./recruit-datetime";

interface InterviewListPageProps {
  onOpenCandidate: (id: string) => void;
}

const INTERVIEW_STATUS_OPTIONS: readonly InterviewStatusDto[] = [
  "Scheduled",
  "Completed",
  "Cancelled",
];

/**
 * REC-SCREEN-005 (S12-RECRUIT-FE-1) — danh sách lượt phỏng vấn toàn công ty (scope theo `view:interview`
 * — Own = lượt MÌNH được xếp, §13.6). Tạo lịch cần chọn ứng viên TRƯỚC (bước phụ, đòi `view:candidate`
 * SENSITIVE) rồi mới mở `InterviewFormDialog`.
 */
export function InterviewListPage({ onOpenCandidate }: InterviewListPageProps) {
  const { t } = useTranslation("recruit");

  const canView = useCan(
    RECRUIT_ENGINE_PAIRS.interviewList.action,
    RECRUIT_ENGINE_PAIRS.interviewList.resourceType,
  );
  const canManage = useCan(
    RECRUIT_ENGINE_PAIRS.interviewCreate.action,
    RECRUIT_ENGINE_PAIRS.interviewCreate.resourceType,
  );
  const canPickCandidate = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateList.action,
    RECRUIT_ENGINE_PAIRS.candidateList.resourceType,
  );

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<InterviewStatusDto | "">("");
  const [page, setPage] = useState(1);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createFor, setCreateFor] = useState<{ id: string; fullName: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Object interview đầy đủ (KHÔNG chỉ id) — tránh bẫy `rows.find(id) ?? "Scheduled"` bịa trạng thái khi
  // hàng không còn trong trang hiện tại (mục 8 review-gate).
  const [statusTarget, setStatusTarget] = useState<InterviewResponseDto | null>(null);

  const listParams = useMemo(
    () => ({
      // Bộ lọc ngày là mốc LOCAL của người dùng — "đến ngày" phải là CUỐI ngày LOCAL (23:59:59.999),
      // KHÔNG phải nửa đêm UTC (loại mất lượt buổi tối của ngày cuối, mục 2 review-gate).
      ...(from ? { from: localDayStartIso(from) } : {}),
      ...(to ? { to: localDayEndIso(to) } : {}),
      ...(status ? { status: [status] } : {}),
      page,
      per_page: RECRUIT_PAGE_SIZE,
    }),
    [from, to, status, page],
  );

  const listQuery = useQuery({
    queryKey: recruitKeys.interviews.list(listParams),
    queryFn: () => recruitApi.listInterviews(listParams),
    enabled: canView,
  });

  const candidatePickerQuery = useQuery({
    queryKey: recruitKeys.candidates.list({ stage: ["Interview"], scope: "interview-picker" }),
    queryFn: () => recruitApi.listCandidates({ stage: ["Interview"], per_page: 100 }),
    enabled: pickerOpen && canPickCandidate,
  });

  const rows = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination;
  const total = pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / RECRUIT_PAGE_SIZE));
  const detail = rows.find((r) => r.id === detailId);

  const columns = useMemo<ColumnDef<InterviewResponseDto>[]>(
    () => [
      {
        id: "candidate",
        header: t("interviews.columns.candidate"),
        accessorFn: (r) => r.candidate.fullName,
      },
      { accessorKey: "round", header: t("interviews.columns.round") },
      {
        id: "time",
        header: t("interviews.columns.time"),
        accessorFn: (r) => r.startsAt.slice(0, 16).replace("T", " "),
      },
      {
        accessorKey: "location",
        header: t("interviews.columns.location"),
        cell: ({ row }) => row.original.location ?? "—",
      },
      {
        accessorKey: "status",
        header: t("interviews.columns.status"),
        cell: ({ row }) => <InterviewStatusBadge status={row.original.status} />,
      },
    ],
    [t],
  );

  if (!canView) return <EmptyState title={t("states.error")} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("interviews.listTitle")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
              <RefreshCw className="mr-2 size-4" />
              {t("states.retry")}
            </Button>
            {canManage && canPickCandidate && (
              <Button size="sm" onClick={() => setPickerOpen(true)}>
                <Plus className="mr-2 size-4" />
                {t("interviews.create")}
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("interviews.filterFrom")}</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("interviews.filterTo")}</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <Select
          className="w-48"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as InterviewStatusDto | "");
            setPage(1);
          }}
          aria-label={t("interviews.filterStatus")}
        >
          <option value="">{t("interviews.filterAll")}</option>
          {INTERVIEW_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`interviewStatus.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={listQuery.isLoading}
        pageSize={RECRUIT_PAGE_SIZE}
        onRowClick={(row) => setDetailId(row.id)}
        emptyState={<EmptyState title={t("interviews.empty")} />}
      />

      {lastPage > 1 && (
        <PaginationFooter
          page={page}
          totalPages={lastPage}
          onPageChange={setPage}
        />
      )}

      <Dialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("interviews.selectCandidate")}
      >
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {(candidatePickerQuery.data?.data ?? []).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setCreateFor({ id: c.id, fullName: c.fullName });
                  setPickerOpen(false);
                }}
              >
                {c.fullName}
              </button>
            </li>
          ))}
          {(candidatePickerQuery.data?.data ?? []).length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {t("pipeline.emptyColumn")}
            </p>
          )}
        </ul>
      </Dialog>

      {createFor && (
        <InterviewFormDialog
          open
          onClose={() => setCreateFor(null)}
          candidateId={createFor.id}
          candidateName={createFor.fullName}
          onDone={() => {}}
        />
      )}

      <Dialog
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        title={t("interviews.detailTitle")}
        footer={
          detail && (
            <Button variant="outline" onClick={() => onOpenCandidate(detail.candidate.id)}>
              {detail.candidate.fullName}
            </Button>
          )
        }
      >
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span>
                {t("interviews.columns.round")} {detail.round} ·{" "}
                {detail.startsAt.slice(0, 16).replace("T", " ")}
              </span>
              <InterviewStatusBadge status={detail.status} />
            </div>
            {detail.location && <p className="text-sm text-muted-foreground">{detail.location}</p>}
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                {t("interviews.fields.participants")}
              </p>
              <p className="text-sm">
                {detail.participants
                  .map((p) => p.fullName ?? p.employeeCode ?? p.employeeId)
                  .join(", ") || "—"}
              </p>
            </div>
            {canManage && detail.status === "Scheduled" && (
              <Button variant="outline" size="sm" onClick={() => setStatusTarget(detail)}>
                {t("interviews.changeStatus")}
              </Button>
            )}
            <InterviewFeedbackPanel interviewId={detail.id} />
          </div>
        )}
      </Dialog>

      <ChangeInterviewStatusDialog
        interviewId={statusTarget?.id ?? null}
        currentStatus={statusTarget?.status ?? "Scheduled"}
        onClose={() => setStatusTarget(null)}
        onDone={() => void listQuery.refetch()}
      />
    </div>
  );
}
