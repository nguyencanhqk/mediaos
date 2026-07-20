/**
 * HR-SCREEN-ORG-CHART (S2-FE-HR-6 · FE-1 · FE-2) — /hr/org-chart. Sơ đồ tổ chức (cây phòng ban) +
 * trưởng phòng/thành viên + HÀNH ĐỘNG quản trị (thêm phòng ban · thêm nhân viên · đổi quản lý trực tiếp ·
 * chuyển phòng ban).
 *
 * Nguồn: GET /org/units/tree (read mở) + GET /hr/org-chart/employees (gate read:employee). Nút hành động
 * gate hiển thị bằng PermissionGate (create:department · create:employee · update:employee) — cổng THẬT ở
 * SERVER (@RequirePermission). Mutation đi thẳng PATCH/POST (HR/Admin sửa người khác KHÔNG qua change-
 * request — change-request chỉ cho self-service PII, và cấm sửa phòng ban/quản lý — SPEC-03 §14.18).
 *
 * States: loading · error · empty · forbidden.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Network, Plus, RefreshCw, UserPlus } from "lucide-react";
import { orgApi, hrKeys, useCan, PermissionGate, type OrgTreeNode } from "@mediaos/web-core";
import { Avatar, Button, EmptyState, PageHeader } from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
import { OrgChartNode, type PersonEditHandlers } from "./OrgChartNode";
import { buildMembersByUnit, flattenEmployeeChart, type UnitMember } from "./members-by-unit";
import { flattenDepartments } from "./org-chart-lookups";
import {
  fetchEmployeeChart,
  orgChartEmployeesQueryKey,
  type OrgChartEmployeeTree,
} from "./employee-chart-api";
import { DepartmentCreateDialog } from "./DepartmentCreateDialog";
import { EmployeeAssignManagerDialog } from "./EmployeeAssignManagerDialog";
import { EmployeeMoveDeptDialog } from "./EmployeeMoveDeptDialog";
import { EmployeeAddToDeptDialog } from "./EmployeeAddToDeptDialog";
import { DeptHeadPickerDialog } from "./DeptHeadPickerDialog";
import "./org-chart.css";

type PersonDialog = { kind: "manager" | "dept"; target: UnitMember } | null;

export function OrgChartPage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const canView = useCan(
    HR_ENGINE_PAIRS.ORG_CHART_VIEW.action,
    HR_ENGINE_PAIRS.ORG_CHART_VIEW.resourceType,
  );
  // Danh sách trưởng phòng + thành viên chỉ nạp khi có quyền xem nhân sự (BE gate read:employee).
  // Thiếu quyền → chỉ hiện cây phòng ban, KHÔNG lộ nhân sự (masking/scope là việc của server).
  const canViewEmployees = useCan(
    HR_ENGINE_PAIRS.READ_EMPLOYEE.action,
    HR_ENGINE_PAIRS.READ_EMPLOYEE.resourceType,
  );
  const canEditEmployees = useCan(
    HR_ENGINE_PAIRS.UPDATE_EMPLOYEE.action,
    HR_ENGINE_PAIRS.UPDATE_EMPLOYEE.resourceType,
  );
  // Đặt/đổi trưởng đơn vị = mutation PHÒNG BAN (PATCH /hr/departments/:id) → gate update:department,
  // KHÔNG dùng chung cổng update:employee của các hành động nhân sự.
  const canUpdateDept = useCan(
    HR_ENGINE_PAIRS.UPDATE_DEPARTMENT.action,
    HR_ENGINE_PAIRS.UPDATE_DEPARTMENT.resourceType,
  );

  const [createDeptOpen, setCreateDeptOpen] = useState(false);
  const [personDialog, setPersonDialog] = useState<PersonDialog>(null);
  const [addToDept, setAddToDept] = useState<{ id: string; name: string } | null>(null);
  const [headDept, setHeadDept] = useState<{
    id: string;
    name: string;
    headUserName: string | null;
  } | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<OrgTreeNode[]>({
    queryKey: hrKeys.orgChart.tree(),
    queryFn: () => orgApi.getTree(),
    enabled: canView,
    staleTime: 30_000,
  });

  const { data: employeeChart } = useQuery<OrgChartEmployeeTree>({
    queryKey: orgChartEmployeesQueryKey,
    queryFn: () => fetchEmployeeChart(),
    enabled: canView && canViewEmployees,
    staleTime: 30_000,
  });

  const membersByUnit = useMemo(
    () => buildMembersByUnit(employeeChart?.roots ?? []),
    [employeeChart],
  );
  // Ứng viên chọn quản lý = toàn bộ nhân viên (kể cả người chưa gán phòng).
  const allEmployees = useMemo(
    () => flattenEmployeeChart(employeeChart?.roots ?? []),
    [employeeChart],
  );
  // Option phòng ban (có thụt cấp) cho picker "phòng cha" / "chuyển phòng".
  const deptOptions = useMemo(() => flattenDepartments(data ?? []), [data]);

  // Nhân viên CHƯA thuộc phòng ban nào (orgUnitName null) — không hiện trong hộp phòng nào → gom riêng.
  const unassigned = useMemo(() => allEmployees.filter((e) => !e.orgUnitName), [allEmployees]);

  const editHandlers: PersonEditHandlers | undefined = useMemo(
    () =>
      canEditEmployees
        ? {
            onAssignManager: (target) => setPersonDialog({ kind: "manager", target }),
            onMoveDept: (target) => setPersonDialog({ kind: "dept", target }),
            onAddToDept: (dept) => setAddToDept(dept),
          }
        : undefined,
    [canEditEmployees],
  );

  function invalidateOrgData() {
    void queryClient.invalidateQueries({ queryKey: hrKeys.orgChart.tree() });
    void queryClient.invalidateQueries({ queryKey: orgChartEmployeesQueryKey });
    void queryClient.invalidateQueries({ queryKey: hrKeys.employees.all });
    // Đặt/đổi trưởng đơn vị ghi vào org_units.head_user_id → list/detail phòng ban cũng đổi.
    void queryClient.invalidateQueries({ queryKey: hrKeys.departments.all });
  }

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Network}
          title={t("orgChart.forbidden.title")}
          description={t("orgChart.forbidden.description")}
          data-testid="org-chart-forbidden"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={t("orgChart.title")}
        description={t("orgChart.description")}
        icon={Network}
        actions={
          <div className="flex items-center gap-2">
            <PermissionGate action="create" resourceType="department">
              <Button variant="outline" size="sm" onClick={() => setCreateDeptOpen(true)}>
                <Building2 className="mr-2 h-4 w-4" />
                {t("orgChart.actions.addDepartment")}
              </Button>
            </PermissionGate>
            <PermissionGate
              action={HR_ENGINE_PAIRS.CREATE_EMPLOYEE.action}
              resourceType={HR_ENGINE_PAIRS.CREATE_EMPLOYEE.resourceType}
            >
              <Button size="sm" onClick={() => void navigate({ to: "/hr/employees/new" })}>
                <UserPlus className="mr-2 h-4 w-4" />
                {t("orgChart.actions.addEmployee")}
              </Button>
            </PermissionGate>
          </div>
        }
      />

      {isError ? (
        <EmptyState
          icon={Network}
          title={t("orgChart.error.title")}
          description={t("orgChart.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      ) : isLoading ? (
        <div
          data-testid="org-chart-loading"
          className="animate-pulse rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
        >
          {tc("loading")}
        </div>
      ) : !data || data.length === 0 ? (
        <EmptyState
          icon={Network}
          title={t("orgChart.empty.title")}
          description={t("orgChart.empty.description")}
          action={
            <PermissionGate action="create" resourceType="department">
              <Button variant="outline" size="sm" onClick={() => setCreateDeptOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t("orgChart.actions.addDepartment")}
              </Button>
            </PermissionGate>
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
          <div className="org-chart" role="tree" aria-label={t("orgChart.title")}>
            <ul>
              {data.map((node) => (
                <OrgChartNode
                  key={node.id}
                  node={node}
                  membersByUnit={membersByUnit}
                  edit={editHandlers}
                  onSetHead={canUpdateDept ? setHeadDept : undefined}
                />
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Nhân viên chưa thuộc phòng ban nào — hiện riêng để phân bổ (không lọt khỏi sơ đồ). */}
      {canViewEmployees && unassigned.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("orgChart.unassigned.title", { count: unassigned.length })}
            </h3>
            <p className="text-xs text-muted-foreground">{t("orgChart.unassigned.desc")}</p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {unassigned.map((m) => (
              <li
                key={m.employeeId}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <Avatar name={m.displayName} src={m.avatarUrl} size="sm" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">
                    {m.displayName ?? t("orgChart.unnamedMember")}
                  </div>
                  {m.positionName && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {m.positionName}
                    </div>
                  )}
                </div>
                {canEditEmployees && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPersonDialog({ kind: "dept", target: m })}
                  >
                    {t("orgChart.unassigned.assign")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <DepartmentCreateDialog
        open={createDeptOpen}
        onClose={() => setCreateDeptOpen(false)}
        parentOptions={deptOptions}
        onCreated={() => {
          invalidateOrgData();
          setCreateDeptOpen(false);
        }}
      />

      {addToDept && (
        <EmployeeAddToDeptDialog
          key={addToDept.id}
          dept={addToDept}
          onClose={() => setAddToDept(null)}
          onSaved={invalidateOrgData}
        />
      )}

      {headDept && (
        <DeptHeadPickerDialog
          key={headDept.id}
          dept={headDept}
          currentHeadName={headDept.headUserName}
          onClose={() => setHeadDept(null)}
          onSaved={invalidateOrgData}
        />
      )}

      {personDialog?.kind === "manager" && (
        <EmployeeAssignManagerDialog
          key={personDialog.target.employeeId}
          open
          target={personDialog.target}
          candidates={allEmployees}
          onClose={() => setPersonDialog(null)}
          onSaved={() => {
            invalidateOrgData();
            setPersonDialog(null);
          }}
        />
      )}

      {personDialog?.kind === "dept" && (
        <EmployeeMoveDeptDialog
          key={personDialog.target.employeeId}
          open
          target={personDialog.target}
          departments={deptOptions}
          onClose={() => setPersonDialog(null)}
          onSaved={() => {
            invalidateOrgData();
            setPersonDialog(null);
          }}
        />
      )}
    </div>
  );
}
