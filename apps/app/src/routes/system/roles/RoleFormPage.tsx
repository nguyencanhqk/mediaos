/**
 * SYSTEM-SCREEN-ROLE-FORM (S2-FE-AUTH-4 · lane FE batch C) — tạo/sửa role.
 *
 * API: POST /auth/roles (create:role) · PATCH /auth/roles/:id (update:role) — role-admin.controller.ts.
 * System role (isSystem=true) → server REJECT 400; FE disable TOÀN BỘ field + submit + hiển thị banner
 * (defense-in-depth, KHÔNG thay cho gate server).
 *
 * States: forbidden · loading (edit: tải role để prefill) · error/not-found · form.
 */
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldPlus, ShieldCheck, ArrowLeft, RefreshCw, Lock } from "lucide-react";
import { roleAdminApi, authKeys, useCan, ApiError } from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Input, Card, CardContent } from "@mediaos/ui";
import { useDirtyFormGuard } from "@/hooks/use-dirty-form-guard";
import { SYSTEM_ENGINE_PAIRS } from "../constants";
import {
  EMPTY_ROLE_FORM,
  roleFormSchema,
  roleToFormValues,
  toCreateRoleDto,
  toUpdateRoleDto,
  type RoleFormValues,
} from "./role-form-schema";

type TF = ReturnType<typeof useTranslation<"system">>["t"];
type DirtyMap = Partial<Record<keyof RoleFormValues, boolean | undefined>>;

function submitErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return t("roleForm.errors.systemRole");
    if (err.status === 409) return t("roleForm.errors.conflict");
    if (err.status === 403) return t("roleForm.errors.forbidden");
    if (err.status === 422) return t("roleForm.errors.validation");
    if (err.status >= 500) return t("roleForm.errors.server");
  }
  return t("roleForm.errors.generic");
}

function fieldError(err: { message?: string } | undefined, t: TF): string | undefined {
  return err ? t(err.message ?? "") : undefined;
}

interface RoleFormPageProps {
  /** Present → edit mode; absent → create mode. */
  roleId?: string;
  onSuccess?: (roleId: string) => void;
  onCancel?: () => void;
}

export function RoleFormPage({ roleId, onSuccess, onCancel }: RoleFormPageProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();
  const mode: "create" | "edit" = roleId ? "edit" : "create";

  const pair =
    mode === "create" ? SYSTEM_ENGINE_PAIRS.CREATE_ROLE : SYSTEM_ENGINE_PAIRS.UPDATE_ROLE;
  const canSubmit = useCan(pair.action, pair.resourceType);

  // Không có GET /auth/roles/:id — dùng list catalog + find-by-id (catalog tenant nhỏ, chấp nhận được).
  const listQuery = useQuery({
    queryKey: authKeys.roles.list(),
    queryFn: () => roleAdminApi.listRoles(),
    enabled: mode === "edit" && canSubmit,
    staleTime: 30_000,
  });
  const existing = mode === "edit" ? listQuery.data?.find((r) => r.id === roleId) : undefined;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting, dirtyFields },
  } = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    mode: "onSubmit",
    defaultValues: EMPTY_ROLE_FORM,
  });

  const prefilledRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode === "edit" && existing && prefilledRef.current !== roleId) {
      prefilledRef.current = roleId ?? null;
      reset(roleToFormValues(existing));
    }
  }, [mode, existing, roleId, reset]);

  useDirtyFormGuard({ isDirty });

  const isSystemLocked = mode === "edit" && existing?.isSystem === true;

  const mutation = useMutation({
    mutationFn: async (values: RoleFormValues): Promise<string> => {
      if (mode === "create") {
        const res = await roleAdminApi.createRole(toCreateRoleDto(values));
        return res.id;
      }
      const patch = toUpdateRoleDto(values, dirtyFields as DirtyMap);
      const res = await roleAdminApi.updateRole(roleId as string, patch);
      return res.id;
    },
    onSuccess: async (savedId) => {
      await queryClient.invalidateQueries({ queryKey: authKeys.roles.list() });
      reset(EMPTY_ROLE_FORM);
      onSuccess?.(savedId);
    },
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canSubmit) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("roles.forbidden.title")}
          description={t("roleForm.forbidden.description")}
        />
      </div>
    );
  }

  // ── Edit: loading / error of catalog to find-by-id ───────────────────────────
  if (mode === "edit" && listQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader title={tc("loading")} icon={ShieldCheck} />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (mode === "edit" && (listQuery.isError || !existing)) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("roleDetail.error.title")}
          description={t("roleDetail.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void listQuery.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const busy = isSubmitting || mutation.isPending;
  const submitDisabled = busy || isSystemLocked || (mode === "edit" && !isDirty);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={mode === "create" ? t("roleForm.createTitle") : t("roleForm.editTitle")}
        description={
          mode === "create" ? t("roleForm.createDescription") : t("roleForm.editDescription")
        }
        icon={mode === "create" ? ShieldPlus : ShieldCheck}
        actions={
          onCancel && (
            <Button variant="outline" size="sm" onClick={onCancel}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t("roleForm.cancel")}
            </Button>
          )
        }
      />

      {isSystemLocked && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <Lock className="h-4 w-4 shrink-0" />
          <span>{t("roleForm.systemLockedNotice")}</span>
        </div>
      )}

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
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium text-foreground">
                {t("roleForm.fields.name")}
                <span className="ml-0.5 text-destructive">*</span>
              </label>
              <Input id="name" disabled={isSystemLocked} {...register("name")} />
              {errors.name && (
                <p role="alert" className="text-sm text-destructive">
                  {fieldError(errors.name, t)}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="description" className="text-sm font-medium text-foreground">
                {t("roleForm.fields.description")}
              </label>
              <Input id="description" disabled={isSystemLocked} {...register("description")} />
              {errors.description && (
                <p role="alert" className="text-sm text-destructive">
                  {fieldError(errors.description, t)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
              {t("roleForm.cancel")}
            </Button>
          )}
          <Button type="submit" disabled={submitDisabled}>
            {busy
              ? t("roleForm.submitting")
              : mode === "create"
                ? t("roleForm.submitCreate")
                : t("roleForm.submitSave")}
          </Button>
        </div>
      </form>
    </div>
  );
}
