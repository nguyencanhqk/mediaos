/**
 * "Đề nghị cập nhật hồ sơ" dạng SỬA TRỰC TIẾP — /me/profile/edit.
 *
 * Bố cục mirror màn sửa nhân viên (/hr/employees/:id/edit): thanh Lưu/Hủy DÍNH đầu trang + các section
 * dạng card. Khác biệt cốt lõi so với màn HR: nhân viên KHÔNG PATCH thẳng hồ sơ mình — bấm "Gửi yêu
 * cầu" tạo một profile-change-request (POST /hr/profile-change-requests) để HR/Quản trị viên duyệt.
 * `changedFields` SUY RA từ chênh lệch giá trị (xem profile-edit-form.ts), user không phải tick chọn.
 *
 * Chỉ render ô cho PROFILE_CHANGE_ALLOWED_FIELDS — field ngoài danh sách server sẽ chặn (HR-ERR-040),
 * hiện ô cho chúng = mời người dùng gõ vào chỗ sẽ bị nuốt.
 *
 * Masking là việc SERVER: field thiếu quyền trả null → ô rỗng. UI nói rõ bằng `edit.maskedHint` để
 * người dùng không tưởng hồ sơ đang trống.
 */
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileEdit, ArrowLeft, RefreshCw } from "lucide-react";
import type { CreateProfileChangeRequest } from "@mediaos/contracts";
import { hrApi, hrKeys, hrInvalidation, useCan, useCanExact, ApiError } from "@mediaos/web-core";
import {
  PageHeader,
  EmptyState,
  Button,
  Input,
  Select,
  Card,
  CardContent,
  Dialog,
} from "@mediaos/ui";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import { HR_ENGINE_PAIRS } from "../constants";
import { PROFILE_CHANGE_FIELD_META } from "./field-labels";
import { PCR_CREATE_PERMISSION } from "./constants";
import {
  PROFILE_EDIT_GROUPS,
  buildChangeRequestDto,
  clearedFieldsOf,
  profileToEditValues,
  type ProfileEditField,
  type ProfileEditValues,
} from "./profile-edit-form";

type TF = ReturnType<typeof useTranslation<"hr">>["t"];

/** Sau khi gửi thành công, nút OK đưa người dùng về danh sách yêu cầu của chính họ. */
const MY_CHANGE_REQUESTS_PATH = "/me/profile/change-requests";
const MY_PROFILE_PATH = "/me/profile";

function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("changeRequest.form.errors.badRequest");
    if (err.status === 403) return t("changeRequest.form.errors.forbidden");
  }
  return t("changeRequest.form.errors.generic");
}

interface FormValues extends ProfileEditValues {
  reason: string;
}

export function MyProfileEditPage() {
  const { t } = useTranslation("hr");
  const { t: tc } = useTranslation("common");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pcrAction, pcrResourceType] = PCR_CREATE_PERMISSION.split(":");
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const canRequest = useCan(pcrAction as string, pcrResourceType as string);
  // Cùng cổng với read surface: nhóm Cá nhân/Liên hệ theo view-sensitive, nhóm Giấy tờ theo
  // view-identity (useCanExact — cặp is_sensitive, KHÔNG cho *:* fall-through).
  const canViewSensitive = useCan(
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.action,
    HR_ENGINE_PAIRS.VIEW_SENSITIVE.resourceType,
  );
  const canViewIdentity = useCanExact(
    HR_ENGINE_PAIRS.VIEW_IDENTITY.action,
    HR_ENGINE_PAIRS.VIEW_IDENTITY.resourceType,
  );

  const profileQuery = useQuery({
    queryKey: hrKeys.employees.me(),
    queryFn: () => hrApi.getMyProfile(),
    enabled: canRequest,
    staleTime: 60_000,
    retry: (failCount, err) => {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 403) return false;
      return failCount < 2;
    },
  });

  // Ảnh chụp giá trị ban đầu — mốc so sánh để suy ra changedFields.
  const initialValues = useMemo<ProfileEditValues | null>(
    () => (profileQuery.data ? profileToEditValues(profileQuery.data) : null),
    [profileQuery.data],
  );

  const {
    register,
    handleSubmit,
    formState: { isDirty },
  } = useForm<FormValues>({
    // `values` (không phải defaultValues): form tự đồng bộ khi profile về, không cần reset thủ công.
    values: initialValues ? { ...initialValues, reason: "" } : undefined,
  });

  const mutation = useMutation({
    mutationFn: (dto: CreateProfileChangeRequest) => hrApi.createProfileChangeRequest(dto),
    onSuccess: async () => {
      for (const queryKey of hrInvalidation.createChangeRequest()) {
        await queryClient.invalidateQueries({ queryKey });
      }
      setSubmitted(true);
    },
  });

  // Gửi xong → tắt dirty-guard, nếu không hộp thoại "rời trang?" sẽ chặn chính điều hướng sau khi OK.
  useDirtyFormGuard({ isDirty: isDirty && !submitted });

  const onSubmit = (values: FormValues) => {
    if (!initialValues) return;
    setLocalError(null);
    const { reason, ...current } = values;

    // Xoá trắng ô đang có giá trị: server đòi giá trị mới không rỗng ⇒ nếu im lặng bỏ qua, người dùng
    // tưởng đã gửi được. Chặn tại đây với thông điệp rõ.
    if (clearedFieldsOf(initialValues, current).length > 0) {
      setLocalError(t("changeRequest.edit.clearedNotAllowed"));
      return;
    }

    const dto = buildChangeRequestDto(initialValues, current, reason);
    if (!dto) {
      setLocalError(t("changeRequest.edit.noChanges"));
      return;
    }
    mutation.mutate(dto);
  };

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canRequest) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("employees.forbidden.title")}
          description={t("changeRequest.form.errors.forbidden")}
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (profileQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={t("changeRequest.edit.title")} icon={FileEdit} />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (profileQuery.isError || !profileQuery.data || !initialValues) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("me.error.title")}
          description={t("me.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void profileQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const busy = mutation.isPending;
  const goToMyRequests = () => void navigate({ to: MY_CHANGE_REQUESTS_PATH as "/" });

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6 p-6">
      {/* Thanh hành động dính đầu trang — cùng kiểu với /hr/employees/:id/edit (form dài, nút phải luôn
          trong tầm tay). Khung cuộn là <main> của workspace nên sticky top-0 dính đúng mép nội dung. */}
      <div className="sticky top-0 z-20 -mx-6 -mt-6 space-y-3 border-b border-border bg-background px-6 py-4">
        <PageHeader
          title={t("changeRequest.edit.title")}
          description={t("changeRequest.edit.description")}
          icon={FileEdit}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void navigate({ to: MY_PROFILE_PATH as "/" })}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("changeRequest.form.cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? t("changeRequest.form.submitting") : t("changeRequest.form.submit")}
              </Button>
            </>
          }
        />

        {/* Lỗi hiển thị TRONG thanh dính: nút Gửi ở đầu trang nên người dùng bấm được khi đang ở cuối —
            để lỗi ở luồng thường thì submit hỏng sẽ không ai thấy. */}
        {(localError || mutation.isError) && (
          <p
            role="alert"
            aria-live="assertive"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {localError ?? submitErrorMessage(mutation.error, t)}
          </p>
        )}
      </div>

      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {t("changeRequest.edit.reviewNotice")}
      </p>

      {PROFILE_EDIT_GROUPS.map((group) => {
        const groupMasked = group.sensitive ? !canViewIdentity : !canViewSensitive;
        return (
          <Card key={group.id} id={group.id}>
            <CardContent className="space-y-4 pt-5">
              <h3 className="text-sm font-semibold text-foreground">{t(group.labelKey)}</h3>
              {groupMasked && (
                <p className="text-xs text-muted-foreground">
                  {t("changeRequest.edit.maskedHint")}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <EditField key={field} field={field} register={register} t={t} />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardContent className="space-y-2 pt-5">
          <label htmlFor="reason" className="text-sm font-medium text-foreground">
            {t("changeRequest.form.reasonLabel")}
          </label>
          <textarea
            id="reason"
            rows={3}
            {...register("reason")}
            placeholder={t("changeRequest.form.reasonPlaceholder")}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:outline-none"
          />
        </CardContent>
      </Card>

      {/* Gửi xong → thông báo CHỜ DUYỆT. onClose dùng chung handler với OK để không có ngõ cụt
          (đóng bằng Esc/click nền vẫn về đúng danh sách yêu cầu). */}
      <Dialog
        open={submitted}
        onClose={goToMyRequests}
        title={t("changeRequest.edit.success.title")}
        description={t("changeRequest.edit.success.description")}
        footer={
          <Button type="button" onClick={goToMyRequests}>
            {t("changeRequest.edit.success.ok")}
          </Button>
        }
      >
        <></>
      </Dialog>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Ô nhập một field — kiểu input lấy từ PROFILE_CHANGE_FIELD_META (nguồn chung với form tick-chọn).
// ---------------------------------------------------------------------------
function EditField({
  field,
  register,
  t,
}: {
  field: ProfileEditField;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  t: TF;
}) {
  const meta = PROFILE_CHANGE_FIELD_META[field];
  return (
    <div className="space-y-1.5">
      <label htmlFor={`edit-${field}`} className="text-sm font-medium text-foreground">
        {t(meta.labelKey)}
      </label>
      {meta.inputType === "select" ? (
        <Select id={`edit-${field}`} {...register(field)}>
          <option value="">{t("form.placeholders.select")}</option>
          {meta.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(opt.labelKey)}
            </option>
          ))}
        </Select>
      ) : (
        <Input
          id={`edit-${field}`}
          type={meta.inputType === "date" ? "date" : "text"}
          {...register(field)}
        />
      )}
    </div>
  );
}
