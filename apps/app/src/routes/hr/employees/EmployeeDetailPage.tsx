import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Users, RefreshCw, ArrowLeft, Pencil, FileText, Camera, Trash2 } from "lucide-react";
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
// Banner cover dùng CHUNG với /me/profile (MyProfilePage) — tránh 2 màn trôi khỏi nhau về hiển thị.
import { ProfileCoverHeader, COVER_ACTION_BUTTON_CLASS } from "./profile-cover-header";
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
// S5-HR-AVATAR-1 — HR/admin đổi/gỡ avatar của NHÂN VIÊN KHÁC (gate update:employee).
import { useEmployeeAvatar } from "./use-employee-avatar";
import { AVATAR_ACCEPT_ATTR } from "../../me/use-me-avatar";

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
  // S5-HR-AVATAR-1 — đổi/gỡ avatar NHÂN VIÊN KHÁC (gate update:employee, server chốt cuối).
  const {
    canManage: canManageAvatar,
    upload: avatarUpload,
    remove: avatarRemove,
    inputRef: avatarInputRef,
    openPicker: openAvatarPicker,
    onFileSelected: onAvatarFileSelected,
    validationError: avatarValidationError,
  } = useEmployeeAvatar(employeeId);

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

  // S5-HR-AVATAR-1 — thông điệp lỗi validate/upload/remove avatar (KHÔNG nuốt — silent-failure).
  const avatarErrorMessage = avatarValidationError
    ? t(`detail.avatar.error.${avatarValidationError}`)
    : avatarUpload.isError
      ? t("detail.avatar.error.upload")
      : avatarRemove.isError
        ? t("detail.avatar.error.remove")
        : null;

  return (
    <div className="space-y-4 p-6">
      {/* Cover header: avatar + tên + mã + chức vụ – đơn vị + trạng thái. Banner dùng CHUNG với
          /me/profile (ProfileCoverHeader) — avatar truyền qua slot vì scope quyền khác nhau: ở đây là
          đổi ảnh NHÂN VIÊN KHÁC (update:employee), còn /me/profile là own-scope qua /me/avatar. */}
      <ProfileCoverHeader
        fullName={data.fullName}
        employeeCode={data.employeeCode}
        positionName={data.positionName}
        orgUnitName={data.orgUnitName}
        status={data.status}
        avatar={
          <div className="flex flex-col items-center gap-1.5">
            <Avatar
              size="lg"
              name={data.fullName}
              src={data.avatarUrl}
              className="ring-2 ring-white/70"
            />
            {canManageAvatar && (
              <>
                <div className="flex flex-wrap justify-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-7 px-2 text-xs ${COVER_ACTION_BUTTON_CLASS}`}
                    onClick={openAvatarPicker}
                    disabled={avatarUpload.isPending || avatarRemove.isPending}
                  >
                    <Camera className="mr-1 h-3 w-3" />
                    {avatarUpload.isPending
                      ? t("detail.avatar.uploading")
                      : t("detail.avatar.change")}
                  </Button>
                  {data.avatarUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-white hover:bg-white/20"
                      onClick={() => avatarRemove.mutate()}
                      disabled={avatarUpload.isPending || avatarRemove.isPending}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />
                      {avatarRemove.isPending
                        ? t("detail.avatar.removing")
                        : t("detail.avatar.remove")}
                    </Button>
                  )}
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept={AVATAR_ACCEPT_ATTR}
                  className="hidden"
                  onChange={onAvatarFileSelected}
                />
              </>
            )}
          </div>
        }
        actions={
          <>
            {onBack && (
              <Button
                variant="outline"
                size="sm"
                className={COVER_ACTION_BUTTON_CLASS}
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
                  className={COVER_ACTION_BUTTON_CLASS}
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
          </>
        }
      />

      {/* S5-HR-AVATAR-1 — lỗi validate/upload/remove avatar (KHÔNG nuốt — silent-failure). */}
      {canManageAvatar && avatarErrorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {avatarErrorMessage}
        </p>
      )}

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
