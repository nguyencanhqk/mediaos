import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { User, RefreshCw, ListChecks } from "lucide-react";
import { hrApi, hrKeys, useCan, useCanExact, PermissionGate } from "@mediaos/web-core";
import {
  PageHeader,
  EmptyState,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@mediaos/ui";
import { HR_ENGINE_PAIRS } from "../constants";
// Section dùng chung với màn chi tiết nhân viên (/hr/employees/:id) — CÙNG shape dữ liệu:
// contracts khai `hrMeProfileSchema = hrEmployeeDetailSchema`, nên mọi section tái dùng nguyên vẹn.
import {
  BasicInfoSection,
  CompSection,
  ContactSection,
  IdentitySection,
  WorkInfoSection,
} from "../employees/profile-sections";
import { ProfileCoverHeader, COVER_ACTION_BUTTON_CLASS } from "../employees/profile-cover-header";
// S5-ME-FE-4 — avatar own-scope (GET/upload/remove /me/avatar). KHÁC màn chi tiết HR (đổi ảnh người
// khác qua update:employee): ở đây owner resolve 100% từ token ở BE, client KHÔNG gửi id.
import { MeBannerAvatar } from "../../me/components/MeBannerAvatar";
import { PCR_CREATE_PERMISSION } from "../profile-change-requests/constants";

/**
 * Đề nghị sửa hồ sơ = luồng change-request (nhân viên KHÔNG tự PATCH hồ sơ mình). Nút dẫn tới màn SỬA
 * TRỰC TIẾP (bố cục như /hr/employees/:id/edit) chứ không phải danh sách yêu cầu — gửi xong màn đó
 * mới đưa về /me/profile/change-requests.
 */
const ME_PROFILE_EDIT_PATH = "/me/profile/edit";

type Tab = "basic" | "contact" | "work" | "comp";

/**
 * "Hồ sơ của tôi" — /me/profile (và route cũ /hr/me).
 *
 * Bố cục DÙNG CHUNG với màn chi tiết nhân viên /hr/employees/:id: banner cover (ProfileCoverHeader) +
 * 4 tab Cơ bản/Liên hệ/Công việc/Lương dựng từ CÙNG bộ section (profile-sections). Khác biệt duy nhất
 * là scope: dữ liệu lấy từ GET /hr/me/profile (own-scope do server chốt) và avatar dùng own-scope
 * /me/avatar thay vì update:employee.
 *
 * Masking là việc SERVER: field thiếu quyền trả null → section hiện nhãn "bị ẩn do phân quyền".
 * Client KHÔNG tự suy luận/hiển thị thêm.
 */
export function MyProfilePage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("basic");
  const [pcrAction, pcrResourceType] = PCR_CREATE_PERMISSION.split(":");

  // /hr/me/profile — own scope enforced server-side; all authenticated users may call it
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

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: hrKeys.employees.me(),
    queryFn: () => hrApi.getMyProfile(),
    // All authenticated users can call this — server enforces Own scope
    enabled: true,
    staleTime: 60_000,
    retry: (failCount, err) => {
      const status = (err as { status?: number }).status;
      // 404 = not linked; 403 = no read:employee — both are definitive
      if (status === 404 || status === 403) return false;
      return failCount < 2;
    },
  });

  const notLinked = isError && (error as { status?: number })?.status === 404;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={t("me.title")} description={t("me.description")} icon={User} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Not linked ─────────────────────────────────────────────────────────────
  if (notLinked) {
    return (
      <div className="p-6">
        <PageHeader title={t("me.title")} description={t("me.description")} icon={User} />
        <div className="mt-8">
          <EmptyState title={t("me.notLinked.title")} description={t("me.notLinked.description")} />
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError || !data) {
    return (
      <div className="p-6">
        <PageHeader title={t("me.title")} description={t("me.description")} icon={User} />
        <div className="mt-8">
          <EmptyState
            title={t("me.error.title")}
            description={t("me.error.description")}
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {tc("actions.retry")}
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-6">
      <ProfileCoverHeader
        fullName={data.fullName}
        employeeCode={data.employeeCode}
        positionName={data.positionName}
        orgUnitName={data.orgUnitName}
        status={data.status}
        avatar={<MeBannerAvatar name={data.fullName} />}
        actions={
          // Không có nút "Sửa" như màn HR: nhân viên sửa hồ sơ mình qua luồng ĐỀ NGHỊ (change-request).
          <PermissionGate action={pcrAction} resourceType={pcrResourceType}>
            <Button
              variant="outline"
              size="sm"
              className={COVER_ACTION_BUTTON_CLASS}
              onClick={() => void navigate({ to: ME_PROFILE_EDIT_PATH as "/" })}
            >
              <ListChecks className="mr-2 h-4 w-4" />
              {t("changeRequest.edit.title")}
            </Button>
          </PermissionGate>
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="basic">{t("detail.tabs.basic")}</TabsTrigger>
          <TabsTrigger value="contact">{t("detail.tabs.contact")}</TabsTrigger>
          <TabsTrigger value="work">{t("detail.tabs.work")}</TabsTrigger>
          <TabsTrigger value="comp">{t("detail.tabs.comp")}</TabsTrigger>
        </TabsList>
        <TabsContent value="basic" className="space-y-4 pt-4">
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
          {/* KHÔNG truyền onNavigateEmployee → tên quản lý hiện dạng text (không điều hướng sang hồ sơ
              người khác từ màn own-scope). */}
          <WorkInfoSection employee={data} t={t} canViewSensitive={canViewSensitive} />
        </TabsContent>
        <TabsContent value="comp" className="pt-4">
          <CompSection employee={data} t={t} canViewSalary={canViewSalary} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
