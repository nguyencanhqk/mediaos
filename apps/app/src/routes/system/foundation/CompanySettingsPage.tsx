/**
 * SYSTEM-SCREEN-COMPANY-SETTINGS (S2-FE-FND-1 · FND1-APP) — /system/company/settings.
 *
 * Đọc: POST /foundation/settings/resolve (batch KNOWN_SETTING_KEYS, includeMetadata) — gate view:foundation-setting.
 * Sửa: PATCH /foundation/company-settings/:key — gate update:foundation-setting. reason → audit; KHÔNG log secret.
 *
 * Masking (BẤT BIẾN #3): value nhạy cảm ĐÃ mask bởi server (masked=true, không có secret_ref trong DTO) → render
 * MaskedField, raw KHÔNG vào DOM. Confirm khi đổi giá trị nhạy cảm; TUYỆT ĐỐI KHÔNG console.log/toast giá trị submit.
 *
 * States: loading · error · empty · forbidden. Nút save ẨN/disabled khi thiếu update:foundation-setting.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, RefreshCw, Pencil } from "lucide-react";
import {
  foundationApi,
  foundationInvalidation,
  foundationKeys,
  useCan,
  settingValueTypeSchema,
  type SafeSettingView,
  type SettingsResolveResponse,
  type SettingValueType,
} from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Input, Card, CardContent, Badge } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MaskedField } from "@/components/MaskedField";
import { FOUNDATION_ENGINE_PAIRS, KNOWN_SETTING_KEYS } from "./constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

// ---------------------------------------------------------------------------
// Narrowing helpers cho union response
// ---------------------------------------------------------------------------
function hasSettings(r: SettingsResolveResponse): r is { settings: SafeSettingView[] } {
  return "settings" in r;
}

/** Chỉ giữ valueType khi khớp enum hợp lệ (mig 0431); ngược lại undefined (server tự suy/validate). */
function coerceValueType(raw: string): SettingValueType | undefined {
  const parsed = settingValueTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Render value công khai (non-sensitive) — chuỗi hoá an toàn (không phải secret). */
function renderPublicValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Edit state — 1 key đang chỉnh
// ---------------------------------------------------------------------------
interface EditState {
  key: string;
  isSensitive: boolean;
  valueType: string;
  category: string;
  moduleCode: string | null;
  /** Giá trị mới người dùng nhập (chuỗi form). */
  draft: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Setting row (metadata view — admin)
// ---------------------------------------------------------------------------
function SettingRow({
  setting,
  t,
  canUpdate,
  onEdit,
}: {
  setting: SafeSettingView;
  t: TF;
  canUpdate: boolean;
  onEdit: (s: SafeSettingView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-foreground">{setting.key}</span>
          <Badge variant="secondary">
            {t(`settings.scope.${setting.scope}` as "settings.scope.company")}
          </Badge>
        </div>
        {setting.isSensitive ? (
          <MaskedField
            label={t("settings.columns.value")}
            value=""
            masked={setting.masked}
            maskedHint={t("settings.maskedHint")}
            id={`val-${setting.key}`}
          />
        ) : (
          <p className="font-mono text-sm text-muted-foreground">
            {renderPublicValue(setting.value)}
          </p>
        )}
      </div>
      {/* Nút sửa ẨN khi thiếu update:foundation-setting (anti dead-button). */}
      {canUpdate && (
        <Button variant="outline" size="sm" onClick={() => onEdit(setting)}>
          <Pencil className="mr-2 h-4 w-4" />
          {t("settings.edit")}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function CompanySettingsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();

  const canView = useCan(
    FOUNDATION_ENGINE_PAIRS.VIEW_SETTING.action,
    FOUNDATION_ENGINE_PAIRS.VIEW_SETTING.resourceType,
  );
  const canUpdate = useCan(
    FOUNDATION_ENGINE_PAIRS.UPDATE_SETTING.action,
    FOUNDATION_ENGINE_PAIRS.UPDATE_SETTING.resourceType,
  );

  const [edit, setEdit] = useState<EditState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const resolveParams = { keys: [...KNOWN_SETTING_KEYS], includeMetadata: true };
  const query = useQuery({
    queryKey: foundationKeys.settings.resolve(resolveParams),
    queryFn: () => foundationApi.resolveSettings(resolveParams),
    enabled: canView,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (state: EditState) =>
      foundationApi.updateCompanySetting(state.key, {
        settingValue: state.draft,
        // Gửi valueType metadata sẵn có (chỉ khi khớp enum hợp lệ); server validate lại.
        valueType: coerceValueType(state.valueType),
        category: state.category,
        moduleCode: state.moduleCode ?? undefined,
        reason: state.reason.trim() === "" ? undefined : state.reason.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: foundationInvalidation.updateSetting()[0],
      });
      setEdit(null);
      setConfirmOpen(false);
    },
  });

  // ── Forbidden ──────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("settings.forbidden.title")}
          description={t("settings.forbidden.description")}
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("settings.title")}
          description={t("settings.description")}
          icon={Settings}
        />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (query.isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={t("settings.error.title")}
          description={t("settings.error.description")}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {tc("actions.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  const data = query.data;
  const settings = data && hasSettings(data) ? data.settings : null;
  const publicValues = data && !hasSettings(data) ? data.values : null;

  const isEmpty =
    (settings && settings.length === 0) ||
    (publicValues && Object.keys(publicValues).length === 0) ||
    !data;

  const busy = mutation.isPending;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.description")}
        icon={Settings}
      />

      {isEmpty ? (
        <EmptyState
          title={t("settings.empty.title")}
          description={t("settings.empty.description")}
        />
      ) : (
        <Card>
          <CardContent className="pt-2">
            {settings
              ? settings.map((s) => (
                  <SettingRow
                    key={s.key}
                    setting={s}
                    t={t}
                    canUpdate={canUpdate}
                    onEdit={(sel) =>
                      setEdit({
                        key: sel.key,
                        isSensitive: sel.isSensitive,
                        valueType: sel.valueType,
                        category: sel.category,
                        moduleCode: sel.moduleCode,
                        // Nếu masked → KHÔNG prefill raw (không có raw); bắt đầu rỗng.
                        draft: sel.isSensitive || sel.masked ? "" : renderPublicValue(sel.value),
                        reason: "",
                      })
                    }
                  />
                ))
              : publicValues &&
                Object.entries(publicValues).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between border-b border-border py-3 last:border-b-0"
                  >
                    <span className="font-mono text-sm font-medium text-foreground">{k}</span>
                    <span className="font-mono text-sm text-muted-foreground">
                      {renderPublicValue(v)}
                    </span>
                  </div>
                ))}
          </CardContent>
        </Card>
      )}

      {/* Editor inline khi chọn 1 key (chỉ khi canUpdate) */}
      {edit && canUpdate && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <h3 className="font-mono text-sm font-semibold text-foreground">{edit.key}</h3>
            <div className="space-y-1.5">
              <label htmlFor="setting-value" className="text-sm font-medium text-foreground">
                {t("settings.editValue")}
              </label>
              <Input
                id="setting-value"
                value={edit.draft}
                onChange={(e) => setEdit({ ...edit, draft: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="setting-reason" className="text-sm font-medium text-foreground">
                {t("settings.reason")}
              </label>
              <Input
                id="setting-reason"
                placeholder={t("settings.reasonPlaceholder")}
                value={edit.reason}
                onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
              />
            </div>
            {mutation.isError && (
              <p role="alert" className="text-sm text-destructive">
                {t("settings.saveError")}
              </p>
            )}
            <div className="flex items-center justify-end gap-3">
              <Button variant="outline" onClick={() => setEdit(null)} disabled={busy}>
                {t("settings.cancel")}
              </Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={busy}>
                {busy ? t("settings.saving") : t("settings.save")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t("settings.confirm.title")}
        description={
          edit?.isSensitive
            ? t("settings.confirm.sensitiveDescription")
            : t("settings.confirm.description")
        }
        confirmLabel={t("settings.confirm.confirmLabel")}
        cancelLabel={t("settings.confirm.cancelLabel")}
        destructive={edit?.isSensitive}
        busy={busy}
        busyLabel={t("settings.saving")}
        onConfirm={() => edit && mutation.mutate(edit)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
