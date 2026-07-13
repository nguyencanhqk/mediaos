import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Pencil, RefreshCw, ExternalLink } from "lucide-react";
import { hrApi, hrKeys, useCan, PermissionGate } from "@mediaos/web-core";
import {
  Avatar,
  Button,
  EmptyState,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
import { EmployeeStatusBadge } from "../employee-status";
import { BasicInfoSection, CompSection, ContactSection, WorkInfoSection } from "./profile-sections";

/**
 * HR-PROFILE-UI-1 — panel hồ sơ bên phải của split view (dạng chi tiết).
 * Header cover + tabs Thông tin cơ bản / Liên hệ / Công việc / Lương.
 * Server mask sensitive; panel chỉ render những gì nhận được.
 */
interface EmployeeProfilePanelProps {
  employeeId: string;
  onEdit?: (employeeId: string) => void;
  /** Mở trang hồ sơ đầy đủ (route /hr/employees/:id — có tab File, hợp đồng…). */
  onOpenFull?: (employeeId: string) => void;
}

type PanelTab = "basic" | "contact" | "work" | "comp";

export function EmployeeProfilePanel({
  employeeId,
  onEdit,
  onOpenFull,
}: EmployeeProfilePanelProps) {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const [tab, setTab] = useState<PanelTab>("basic");

  const canViewSensitive = useCan(
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.action,
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.resourceType,
  );
  const canViewSalary = useCan(
    HR_ENGINE_PAIRS.VIEW_SALARY.action,
    HR_ENGINE_PAIRS.VIEW_SALARY.resourceType,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.employees.detail(employeeId),
    queryFn: () => hrApi.getEmployee(employeeId),
    enabled: !!employeeId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <EmptyState
          title={t("detail.error.title")}
          description={t("detail.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      {/* Cover header — banner luôn tối (navy chrome) theo chủ đích cả 2 theme, không đổi theo light/dark */}
      <div className="relative bg-gradient-to-r from-[#0f1a2e] via-[#16243d] to-[#1e304f] px-5 pt-5 pb-4">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <Avatar
              size="lg"
              name={data.fullName}
              src={data.avatarUrl}
              className="ring-2 ring-white/70"
            />
            <div className="text-white">
              <p className="text-base leading-tight font-semibold uppercase">
                {data.fullName ?? "—"}
                <span className="ml-2 text-sm font-normal text-white/80">
                  ({data.employeeCode ?? "—"})
                </span>
              </p>
              <p className="text-sm text-white/80">
                {[data.positionName, data.orgUnitName].filter(Boolean).join(" – ") || "—"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <EmployeeStatusBadge status={data.status} />
            {onOpenFull && (
              <Button
                variant="outline"
                size="sm"
                className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                onClick={() => onOpenFull(employeeId)}
                title={t("detail.viewFull")}
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
            )}
            {onEdit && (
              <PermissionGate
                action={HR_ENGINE_PAIRS.UPDATE_EMPLOYEE.action}
                resourceType={HR_ENGINE_PAIRS.UPDATE_EMPLOYEE.resourceType}
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                  onClick={() => onEdit(employeeId)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("employees.actions.edit")}
                </Button>
              </PermissionGate>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="p-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)}>
          <TabsList>
            <TabsTrigger value="basic">{t("detail.tabs.basic")}</TabsTrigger>
            <TabsTrigger value="contact">{t("detail.tabs.contact")}</TabsTrigger>
            <TabsTrigger value="work">{t("detail.tabs.work")}</TabsTrigger>
            <TabsTrigger value="comp">{t("detail.tabs.comp")}</TabsTrigger>
          </TabsList>
          <TabsContent value="basic" className="pt-4">
            <BasicInfoSection employee={data} t={t} canViewSensitive={canViewSensitive} />
          </TabsContent>
          <TabsContent value="contact" className="pt-4">
            <ContactSection employee={data} t={t} canViewSensitive={canViewSensitive} />
          </TabsContent>
          <TabsContent value="work" className="pt-4">
            <WorkInfoSection employee={data} t={t} canViewSensitive={canViewSensitive} />
          </TabsContent>
          <TabsContent value="comp" className="pt-4">
            <CompSection employee={data} t={t} canViewSalary={canViewSalary} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
