/**
 * AccountLinkSection — S5-HR-LINKUI-1 (HR-FUNC-011, SPEC-03 §14.11). Khối "Tài khoản đăng nhập" trên
 * trang chi tiết nhân viên: hiển thị trạng thái liên kết + nút Liên kết/Hủy liên kết. BE link/unlink ĐÃ
 * ship S2-HR-BE-2 (POST/DELETE /hr/employees/:id/link-user, gate update:employee) — component này CHỈ
 * là UI, KHÔNG hard-code role (PermissionGate/useCan theo cặp seed thật).
 *
 * Gate:
 *  - update:employee → ẩn/hiện nút Liên kết + Hủy liên kết (server enforce lại — FE chỉ affordance).
 *  - view:user (AUTH_USER.VIEW, is_sensitive=false) → mở dialog chọn user + đọc trạng thái tài khoản đã
 *    liên kết. Thiếu quyền này: nút "Liên kết tài khoản" vẫn hiện nhưng disabled + tooltip giải thích —
 *    KHÔNG lộ danh sách user cho caller thiếu quyền xem user.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { HrEmployeeDetail } from "@mediaos/contracts";
import { AUTH_USER } from "@mediaos/contracts";
import { authUsersApi, authUsersKeys, hrApi, hrKeys, useCan } from "@mediaos/web-core";
import { Badge, Button } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { HR_ENGINE_PAIRS } from "../constants";
import { FieldRow, SectionCard } from "./profile-sections";
import { LinkUserDialog } from "./LinkUserDialog";
import { unlinkUserErrorKey } from "./account-link-errors";

export function AccountLinkSection({
  employee,
  employeeId,
}: {
  employee: HrEmployeeDetail;
  employeeId: string;
}) {
  const { t } = useTranslation("hr");
  const { t: ts } = useTranslation("system");
  const queryClient = useQueryClient();
  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const canUpdateEmployee = useCan(
    HR_ENGINE_PAIRS.UPDATE_EMPLOYEE.action,
    HR_ENGINE_PAIRS.UPDATE_EMPLOYEE.resourceType,
  );
  const canViewUser = useCan(AUTH_USER.VIEW.action, AUTH_USER.VIEW.resource);
  const linked = employee.userId !== null;

  // Trạng thái tài khoản đã liên kết (active/invited/suspended/locked) — CHỈ gọi khi có view:user, để
  // KHÔNG round-trip vô ích (và không phụ thuộc server 403 để ẩn — FE tự gate trước).
  const linkedUserQuery = useQuery({
    queryKey: authUsersKeys.detail(employee.userId ?? ""),
    queryFn: () => authUsersApi.getUser(employee.userId as string),
    enabled: canViewUser && linked,
    staleTime: 30_000,
  });

  const unlinkMutation = useMutation({
    mutationFn: () => hrApi.unlinkUser(employeeId, { lockUser: false }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: hrKeys.employees.all }),
        queryClient.invalidateQueries({ queryKey: authUsersKeys.all }),
      ]);
      setUnlinkOpen(false);
    },
  });

  return (
    <SectionCard title={t("accountLink.title")}>
      <FieldRow
        label={t("accountLink.statusLabel")}
        value={
          <Badge variant={linked ? "default" : "secondary"}>
            {linked ? t("accountLink.statusLinked") : t("accountLink.statusNotLinked")}
          </Badge>
        }
      />
      {linked && <FieldRow label={t("accountLink.linkedEmail")} value={employee.email} />}
      {linked && canViewUser && linkedUserQuery.data && (
        <FieldRow
          label={t("accountLink.userStatus")}
          value={ts(`users.status.${linkedUserQuery.data.status}`)}
        />
      )}

      <div className="flex justify-end gap-2 pt-3">
        {!linked && canUpdateEmployee && (
          <Button
            type="button"
            size="sm"
            disabled={!canViewUser}
            title={canViewUser ? undefined : t("accountLink.needViewUserTooltip")}
            onClick={() => setLinkOpen(true)}
          >
            {t("accountLink.linkButton")}
          </Button>
        )}
        {linked && canUpdateEmployee && (
          <Button type="button" size="sm" variant="outline" onClick={() => setUnlinkOpen(true)}>
            {t("accountLink.unlinkButton")}
          </Button>
        )}
      </div>

      {unlinkMutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t(unlinkUserErrorKey(unlinkMutation.error))}
        </p>
      )}

      {linkOpen && <LinkUserDialog employeeId={employeeId} onClose={() => setLinkOpen(false)} />}

      {unlinkOpen && (
        <ConfirmDialog
          open
          title={t("accountLink.unlinkDialog.title")}
          description={t("accountLink.unlinkDialog.description", { email: employee.email ?? "" })}
          confirmLabel={t("accountLink.unlinkDialog.confirm")}
          cancelLabel={t("accountLink.unlinkDialog.cancel")}
          destructive
          busy={unlinkMutation.isPending}
          busyLabel={t("accountLink.unlinkDialog.submitting")}
          onConfirm={() => unlinkMutation.mutate()}
          onCancel={() => {
            if (unlinkMutation.isPending) return;
            unlinkMutation.reset();
            setUnlinkOpen(false);
          }}
        />
      )}
    </SectionCard>
  );
}
