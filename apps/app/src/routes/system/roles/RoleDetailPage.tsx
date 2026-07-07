/**
 * SYSTEM-SCREEN-ROLE-DETAIL (S2-FE-AUTH-4 · lane FE batch C) — chi tiết role.
 *
 * Nguồn dữ liệu: GET /auth/roles (catalog list, find-by-id — KHÔNG có GET /auth/roles/:id ở BE hiện tại).
 * "Danh sách permission đã gán" CHƯA hiển thị được trực tiếp (BE S2-AUTH-BE-6 chỉ có assign/revoke, KHÔNG
 * có list-by-role) — thay bằng ghi chú + link sang công cụ Quản lý quyền (RolePermissionsPage).
 *
 * States: forbidden · loading · error/not-found · detail.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Shield, RefreshCw, ArrowLeft, Pencil, KeyRound, Copy } from "lucide-react";
import { roleAdminApi, authKeys, useCan, PermissionGate } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Card, CardContent, Badge } from "@mediaos/ui";
import { SYSTEM_ENGINE_PAIRS } from "../constants";
import { RoleMembersTab } from "./RoleMembersTab";
import { CloneRoleDialog } from "./CloneRoleDialog";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-2 py-2 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="text-foreground">{value ?? "—"}</span>
    </div>
  );
}

interface RoleDetailPageProps {
  roleId: string;
  onBack?: () => void;
  onEdit?: () => void;
  onManagePermissions?: () => void;
  /** S2-AUTH-PERMUX-1 — điều hướng sang role khác (sau nhân bản). */
  onOpenRole?: (roleId: string) => void;
}

export function RoleDetailPage({
  roleId,
  onBack,
  onEdit,
  onManagePermissions,
  onOpenRole,
}: RoleDetailPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  // S2-AUTH-ROLEMEM-1 — tab switcher cục bộ (Thông tin | Thành viên). Không có Tabs primitive
  // trong packages/ui → 2 Button + state, không thêm dependency.
  const [tab, setTab] = useState<"info" | "members">("info");
  // S2-AUTH-PERMUX-1 (#3) — dialog nhân bản vai trò.
  const [cloneOpen, setCloneOpen] = useState(false);
  const canView = useCan(
    SYSTEM_ENGINE_PAIRS.READ_ROLE.action,
    SYSTEM_ENGINE_PAIRS.READ_ROLE.resourceType,
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: authKeys.roles.list(),
    queryFn: () => roleAdminApi.listRoles(),
    enabled: canView,
    staleTime: 30_000,
  });
  const role = data?.find((r) => r.id === roleId);

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("roles.forbidden.title")}
          description={t("roles.forbidden.description")}
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={Shield} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error / not found ──────────────────────────────────────────────────────
  if (isError || !role) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("roleDetail.error.title")}
          description={t("roleDetail.error.description")}
          action={
            <div className="flex gap-2">
              {onBack && (
                <Button variant="outline" size="sm" onClick={onBack}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t("roleDetail.backToList")}
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
    <div className="space-y-6 p-6">
      <PageHeader
        title={role.name}
        description={role.isSystem ? t("roleDetail.systemRole") : t("roleDetail.companyRole")}
        icon={Shield}
        actions={
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="outline" size="sm" onClick={onBack}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("roleDetail.backToList")}
              </Button>
            )}
            {onManagePermissions && (
              <PermissionGate
                action={SYSTEM_ENGINE_PAIRS.ASSIGN_PERMISSION.action}
                resourceType={SYSTEM_ENGINE_PAIRS.ASSIGN_PERMISSION.resourceType}
              >
                <Button variant="outline" size="sm" onClick={onManagePermissions}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  {t("roleDetail.managePermissions")}
                </Button>
              </PermissionGate>
            )}
            {/* S2-AUTH-PERMUX-1 (#3) — nhân bản: cần create:role (tạo) + assign:permission (copy grants);
                gate nút theo create:role, bước copy server-gated per-request. */}
            <PermissionGate
              action={SYSTEM_ENGINE_PAIRS.CREATE_ROLE.action}
              resourceType={SYSTEM_ENGINE_PAIRS.CREATE_ROLE.resourceType}
            >
              <Button variant="outline" size="sm" onClick={() => setCloneOpen(true)}>
                <Copy className="mr-2 h-4 w-4" />
                {t("roleClone.button")}
              </Button>
            </PermissionGate>
            {onEdit && !role.isSystem && (
              <PermissionGate
                action={SYSTEM_ENGINE_PAIRS.UPDATE_ROLE.action}
                resourceType={SYSTEM_ENGINE_PAIRS.UPDATE_ROLE.resourceType}
              >
                <Button size="sm" onClick={onEdit}>
                  <Pencil className="mr-2 h-4 w-4" />
                  {t("roleDetail.edit")}
                </Button>
              </PermissionGate>
            )}
          </div>
        }
      >
        {role.isSystem && <Badge variant="warning">{t("roleDetail.systemBadge")}</Badge>}
      </PageHeader>

      {/* S2-AUTH-ROLEMEM-1 — tab switcher */}
      <div className="flex items-center gap-1 border-b border-border" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "info"}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "info"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("info")}
        >
          {t("roleDetail.tabs.info")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "members"}
          className={`border-b-2 px-3 py-2 text-sm font-medium ${
            tab === "members"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setTab("members")}
        >
          {t("roleDetail.tabs.members")}
        </button>
      </div>

      {tab === "info" ? (
        <>
          <Card>
            <CardContent className="divide-y divide-border pt-4">
              <FieldRow label={t("roleDetail.fields.name")} value={role.name} />
              <FieldRow label={t("roleDetail.fields.description")} value={role.description} />
              <FieldRow
                label={t("roleDetail.fields.type")}
                value={role.isSystem ? t("roleDetail.systemRole") : t("roleDetail.companyRole")}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <p className="text-sm text-muted-foreground">
                {t("roleDetail.assignedPermissionsNotice")}
              </p>
            </CardContent>
          </Card>
        </>
      ) : (
        <RoleMembersTab roleId={roleId} />
      )}

      <CloneRoleDialog
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        sourceRoleId={roleId}
        sourceRoleName={role.name}
        onCloned={(newRoleId) => {
          setCloneOpen(false);
          onOpenRole?.(newRoleId);
        }}
      />
    </div>
  );
}
