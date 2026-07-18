import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Users, RefreshCw, ArrowLeft, Pencil, FileText } from "lucide-react";
import { hrApi, hrKeys, useCan, useCanExact, PermissionGate } from "@mediaos/web-core";
import {
  PageHeader,
  EmptyState,
  Button,
  Avatar,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
import { EmployeeStatusBadge } from "../employee-status";
// S2-FE-HR-7 — nút điều hướng "Hợp đồng" (ẩn nếu không truyền onContracts).
import { CONTRACT_ENGINE_PAIRS } from "../contracts/constants";
import "../contracts/contracts-i18n";
// S2-FE-HR-9 — Tab "File hồ sơ" (UI-HR-SCREEN-015), chỉ hiển thị nếu có file-view:employee.
import { EMPLOYEE_FILE_ENGINE_PAIRS } from "./employee-file-constants";
import { EmployeeFilesTab } from "./EmployeeFilesTab";
// HR-PROFILE-UI-1 — section dùng chung với split view.
import {
  BasicInfoSection,
  CompSection,
  ContactSection,
  IdentitySection,
  WorkInfoSection,
} from "./profile-sections";
// S5-HR-LINKUI-1 — khối "Tài khoản đăng nhập" (HR-FUNC-011): liên kết/hủy liên kết hồ sơ ↔ user.
import { AccountLinkSection } from "./AccountLinkSection";

type Tab = "basic" | "contact" | "work" | "comp" | "files";

interface EmployeeDetailPageProps {
  employeeId: string;
  onBack?: () => void;
  onEdit?: () => void;
  /** S2-FE-HR-7 — điều hướng tới /hr/employees/:id/contracts (ẩn nếu không truyền). */
  onContracts?: () => void;
  /** S5-HR-WORKINFO-1 — điều hướng tới hồ sơ quản lý trực tiếp (WorkInfoSection); server enforce quyền xem. */
  onNavigateEmployee?: (employeeId: string) => void;
}

export function EmployeeDetailPage({
  employeeId,
  onBack,
  onEdit,
  onContracts,
  onNavigateEmployee,
}: EmployeeDetailPageProps) {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const [activeTab, setActiveTab] = useState<Tab>("basic");

  const canView = useCan(
    HR_ENGINE_PAIRS.READ_EMPLOYEE.action,
    HR_ENGINE_PAIRS.READ_EMPLOYEE.resourceType,
  );
  const canViewSensitive = useCan(
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.action,
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.resourceType,
  );
  const canViewSalary = useCan(
    HR_ENGINE_PAIRS.VIEW_SALARY.action,
    HR_ENGINE_PAIRS.VIEW_SALARY.resourceType,
  );
  // HR-IDENTITY-READ-1 — CCCD/CMND nhạy cảm HƠN view-sensitive, cặp seed riêng. useCanExact
  // (KHÔNG useCan) — sensitive pair, tránh *:* wildcard fall-through permit trong khi BE 403.
  const canViewIdentity = useCanExact(
    HR_ENGINE_PAIRS.VIEW_IDENTITY.action,
    HR_ENGINE_PAIRS.VIEW_IDENTITY.resourceType,
  );
  // S2-FE-HR-9 — spec §18.7: tab "File hồ sơ" chỉ hiển thị nếu user có HR.EMPLOYEE.FILE_VIEW.
  const canViewFiles = useCan(
    EMPLOYEE_FILE_ENGINE_PAIRS.VIEW.action,
    EMPLOYEE_FILE_ENGINE_PAIRS.VIEW.resourceType,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.employees.detail(employeeId),
    queryFn: () => hrApi.getEmployee(employeeId),
    enabled: canView && !!employeeId,
    staleTime: 30_000,
    // Retry controlled by QueryClient default (retry:false in tests, 3 in prod).
    // 403/404 are definitive — caller (QueryClient config or error boundary) should not retry them.
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("employees.forbidden.title")}
          description={t("employees.forbidden.description")}
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={Users} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("detail.error.title")}
          description={t("detail.error.description")}
          action={
            <div className="flex gap-2">
              {onBack && (
                <Button variant="outline" size="sm" onClick={onBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("detail.backToList")}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      {/* Cover header: avatar + tên + mã + chức vụ – đơn vị + trạng thái */}
      <div className="overflow-hidden rounded-xl border border-border">
        {/* Banner luôn tối (navy chrome) theo chủ đích cả 2 theme, không đổi theo light/dark */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#0f1a2e] via-[#16243d] to-[#1e304f] px-5 py-5">
          <div className="flex items-center gap-4">
            <Avatar
              size="lg"
              name={data.fullName}
              src={data.avatarUrl}
              className="ring-2 ring-white/70"
            />
            <div className="text-white">
              <p className="text-lg leading-tight font-semibold uppercase">
                {data.fullName ?? "—"}
                <span className="ml-2 text-sm font-normal text-white/80">
                  ({data.employeeCode ?? "—"})
                </span>
              </p>
              <p className="text-sm text-white/80">
                {[data.positionName, data.orgUnitName].filter(Boolean).join(" – ") || "—"}
              </p>
            </div>
            <EmployeeStatusBadge status={data.status} />
          </div>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                onClick={onBack}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("detail.backToList")}
              </Button>
            )}
            {onContracts && (
              <PermissionGate
                action={CONTRACT_ENGINE_PAIRS.VIEW.action}
                resourceType={CONTRACT_ENGINE_PAIRS.VIEW.resourceType}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                  onClick={onContracts}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  {t("contracts.title")}
                </Button>
              </PermissionGate>
            )}
            {onEdit && (
              <PermissionGate
                action={HR_ENGINE_PAIRS.UPDATE_EMPLOYEE.action}
                resourceType={HR_ENGINE_PAIRS.UPDATE_EMPLOYEE.resourceType}
              >
                <Button size="sm" onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("employees.actions.edit")}
                </Button>
              </PermissionGate>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="basic">{t("detail.tabs.basic")}</TabsTrigger>
          <TabsTrigger value="contact">{t("detail.tabs.contact")}</TabsTrigger>
          <TabsTrigger value="work">{t("detail.tabs.work")}</TabsTrigger>
          <TabsTrigger value="comp">{t("detail.tabs.comp")}</TabsTrigger>
          {canViewFiles && <TabsTrigger value="files">{t("detail.tabs.files")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="basic" className="space-y-4 pt-4">
          {/* S5-HR-LINKUI-1 — Tài khoản đăng nhập (HR-FUNC-011). */}
          <AccountLinkSection employee={data} employeeId={employeeId} />
          <BasicInfoSection employee={data} t={t} canViewSensitive={canViewSensitive} />
          {/* HR-IDENTITY-READ-1 — chỉ mount khi có EXACT view-identity:employee (fail-closed). */}
          {canViewIdentity && (
            <IdentitySection employee={data} t={t} canViewIdentity={canViewIdentity} />
          )}
        </TabsContent>
        <TabsContent value="contact" className="pt-4">
          <ContactSection employee={data} t={t} canViewSensitive={canViewSensitive} />
        </TabsContent>
        <TabsContent value="work" className="pt-4">
          <WorkInfoSection
            employee={data}
            t={t}
            canViewSensitive={canViewSensitive}
            onNavigateEmployee={onNavigateEmployee}
          />
        </TabsContent>
        <TabsContent value="comp" className="pt-4">
          <CompSection employee={data} t={t} canViewSalary={canViewSalary} />
        </TabsContent>
        {canViewFiles && (
          <TabsContent value="files" className="pt-4">
            <EmployeeFilesTab employeeId={employeeId} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
