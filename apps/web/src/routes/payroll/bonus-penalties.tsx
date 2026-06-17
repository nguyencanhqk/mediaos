import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BonusKind, BonusPenaltyStatus } from "@mediaos/contracts";
import { bonusPenaltyApi } from "@/lib/bonus-penalty-api";
import { ApiError } from "@/lib/api-client";
import { PermissionGate } from "@/components/permission-gate";
import { BonusPenaltyTable } from "@/components/payroll/bonus-penalty-table";
import { CreateBonusPenaltyDialog } from "@/components/payroll/create-bonus-penalty-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  BONUS_KIND_LABELS,
  BONUS_PENALTY_STATUS_LABELS,
} from "@/components/payroll/bonus-penalty-constants";
import { useAuthStore } from "@/stores/auth";

/**
 * G12-3 FE — Bonus/Penalty list. Số tiền (amount) NHẠY CẢM (ADR-0010): SERVER là sự thật quyền —
 * gate cả list/get bằng 403 nếu thiếu view-bonus-penalty (KHÔNG mask field). Trang xử lý lỗi 403
 * thành trạng thái "không có quyền" (không render số). Nút tạo bọc <PermissionGate manage>; nút
 * Duyệt/Từ chối chặn self-approve bằng currentUserId từ auth store (mirror BE SoD).
 *
 * Redesign (Phase 2): chuẩn hoá chrome (PageHeader + toolbar + empty/error) theo house style
 * MISA/Funtime. KHÔNG đổi data/permission — giữ nguyên hook query, PermissionGate, currentUserId,
 * nhánh 403, và component bảng (số tiền do server quyết, 403 thì không có số để render).
 */
export function BonusPenaltiesPage() {
  const { t } = useTranslation("payroll");
  const [status, setStatus] = useState<BonusPenaltyStatus | "">("");
  const [kind, setKind] = useState<BonusKind | "">("");
  const [periodMonth, setPeriodMonth] = useState("");

  const currentUserId = useAuthStore((s) => s.user?.id ?? null);

  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["bonus-penalties", { status, kind, periodMonth }],
    queryFn: () =>
      bonusPenaltyApi.list({
        ...(status ? { status } : {}),
        ...(kind ? { kind } : {}),
        ...(periodMonth ? { periodMonth } : {}),
      }),
    retry: false,
  });

  const isForbidden = error instanceof ApiError && error.status === 403;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("bonusPenalties.pageTitle")}
        description={t("bonusPenalties.pageDescription")}
        icon={Gift}
        actions={
          <PermissionGate action="manage-bonus-penalty" resourceType="bonus_penalty">
            <CreateBonusPenaltyDialog />
          </PermissionGate>
        }
      >
        <div className="flex flex-wrap gap-3">
          <div className="space-y-1">
            <label
              htmlFor="bonus-status-filter"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              {t("bonusPenalties.filterStatus")}
            </label>
            <Select
              id="bonus-status-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value as BonusPenaltyStatus | "")}
              className="w-44"
            >
              <option value="">{t("bonusPenalties.all")}</option>
              {(Object.keys(BONUS_PENALTY_STATUS_LABELS) as BonusPenaltyStatus[]).map((s) => (
                <option key={s} value={s}>
                  {BONUS_PENALTY_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label
              htmlFor="bonus-kind-filter"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              {t("bonusPenalties.filterKind")}
            </label>
            <Select
              id="bonus-kind-filter"
              value={kind}
              onChange={(e) => setKind(e.target.value as BonusKind | "")}
              className="w-44"
            >
              <option value="">{t("bonusPenalties.all")}</option>
              {(Object.keys(BONUS_KIND_LABELS) as BonusKind[]).map((k) => (
                <option key={k} value={k}>
                  {BONUS_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label
              htmlFor="bonus-period-filter"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              {t("bonusPenalties.filterPeriod")}
            </label>
            <Input
              id="bonus-period-filter"
              type="month"
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
              className="w-44"
            />
          </div>
        </div>
      </PageHeader>

      {isLoading && <p className="text-sm text-muted-foreground">{t("bonusPenalties.loading")}</p>}
      {isForbidden && <p className="text-sm text-destructive">{t("bonusPenalties.forbidden")}</p>}
      {error && !isForbidden && (
        <EmptyState
          icon={Gift}
          title={t("bonusPenalties.loadFailed")}
          description={t("bonusPenalties.loadHint")}
        />
      )}
      {!isLoading && !error && <BonusPenaltyTable rows={rows} currentUserId={currentUserId} />}
    </div>
  );
}
