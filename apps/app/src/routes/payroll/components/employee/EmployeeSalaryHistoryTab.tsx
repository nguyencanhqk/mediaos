import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import type { SalaryProfileDto } from "@mediaos/contracts";
import { Button, EmptyState } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PAYROLL_ENGINE_PAIRS, SALARY_HISTORY_PAGE } from "../../constants";
import { parsePayrollError, payrollErrorText } from "../../payroll-errors";
import type { PayrollPeopleLookup } from "../../use-payroll-people";
import { todayIsoDate } from "./employee-forms";
import { SalaryProfileFormDialog } from "../SalaryProfileFormDialog";
import { SalaryProfileVersionCard } from "./SalaryProfileVersionCard";

/** Xoá mềm 022 — **đơn độc**: service vào nhánh `delete` rồi return ngay, mọi field khác bị bỏ qua. */
const SALARY_PROFILE_DELETE_PAYLOAD = { delete: true } as const;

/**
 * Tab «Lịch sử lương» (PAY-SCREEN-007, cặp `view:salary-profile` — SENSITIVE; page đã gate, ở đây gate
 * lại nút tạo bằng `manage:salary-profile`).
 *
 * Timeline PHIÊN BẢN theo `effectiveDate` giảm dần (PAY-DEC-003): bản «hiện hành» = bản mới nhất có
 * `effectiveDate <= hôm nay` — chỉ là chỉ dấu UI; bản nào áp cho một kỳ là do SQL chọn lúc `calculate`
 * theo ngày cuối kỳ, không phải hôm nay.
 *
 * Danh sách 019 tải một trang `SALARY_HISTORY_PAGE`; vượt trần thì nói ra («chỉ 100 gần nhất»), không
 * lật trang trong tab.
 *
 * ── Sửa / xoá mềm (S15-PAYROLL-FE-5, PAYROLL-API-022) ────────────────────────────────────────────
 * Cùng cặp `manage:salary-profile` với nút tạo — 022 và 020 gác **CÙNG một cặp** (đo ở
 * `payroll-route-pairs.const.ts`), nên thiếu cặp là mất cả ba nút cùng lúc.
 *
 * Xoá đi qua `ConfirmDialog` (destructive) chứ không phải bấm-hai-lần: một cú bấm nhầm trên timeline
 * lương đắt hơn một dòng ngân sách. Hộp xác nhận chỉ mang **ngày hiệu lực**, KHÔNG mang mức lương
 * (BẤT BIẾN #3 — hộp xác nhận không phải chỗ chở tiền).
 */
export function EmployeeSalaryHistoryTab({
  userId,
  people,
  employeeLabel,
}: {
  userId: string;
  people: PayrollPeopleLookup;
  employeeLabel: string;
}) {
  const { t } = useTranslation("payroll");
  const canCreate = useCanExact(
    PAYROLL_ENGINE_PAIRS.salaryProfileCreate.action,
    PAYROLL_ENGINE_PAIRS.salaryProfileCreate.resourceType,
  );
  const canManage = useCanExact(
    PAYROLL_ENGINE_PAIRS.salaryProfileUpdate.action,
    PAYROLL_ENGINE_PAIRS.salaryProfileUpdate.resourceType,
  );
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryProfileDto | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; effectiveDate: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const params = { userId, page: 1, per_page: SALARY_HISTORY_PAGE };
  const listQuery = useQuery({
    queryKey: payrollKeys.salaryProfiles.list(params),
    queryFn: () => payrollApi.listSalaryProfiles(params),
  });

  const versions = useMemo(
    () =>
      [...(listQuery.data?.data ?? [])].sort((a, b) =>
        b.effectiveDate.localeCompare(a.effectiveDate),
      ),
    [listQuery.data],
  );
  const today = todayIsoDate();
  const currentId = versions.find((v) => v.effectiveDate <= today)?.id ?? null;
  const total = listQuery.data?.pagination?.total;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const collapse = (id: string) =>
    setExpanded((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => payrollApi.updateSalaryProfile(id, SALARY_PROFILE_DELETE_PAYLOAD),
    onSuccess: (_row, id) => {
      collapse(id);
      setDeleting(null);
      // 🔴 `collapse()` chỉ ĐẶT LỊCH cập nhật state — lúc `invalidateQueries` chạy (đồng bộ, ngay dưới)
      // observer của thẻ vẫn còn `enabled: true` của lần render TRƯỚC ⇒ 021 vẫn bắn lại lên bản vừa
      // xoá (`scope()` lọc `deleted_at IS NULL` ⇒ 404). `removeQueries` là đồng bộ và KHÔNG phụ thuộc
      // thứ tự render — vứt hẳn cache chi tiết đó đi thay vì mong React re-render kịp trước mạng.
      queryClient.removeQueries({ queryKey: payrollKeys.salaryProfiles.detail(id) });
      void queryClient.invalidateQueries({ queryKey: payrollKeys.salaryProfiles.allOf() });
      // `hasSalaryProfile` của 036/037 đổi khi xoá phiên bản cuối cùng.
      void queryClient.invalidateQueries({ queryKey: payrollKeys.employees.allOf() });
    },
    onError: (error) => setDeleteError(payrollErrorText(t, parsePayrollError(error))),
  });

  return (
    <div className="space-y-4" data-testid="employee-salary-history-tab">
      {canCreate && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" />
            {t("salaryHistory.addVersion")}
          </Button>
        </div>
      )}

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">{t("states.loading")}</p>
      ) : listQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : versions.length === 0 ? (
        <EmptyState title={t("salaryHistory.empty")} />
      ) : (
        <>
          <ul className="space-y-2">
            {versions.map((v) => (
              <SalaryProfileVersionCard
                key={v.id}
                profile={v}
                isCurrent={v.id === currentId}
                expanded={expanded.has(v.id)}
                onToggle={() => toggle(v.id)}
                canManage={canManage}
                onEdit={setEditing}
                onDelete={() => {
                  setDeleteError(null);
                  setDeleting({ id: v.id, effectiveDate: v.effectiveDate });
                }}
              />
            ))}
          </ul>
          {total !== undefined && total > SALARY_HISTORY_PAGE && (
            <p className="text-xs text-muted-foreground">{t("salaryHistory.truncated")}</p>
          )}
        </>
      )}

      <SalaryProfileFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        people={people}
        fixedUserId={userId}
        fixedUserLabel={employeeLabel}
      />

      <SalaryProfileFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        people={people}
        fixedUserId={userId}
        fixedUserLabel={employeeLabel}
        profile={editing}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={t("salaryHistory.deleteTitle")}
        description={t("salaryHistory.deleteDescription", { date: deleting?.effectiveDate ?? "" })}
        confirmLabel={t("salaryHistory.deleteConfirm")}
        cancelLabel={t("actions.cancel")}
        destructive
        busy={deleteMutation.isPending}
        busyLabel={t("salaryHistory.deleting")}
        onConfirm={() => {
          if (!deleting) return;
          setDeleteError(null);
          deleteMutation.mutate(deleting.id);
        }}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
      >
        {deleteError && (
          <p className="text-sm text-danger" role="alert">
            {deleteError}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
