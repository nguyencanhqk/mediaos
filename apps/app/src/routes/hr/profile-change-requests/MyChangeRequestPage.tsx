/**
 * S2-FE-HR-4 — HR-SCREEN-016/017: /hr/me/change-request.
 * Employee tự gửi yêu cầu sửa hồ sơ (create:profile-change-request, Own) + xem danh sách yêu cầu
 * của chính mình (GET /hr/profile-change-requests/me).
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { FileEdit, RefreshCw, Plus } from "lucide-react";
import type { ProfileChangeRequestListItem, CreateProfileChangeRequest } from "@mediaos/contracts";
import { hrApi, hrKeys, hrInvalidation, ApiError, PermissionGate } from "@mediaos/web-core";
import { PageHeader, DataTable, EmptyState, Button, Dialog } from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
import { ProfileChangeStatusBadge } from "./status-badge";
import { ChangeRequestForm } from "./ChangeRequestForm";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];

function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("changeRequest.form.errors.badRequest");
    if (err.status === 403) return t("changeRequest.form.errors.forbidden");
  }
  return t("changeRequest.form.errors.generic");
}

function useColumns(
  t: TF,
  onView: (id: string) => void,
): ColumnDef<ProfileChangeRequestListItem>[] {
  return [
    {
      accessorKey: "submittedAt",
      header: t("changeRequest.columns.submittedAt"),
      cell: ({ row }) => (
        <span className="text-sm">
          {new Date(row.original.submittedAt).toLocaleString("vi-VN")}
        </span>
      ),
    },
    {
      accessorKey: "changedFields",
      header: t("changeRequest.columns.changedFields"),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.changedFields.length}</span>
      ),
    },
    {
      accessorKey: "status",
      header: t("changeRequest.columns.status"),
      cell: ({ row }) => <ProfileChangeStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: "reviewedByName",
      header: t("changeRequest.columns.reviewedBy"),
      cell: ({ row }) => <span className="text-sm">{row.original.reviewedByName ?? "—"}</span>,
    },
    {
      id: "actions",
      header: t("changeRequest.columns.actions"),
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => onView(row.original.id)}>
          {t("changeRequest.actions.view")}
        </Button>
      ),
    },
  ];
}

export function MyChangeRequestPage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: hrKeys.profileChangeRequests.mine(),
    queryFn: () => hrApi.listMyProfileChangeRequests(),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateProfileChangeRequest) => hrApi.createProfileChangeRequest(dto),
    onSuccess: async () => {
      for (const queryKey of hrInvalidation.createChangeRequest()) {
        await queryClient.invalidateQueries({ queryKey });
      }
      setFormOpen(false);
    },
  });

  const columns = useColumns(
    t,
    (id) => void navigate({ to: "/hr/profile-change-requests/$id", params: { id } }),
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("changeRequest.mine.error.title")}
          description={t("changeRequest.mine.error.description")}
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

  const items = data?.items ?? [];

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("changeRequest.mine.title")}
        description={t("changeRequest.mine.description")}
        icon={FileEdit}
        actions={
          <PermissionGate
            action={HR_ENGINE_PAIRS.CREATE_PROFILE_CHANGE_REQUEST.action}
            resourceType={HR_ENGINE_PAIRS.CREATE_PROFILE_CHANGE_REQUEST.resourceType}
          >
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("changeRequest.mine.newRequest")}
            </Button>
          </PermissionGate>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title={t("changeRequest.mine.empty.title")}
            description={t("changeRequest.mine.empty.description")}
          />
        }
        pageSize={20}
      />

      {formOpen && (
        <Dialog
          open
          onClose={() => {
            createMutation.reset();
            setFormOpen(false);
          }}
          title={t("changeRequest.form.title")}
        >
          <ChangeRequestForm
            onSubmit={(dto) => createMutation.mutate(dto)}
            onCancel={() => {
              createMutation.reset();
              setFormOpen(false);
            }}
            isSubmitting={createMutation.isPending}
            submitError={
              createMutation.isError ? submitErrorMessage(createMutation.error, t) : undefined
            }
          />
        </Dialog>
      )}
    </div>
  );
}
