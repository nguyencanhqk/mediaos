/**
 * UI-SYSTEM-SCREEN-003 (S2-FE-AUTH-3) — /system/users/new + /system/users/:id/edit.
 *
 * create → POST /auth/users (mật khẩu hash ở SERVER — BẤT BIẾN #3, plaintext CHỈ ra khỏi form khi
 * submit, KHÔNG log/console). edit → PATCH /auth/users/:id (CHỈ fullName — email immutable, đổi
 * trạng thái khoá qua /system/users/:id detail page riêng).
 *
 * Permission gate: useCan("create"|"update", "user") — cặp canonical S2-AUTH-BE-3
 * (SYSTEM_ENGINE_PAIRS.CREATE_USER / UPDATE_USER). Server enforce lại — client chỉ ẩn/disable UI.
 *
 * States covered: loading (edit prefill) · error (edit prefill fail) · forbidden · submit error.
 */
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus, UserCog, ArrowLeft, RefreshCw } from "lucide-react";
import { authUsersApi, authUsersKeys, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Input, Card, CardContent } from "@mediaos/ui";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import { SYSTEM_ENGINE_PAIRS } from "../constants";
import {
  EMPTY_USER_FORM,
  detailToFormValues,
  userFormSchema,
  toCreateDto,
  toUpdateDto,
  type UserFormMode,
  type UserFormValues,
} from "./user-form-schema";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

// ---------------------------------------------------------------------------
// Friendly submit error → i18n key (no internal detail leaked)
// ---------------------------------------------------------------------------
function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return t("users.form.errors.conflict");
    if (err.status === 403) return t("users.form.errors.forbidden");
    if (err.status === 422 || err.status === 400) return t("users.form.errors.validation");
    if (err.status >= 500) return t("users.form.errors.server");
  }
  return t("users.form.errors.generic");
}

function fieldError(err: { message?: string } | undefined, t: TF): string | undefined {
  return err ? t(err.message ?? "") : undefined;
}

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------
function Field({
  id,
  label,
  required,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
interface UserFormPageProps {
  /** Present → edit mode; absent → create mode. */
  userId?: string;
  onSuccess?: (userId: string) => void;
  onCancel?: () => void;
}

export function UserFormPage({ userId, onSuccess, onCancel }: UserFormPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();
  const mode: UserFormMode = userId ? "edit" : "create";

  const pair =
    mode === "create" ? SYSTEM_ENGINE_PAIRS.CREATE_USER : SYSTEM_ENGINE_PAIRS.UPDATE_USER;
  const canSubmit = useCan(pair.action, pair.resourceType);

  const detailQuery = useQuery({
    queryKey: authUsersKeys.detail(userId ?? ""),
    queryFn: () => authUsersApi.getUser(userId as string),
    enabled: mode === "edit" && canSubmit && !!userId,
    staleTime: 30_000,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema(mode)),
    mode: "onSubmit",
    defaultValues: EMPTY_USER_FORM,
  });

  // Pre-fill ONCE per user when the edit detail first arrives — same guard pattern as HR EmployeeFormPage
  // (a background refetch must not silently discard in-progress edits via reset()).
  const prefilledRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode === "edit" && detailQuery.data && prefilledRef.current !== userId) {
      prefilledRef.current = userId ?? null;
      reset(detailToFormValues(detailQuery.data));
    }
  }, [mode, detailQuery.data, userId, reset]);

  useDirtyFormGuard({ isDirty });

  const mutation = useMutation({
    mutationFn: async (values: UserFormValues): Promise<string> => {
      if (mode === "create") {
        const res = await authUsersApi.createUser(toCreateDto(values));
        return res.id;
      }
      const res = await authUsersApi.updateUser(userId as string, toUpdateDto(values));
      return res.id;
    },
    onSuccess: async (savedId) => {
      await queryClient.invalidateQueries({ queryKey: authUsersKeys.all });
      if (mode === "edit" && userId) {
        await queryClient.invalidateQueries({ queryKey: authUsersKeys.detail(userId) });
      }
      reset(EMPTY_USER_FORM);
      onSuccess?.(savedId);
    },
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canSubmit) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("users.forbidden.title")}
          description={t("users.form.forbidden.description")}
        />
      </div>
    );
  }

  // ── Edit: loading / error of the detail to pre-fill ──────────────────────────
  if (mode === "edit" && detailQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={UserCog} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (mode === "edit" && (detailQuery.isError || !detailQuery.data)) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("users.detail.error.title")}
          description={t("users.detail.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void detailQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const busy = isSubmitting || mutation.isPending;
  const submitDisabled = busy || (mode === "edit" && !isDirty);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={mode === "create" ? t("users.form.createTitle") : t("users.form.editTitle")}
        description={
          mode === "create" ? t("users.form.createDescription") : t("users.form.editDescription")
        }
        icon={mode === "create" ? UserPlus : UserCog}
        actions={
          onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("users.form.cancel")}
            </Button>
          )
        }
      />

      {mutation.isError && (
        <p
          role="alert"
          aria-live="assertive"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {submitErrorMessage(mutation.error, t)}
        </p>
      )}

      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        noValidate
        className="space-y-6"
      >
        <Card>
          <CardContent className="space-y-4 pt-5">
            <Field
              id="email"
              label={t("users.form.fields.email")}
              required={mode === "create"}
              error={fieldError(errors.email, t)}
              hint={mode === "edit" ? t("users.form.hints.emailImmutable") : undefined}
            >
              <Input
                id="email"
                type="email"
                autoComplete="off"
                disabled={mode === "edit"}
                {...register("email")}
              />
            </Field>

            <Field
              id="fullName"
              label={t("users.form.fields.fullName")}
              required
              error={fieldError(errors.fullName, t)}
            >
              <Input id="fullName" autoComplete="off" {...register("fullName")} />
            </Field>

            {mode === "create" && (
              <Field
                id="password"
                label={t("users.form.fields.initialPassword")}
                required
                hint={t("users.form.hints.initialPassword")}
                error={fieldError(errors.password, t)}
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  {...register("password")}
                />
              </Field>
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {t("users.form.cancel")}
            </Button>
          )}
          <Button type="submit" disabled={submitDisabled}>
            {busy
              ? t("users.form.submitting")
              : mode === "create"
                ? t("users.form.submitCreate")
                : t("users.form.submitSave")}
          </Button>
        </div>
      </form>
    </div>
  );
}
