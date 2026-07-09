/**
 * SYSTEM-SCREEN-SETTINGS (S2-FE-FND-8 · UI-SYSTEM-SCREEN-004) — /system/settings.
 *
 * Đọc: GET /foundation/system-settings — gate DUY NHẤT system-manage:foundation-setting (is_sensitive=true).
 * Sửa: PATCH /foundation/system-settings/:key — CÙNG cặp quyền (BE KHÔNG tách view/manage cho system-scope,
 * xem docs/plans/S2-FND-SYSSET-1.md RECONCILE DECISION). reason → audit SYSTEM_SETTING_UPDATED; KHÔNG log secret.
 *
 * Grouping: setting hiển thị theo `category` (server trả sẵn field này — client CHỈ nhóm, KHÔNG suy luận).
 * Masking (BẤT BIẾN #3): value nhạy cảm ĐÃ mask bởi server (masked=true, secret_ref không có trong DTO) →
 * render MaskedField, raw KHÔNG bao giờ vào DOM. Form sửa bọc <PermissionGate> system-manage:foundation-setting
 * (defense-in-depth — trang đã tự ẩn/forbidden nếu thiếu quyền, nhưng gate lại ở khối form theo yêu cầu).
 *
 * States: forbidden (KHÔNG gọi API) · loading · error · empty · list (nhóm theo category).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert, RefreshCw, Pencil } from "lucide-react";
import {
  foundationApi,
  foundationInvalidation,
  foundationKeys,
  useCan,
  PermissionGate,
  settingValueTypeSchema,
  type SafeSettingView,
  type SettingValueType,
} from "@mediaos/web-core";
import { PageHeader, EmptyState, Button, Input, Card, CardContent, Badge } from "@mediaos/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { MaskedField } from "@/components/MaskedField";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";

type TF = ReturnType<typeof useTranslation<"system">>["t"];

const FALLBACK_CATEGORY = "General";

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

/** Nhóm mảng SafeSettingView theo `category` (server trả sẵn) — GIỮ thứ tự xuất hiện đầu tiên của mỗi nhóm. */
function groupByCategory(settings: SafeSettingView[]): Array<[string, SafeSettingView[]]> {
  const groups = new Map<string, SafeSettingView[]>();
  for (const s of settings) {
    const key = s.category?.trim() || FALLBACK_CATEGORY;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
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
// 1 hàng setting (metadata view — admin)
// ---------------------------------------------------------------------------
function SettingRow({
  setting,
  t,
  onEdit,
}: {
  setting: SafeSettingView;
  t: TF;
  onEdit: (s: SafeSettingView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-b-0">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium text-foreground">{setting.key}</span>
          {setting.moduleCode && <Badge variant="secondary">{setting.moduleCode}</Badge>}
        </div>
        {setting.isSensitive ? (
          <MaskedField
            label={t("systemSettings.columns.value")}
            value=""
            masked={setting.masked}
            maskedHint={t("systemSettings.maskedHint")}
            id={`sys-val-${setting.key}`}
          />
        ) : (
          <p className="font-mono text-sm text-muted-foreground">
            {renderPublicValue(setting.value)}
          </p>
        )}
      </div>
      {/* Form sửa gate lại bằng PermissionGate (defense-in-depth — trang đã forbidden nếu thiếu quyền). */}
      <PermissionGate
        action={FOUNDATION_ENGINE_PAIRS.SYSTEM_MANAGE_SETTING.action}
        resourceType={FOUNDATION_ENGINE_PAIRS.SYSTEM_MANAGE_SETTING.resourceType}
      >
        <Button variant="outline" size="sm" onClick={() => onEdit(setting)}>
          <Pencil className="mr-2 h-4 w-4" />
          {t("systemSettings.edit")}
        </Button>
      </PermissionGate>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function SystemSettingsPage() {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");
  const queryClient = useQueryClient();

  // Gate DUY NHẤT (đọc + sửa) — BE KHÔNG tách view/manage cho system-scope.
  const canManage = useCan(
    FOUNDATION_ENGINE_PAIRS.SYSTEM_MANAGE_SETTING.action,
    FOUNDATION_ENGINE_PAIRS.SYSTEM_MANAGE_SETTING.resourceType,
  );

  const [edit, setEdit] = useState<EditState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const query = useQuery({
    queryKey: foundationKeys.systemSettings.list(),
    queryFn: () => foundationApi.getSystemSettings(),
    enabled: canManage,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (state: EditState) =>
      foundationApi.updateSystemSetting(state.key, {
        settingValue: state.draft,
        // Gửi valueType metadata sẵn có (chỉ khi khớp enum hợp lệ); server validate lại.
        valueType: coerceValueType(state.valueType),
        category: state.category,
        moduleCode: state.moduleCode ?? undefined,
        reason: state.reason.trim() === "" ? undefined : state.reason.trim(),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: foundationInvalidation.updateSystemSetting()[0],
      });
      setEdit(null);
      setConfirmOpen(false);
    },
  });

  const settings = query.data ?? [];
  const grouped = useMemo(() => groupByCategory(settings), [settings]);
  const busy = mutation.isPending;

  // ── Forbidden — KHÔNG gọi API (query.enabled=false đã chặn) ─────────────────
  if (!canManage) {
    return (
      <div className="p-6">
        <PageHeader
          title={t("systemSettings.title")}
          description={t("systemSettings.description")}
          icon={ShieldAlert}
        />
        <EmptyState
          title={t("systemSettings.forbidden.title")}
          description={t("systemSettings.forbidden.description")}
        />
      </div>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (query.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <PageHeader
          title={t("systemSettings.title")}
          description={t("systemSettings.description")}
          icon={ShieldAlert}
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
          title={t("systemSettings.error.title")}
          description={t("systemSettings.error.description")}
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

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t("systemSettings.title")}
        description={t("systemSettings.description")}
        icon={ShieldAlert}
      />

      {settings.length === 0 ? (
        <EmptyState
          title={t("systemSettings.empty.title")}
          description={t("systemSettings.empty.description")}
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <Card key={category}>
              <CardContent className="pt-2">
                <h3 className="mb-2 text-sm font-semibold text-foreground">{category}</h3>
                {items.map((s) => (
                  <SettingRow
                    key={s.key}
                    setting={s}
                    t={t}
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
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Editor inline khi chọn 1 key — bọc PermissionGate (yêu cầu rõ: edit gate ở khối form). */}
      <PermissionGate
        action={FOUNDATION_ENGINE_PAIRS.SYSTEM_MANAGE_SETTING.action}
        resourceType={FOUNDATION_ENGINE_PAIRS.SYSTEM_MANAGE_SETTING.resourceType}
      >
        {edit && (
          <Card>
            <CardContent className="space-y-4 pt-5">
              <h3 className="font-mono text-sm font-semibold text-foreground">{edit.key}</h3>
              <div className="space-y-1.5">
                <label
                  htmlFor="system-setting-value"
                  className="text-sm font-medium text-foreground"
                >
                  {t("systemSettings.editValue")}
                </label>
                <Input
                  id="system-setting-value"
                  value={edit.draft}
                  onChange={(e) => setEdit({ ...edit, draft: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="system-setting-reason"
                  className="text-sm font-medium text-foreground"
                >
                  {t("systemSettings.reason")}
                </label>
                <Input
                  id="system-setting-reason"
                  placeholder={t("systemSettings.reasonPlaceholder")}
                  value={edit.reason}
                  onChange={(e) => setEdit({ ...edit, reason: e.target.value })}
                />
              </div>
              {mutation.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t("systemSettings.saveError")}
                </p>
              )}
              <div className="flex items-center justify-end gap-3">
                <Button variant="outline" onClick={() => setEdit(null)} disabled={busy}>
                  {t("systemSettings.cancel")}
                </Button>
                <Button onClick={() => setConfirmOpen(true)} disabled={busy}>
                  {busy ? t("systemSettings.saving") : t("systemSettings.save")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </PermissionGate>

      <ConfirmDialog
        open={confirmOpen}
        title={t("systemSettings.confirm.title")}
        description={
          edit?.isSensitive
            ? t("systemSettings.confirm.sensitiveDescription")
            : t("systemSettings.confirm.description")
        }
        confirmLabel={t("systemSettings.confirm.confirmLabel")}
        cancelLabel={t("systemSettings.confirm.cancelLabel")}
        destructive={edit?.isSensitive}
        busy={busy}
        busyLabel={t("systemSettings.saving")}
        onConfirm={() => edit && mutation.mutate(edit)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
