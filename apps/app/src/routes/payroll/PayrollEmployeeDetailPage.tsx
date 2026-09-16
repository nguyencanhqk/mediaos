import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import {
  Button,
  DetailPageHeader,
  EmptyState,
  StatusPill,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import {
  EMPLOYEE_STATUS_BADGE_VARIANT,
  PAYROLL_EMPLOYEE_TABS,
  PAYROLL_ENGINE_PAIRS,
  type PayrollEmployeeTab,
} from "./constants";
import { usePayrollPeople } from "./use-payroll-people";
import { EmployeeGeneralTab } from "./components/employee/EmployeeGeneralTab";
import { EmployeeSalaryHistoryTab } from "./components/employee/EmployeeSalaryHistoryTab";
import { EmployeeInsuranceTab } from "./components/employee/EmployeeInsuranceTab";
import { EmployeeTaxTab } from "./components/employee/EmployeeTaxTab";
import { EmployeeDependentsTab } from "./components/employee/EmployeeDependentsTab";

/**
 * PAY-SCREEN-007 «Chi tiết nhân viên» — 5 tab (PAY-DEC-016), **gác TỪNG TAB bằng cặp riêng** (SPEC-11 §9.1):
 *
 * | Tab | Cặp | Đường tải |
 * | Thông tin chung | `view:payroll-employee` | 037 |
 * | Lịch sử lương | `view:salary-profile` | 019 (+021 khi mở) |
 * | Bảo hiểm – Công đoàn | `view:payroll-employee` | 038 (+039 ghi) |
 * | Thuế TNCN | **CẢ HAI** cặp trên | 037 `taxCode` + 040 |
 * | Gia đình | `view:payroll-employee` | 040 (+041/042 ghi) |
 *
 * ⚠️ **Thiếu cặp ⇒ ẨN TAB, không render tab rỗng** (UI-07 §21.8 lưu ý 4). Mọi cặp đều SENSITIVE ⇒
 * `useCanExact`, KHÔNG `<PermissionGate>`/`useCan` (wildcard `*:*` không kế thừa cặp sensitive — memory
 * `sensitive-pair-widget-needs-usecanexact`); `payroll-employee-tabs.spec.tsx` neo bằng cách mock hai
 * hook trả giá trị NGƯỢC nhau.
 *
 * Route gate = cặp đường tải của 037 (`access:payroll` + `view:payroll-employee`) — vai chỉ có
 * `view:salary-profile` không mở được trang này (SPEC-11 §9.1: danh sách + tab chung ← `payroll-employee`).
 */
export function PayrollEmployeeDetailPage({
  userId,
  onBack,
}: {
  userId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();
  const people = usePayrollPeople();

  const canViewEmployee = useCanExact(
    PAYROLL_ENGINE_PAIRS.employeeDetail.action,
    PAYROLL_ENGINE_PAIRS.employeeDetail.resourceType,
  );
  const canViewSalary = useCanExact(
    PAYROLL_ENGINE_PAIRS.salaryProfileList.action,
    PAYROLL_ENGINE_PAIRS.salaryProfileList.resourceType,
  );
  const canManageEmployee = useCanExact(
    PAYROLL_ENGINE_PAIRS.employeeSettingsPut.action,
    PAYROLL_ENGINE_PAIRS.employeeSettingsPut.resourceType,
  );

  const visibleTabs = useMemo<PayrollEmployeeTab[]>(() => {
    const allowed: Record<PayrollEmployeeTab, boolean> = {
      general: canViewEmployee,
      salaryHistory: canViewSalary,
      insurance: canViewEmployee,
      tax: canViewEmployee && canViewSalary,
      dependents: canViewEmployee,
    };
    return PAYROLL_EMPLOYEE_TABS.filter((tab) => allowed[tab]);
  }, [canViewEmployee, canViewSalary]);

  const [activeTab, setActiveTab] = useState<PayrollEmployeeTab>("general");
  // Cặp quyền đổi lúc runtime (refresh /auth/me) ⇒ tab đang đứng có thể biến mất; rơi về tab đầu còn thấy.
  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.includes(activeTab)) setActiveTab(visibleTabs[0]);
  }, [visibleTabs, activeTab]);

  const employeeQuery = useQuery({
    queryKey: payrollKeys.employees.detail(userId),
    queryFn: () => payrollApi.getEmployee(userId),
    enabled: canViewEmployee,
  });
  const employee = employeeQuery.data ?? null;

  if (!canViewEmployee) return <EmptyState title={t("employeeDetail.noPermission")} />;
  if (employeeQuery.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("states.loading")}</div>;
  }
  if (employeeQuery.isError || employee === null) {
    return (
      <EmptyState
        title={t("states.error")}
        action={
          <Button variant="outline" onClick={() => void employeeQuery.refetch()}>
            {t("states.retry")}
          </Button>
        }
      />
    );
  }

  const title = employee.fullName ?? employee.employeeCode ?? `#${userId.slice(0, 8)}`;
  const subtitleParts = [employee.employeeCode, employee.orgUnitName, employee.positionName].filter(
    (p): p is string => Boolean(p),
  );

  return (
    <div className="space-y-6">
      <DetailPageHeader
        onBack={onBack}
        title={title}
        status={
          employee.employeeStatus ? (
            <StatusPill
              tone={EMPLOYEE_STATUS_BADGE_VARIANT[employee.employeeStatus] ?? "muted"}
              label={t(`employeeStatus.${employee.employeeStatus}`, {
                defaultValue: employee.employeeStatus,
              })}
            />
          ) : undefined
        }
        subtitle={subtitleParts.join(" · ")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: payrollKeys.employees.allOf() })
            }
            disabled={employeeQuery.isFetching}
          >
            <RefreshCw className="mr-2 size-4" />
            {t("states.retry")}
          </Button>
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PayrollEmployeeTab)}>
        <TabsList>
          {visibleTabs.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`employeeDetail.tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {visibleTabs.includes("general") && (
          <TabsContent value="general" className="pt-4">
            <EmployeeGeneralTab employee={employee} />
          </TabsContent>
        )}
        {visibleTabs.includes("salaryHistory") && (
          <TabsContent value="salaryHistory" className="pt-4">
            <EmployeeSalaryHistoryTab userId={userId} people={people} employeeLabel={title} />
          </TabsContent>
        )}
        {visibleTabs.includes("insurance") && (
          <TabsContent value="insurance" className="pt-4">
            <EmployeeInsuranceTab userId={userId} canManage={canManageEmployee} />
          </TabsContent>
        )}
        {visibleTabs.includes("tax") && (
          <TabsContent value="tax" className="pt-4">
            <EmployeeTaxTab employee={employee} />
          </TabsContent>
        )}
        {visibleTabs.includes("dependents") && (
          <TabsContent value="dependents" className="pt-4">
            <EmployeeDependentsTab userId={userId} canManage={canManageEmployee} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
