import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { UserPlus, Trash2, RefreshCw } from "lucide-react";
import {
  taskProjectApi,
  taskKeys,
  taskProjectInvalidation,
  hrApi,
  hrKeys,
  useCan,
} from "@mediaos/web-core";
import { Button, DataTable, EmptyState, Dialog, Select, Badge } from "@mediaos/ui";
import type { MemberResponseDto, ProjectRoleDto } from "@mediaos/contracts";
import { TASK_ENGINE_PAIRS, isProjectOwner } from "./constants";

/**
 * ProjectMemberTable — quản lý thành viên dự án (S4-FE-TASK-1, SPEC-06 §13.4, TASK-SCREEN-004).
 *
 * Cổng ghi (thêm/đổi vai trò/xóa) = TASK.PROJECT.MANAGE_MEMBER (manage-member:project, sensitive —
 * owner-check ở server khi scope < Company) **HOẶC** `myProjectRole === 'Owner'` (S5-TASK-PROJROLE-1
 * đợt C, DECISIONS-04 D-24 — Owner luôn quản được thành viên CỦA CHÍNH dự án mình dù pair hệ thống
 * chỉ cấp scope hẹp hơn; BE `assertGovern` là người quyết cuối, đây CHỈ là ẩn/hiện). `myProjectRole`
 * là prop tuỳ chọn do trang cha (ProjectDetailPage) truyền xuống từ project detail đã tải — component
 * KHÔNG tự fetch lại. Đọc dùng CHUNG data-scope với project detail (server 404 nếu ngoài scope —
 * component KHÔNG tự gate đọc, cha đã đảm bảo project load được).
 */
const ROLE_OPTIONS: readonly ProjectRoleDto[] = ["Owner", "Manager", "Member", "Viewer"];

function MemberStatusBadge({ status }: { status: string | null }) {
  const { t } = useTranslation("tasks");
  if (!status) return <span className="text-sm text-muted-foreground">—</span>;
  const active = status === "Active";
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {t(`projects.members.memberStatus.${status}`)}
    </Badge>
  );
}

function RoleCell({
  member,
  projectId,
  canManage,
}: {
  member: MemberResponseDto;
  projectId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (role: ProjectRoleDto) =>
      taskProjectApi.updateMemberRole(projectId, member.id, { projectRole: role }),
    onSuccess: async () => {
      await Promise.all(
        taskProjectInvalidation
          .members(projectId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
    },
  });

  if (!canManage || member.status !== "Active") {
    return (
      <span className="text-sm">
        {member.projectRole ? t(`projects.members.role.${member.projectRole}`) : "—"}
      </span>
    );
  }

  return (
    <Select
      className="h-8 w-32"
      value={member.projectRole ?? ""}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as ProjectRoleDto)}
    >
      {ROLE_OPTIONS.map((r) => (
        <option key={r} value={r}>
          {t(`projects.members.role.${r}`)}
        </option>
      ))}
    </Select>
  );
}

// ── Add member dialog ─────────────────────────────────────────────────────────
const addMemberSchema = z.object({
  employeeId: z.string().min(1, "Cần chọn nhân viên"),
  projectRole: z.enum(["Owner", "Manager", "Member", "Viewer"]),
});
type AddMemberFormValues = z.infer<typeof addMemberSchema>;

function AddMemberDialog({
  projectId,
  existingEmployeeIds,
  onClose,
}: {
  projectId: string;
  existingEmployeeIds: readonly (string | null)[];
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const { data: employeesPage } = useQuery({
    queryKey: hrKeys.employees.list({ pageSize: 100, status: "active" }),
    queryFn: () => hrApi.listEmployees({ pageSize: 100, status: "active" }),
    staleTime: 60_000,
  });
  const candidates = (employeesPage?.items ?? []).filter(
    (e) => !existingEmployeeIds.includes(e.id),
  );

  const form = useForm<AddMemberFormValues>({
    resolver: zodResolver(addMemberSchema),
    defaultValues: { employeeId: "", projectRole: "Member" },
  });

  const mutation = useMutation({
    mutationFn: (values: AddMemberFormValues) => taskProjectApi.addMember(projectId, values),
    onSuccess: async () => {
      await Promise.all(
        taskProjectInvalidation
          .members(projectId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });

  const busy = mutation.isPending;
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t("projects.members.addDialog.title")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("projects.members.addDialog.cancel")}
          </Button>
          <Button type="submit" form="add-member-form" disabled={busy}>
            {t("projects.members.addDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("projects.members.error.description")}
        </p>
      )}
      <form
        id="add-member-form"
        noValidate
        className="space-y-4"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <div className="space-y-1.5">
          <label htmlFor="member-employee" className="text-sm font-medium text-foreground">
            {t("projects.members.addDialog.employeeLabel")}
          </label>
          <Select id="member-employee" {...form.register("employeeId")}>
            <option value="">{t("projects.members.addDialog.employeePlaceholder")}</option>
            {candidates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </Select>
          {form.formState.errors.employeeId && (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.employeeId.message}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="member-role" className="text-sm font-medium text-foreground">
            {t("projects.members.addDialog.roleLabel")}
          </label>
          <Select id="member-role" {...form.register("projectRole")}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {t(`projects.members.role.${r}`)}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Dialog>
  );
}

// ── Remove member confirm dialog ────────────────────────────────────────────
function RemoveMemberDialog({
  projectId,
  member,
  onClose,
}: {
  projectId: string;
  member: MemberResponseDto;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => taskProjectApi.removeMember(projectId, member.id),
    onSuccess: async () => {
      await Promise.all(
        taskProjectInvalidation
          .members(projectId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });
  const noop = () => {};

  return (
    <Dialog
      open
      onClose={mutation.isPending ? noop : onClose}
      title={t("projects.members.removeDialog.title")}
      description={t("projects.members.removeDialog.description", {
        name: member.employeeName ?? "",
      })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t("projects.members.removeDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {t("projects.members.removeDialog.confirm")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("projects.members.error.description")}
        </p>
      )}
    </Dialog>
  );
}

// ── Main table ──────────────────────────────────────────────────────────────
export function ProjectMemberTable({
  projectId,
  myProjectRole = null,
}: {
  projectId: string;
  /** Vai trò của CHÍNH actor trong dự án (server tính — TaskProjectResponseDto.myProjectRole). */
  myProjectRole?: ProjectRoleDto | null;
}) {
  const { t } = useTranslation("tasks");
  const canManagePair = useCan(
    TASK_ENGINE_PAIRS.MANAGE_MEMBER_PROJECT.action,
    TASK_ENGINE_PAIRS.MANAGE_MEMBER_PROJECT.resourceType,
  );
  // D-24: Owner của CHÍNH dự án luôn quản được thành viên dù pair hệ thống chỉ cấp scope hẹp hơn.
  const canManage = canManagePair || isProjectOwner(myProjectRole);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberResponseDto | null>(null);

  const query = useQuery({
    queryKey: taskKeys.projects.members(projectId),
    queryFn: () => taskProjectApi.listMembers(projectId),
    staleTime: 30_000,
  });

  const columns: ColumnDef<MemberResponseDto>[] = [
    {
      accessorKey: "employeeName",
      header: t("projects.members.columns.employee"),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.employeeName ?? "—"}</span>
      ),
    },
    {
      accessorKey: "employeeCode",
      header: t("projects.members.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.employeeCode ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "departmentName",
      header: t("projects.members.columns.department"),
      cell: ({ row }) => <span className="text-sm">{row.original.departmentName ?? "—"}</span>,
    },
    {
      id: "projectRole",
      header: t("projects.members.columns.role"),
      cell: ({ row }) => (
        <RoleCell member={row.original} projectId={projectId} canManage={canManage} />
      ),
    },
    {
      accessorKey: "status",
      header: t("projects.members.columns.status"),
      cell: ({ row }) => <MemberStatusBadge status={row.original.status} />,
    },
    ...(canManage
      ? [
          {
            id: "actions",
            header: () => <span className="sr-only">{t("projects.members.columns.actions")}</span>,
            cell: ({ row }: { row: { original: MemberResponseDto } }) =>
              row.original.status === "Active" ? (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("projects.members.removeAction")}
                    onClick={() => setRemoveTarget(row.original)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ) : null,
          } satisfies ColumnDef<MemberResponseDto>,
        ]
      : []),
  ];

  if (query.isError) {
    return (
      <EmptyState
        title={t("projects.members.error.title")}
        description={t("projects.members.error.description")}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("actions.retry", { ns: "common" })}
          </Button>
        }
      />
    );
  }

  const members = query.data ?? [];
  const existingEmployeeIds = members.map((m) => m.employeeId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">{t("projects.members.title")}</h3>
        {canManage && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t("projects.members.addButton")}
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={members}
        isLoading={query.isLoading}
        emptyState={
          <EmptyState
            title={t("projects.members.empty.title")}
            description={t("projects.members.empty.description")}
          />
        }
        pageSize={10}
      />

      {addOpen && (
        <AddMemberDialog
          projectId={projectId}
          existingEmployeeIds={existingEmployeeIds}
          onClose={() => setAddOpen(false)}
        />
      )}
      {removeTarget && (
        <RemoveMemberDialog
          projectId={projectId}
          member={removeTarget}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}
