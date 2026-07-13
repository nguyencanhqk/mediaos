/**
 * S2-AUTH-PERMRULE-1 — Gán quyền theo LUẬT khớp mẫu (rule builder).
 *
 * Admin chọn tài nguyên + nhóm hành động (preset) + phạm vi → server bung ra các quyền khớp trong
 * catalog → XEM TRƯỚC (dryRun, 0 ghi) → ÁP DỤNG (POST apply-rule, ghi qua assignPermissionToRole).
 * Server là cổng cuối (assign:permission isSensitive + scope-ceiling + loại-sensitive + chặn
 * (sensitive & mọi-resource)); client chỉ phản chiếu + chặn sớm 2 lỗi hiển nhiên cho UX.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PermissionCatalogDto, PermissionRulePreview } from "@mediaos/contracts";
import { roleAdminApi, ApiError } from "@mediaos/web-core";
import { Button, Dialog, Select, Badge, Input } from "@mediaos/ui";
import { labelAction, labelResource, labelScope } from "./permission-labels";

type TF = ReturnType<typeof useTranslation<"system">>["t"];
type Preset = "read-only" | "crud" | "custom";
type Scope = "Own" | "Team" | "Department" | "Company";
const SCOPES: Scope[] = ["Own", "Team", "Department", "Company"];
const PRESETS: Preset[] = ["read-only", "crud", "custom"];

function ruleErrorMessage(err: unknown, t: TF): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return err.message || t("rolePermissions.errors.badPair");
    if (err.status === 403) return t("rolePermissions.errors.forbidden");
    if (err.status === 404) return t("rolePermissions.error.description");
    if (err.status >= 500) return t("rolePermissions.errors.server");
  }
  return t("rolePermissions.errors.generic");
}

interface PermissionRuleDialogProps {
  open: boolean;
  onClose: () => void;
  roleId: string;
  roleName: string;
  catalog: PermissionCatalogDto[];
  onApplied: () => void;
}

export function PermissionRuleDialog({
  open,
  onClose,
  roleId,
  roleName,
  catalog,
  onApplied,
}: PermissionRuleDialogProps) {
  const { t } = useTranslation("system");
  const { t: tc } = useTranslation("common");

  const resources = useMemo(
    () => [...new Set(catalog.map((p) => p.resourceType))].sort(),
    [catalog],
  );
  const actions = useMemo(() => [...new Set(catalog.map((p) => p.action))].sort(), [catalog]);

  const [selRes, setSelRes] = useState<Set<string>>(new Set());
  const [resFilter, setResFilter] = useState("");
  const [preset, setPreset] = useState<Preset>("read-only");
  const [selActions, setSelActions] = useState<Set<string>>(new Set());
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [scope, setScope] = useState<Scope>("Company");
  const [preview, setPreview] = useState<PermissionRulePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSelRes(new Set());
    setResFilter("");
    setPreset("read-only");
    setSelActions(new Set());
    setIncludeSensitive(false);
    setScope("Company");
    setPreview(null);
    setError(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
    setPreview(null); // đổi luật → preview cũ hết hiệu lực
  };

  const buildBody = (dryRun: boolean) => ({
    match: {
      resourceTypes: [...selRes],
      actionPreset: preset,
      actions: preset === "custom" ? [...selActions] : [],
      includeSensitive,
    },
    effect: "ALLOW" as const,
    dataScope: scope,
    dryRun,
  });

  const sensitiveBlocked = includeSensitive && selRes.size === 0;
  const customEmpty = preset === "custom" && selActions.size === 0;
  const canPreview = !busy && !sensitiveBlocked && !customEmpty;

  const runPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await roleAdminApi.applyPermissionRule(roleId, buildBody(true)));
    } catch (e) {
      setPreview(null);
      setError(ruleErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  const runApply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await roleAdminApi.applyPermissionRule(roleId, buildBody(false));
      setPreview(r);
      onApplied();
    } catch (e) {
      setError(ruleErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const applyCount = preview ? preview.counts.toAdd + preview.counts.toChangeScope : 0;
  const applied = preview?.applied != null;
  const filteredResources = resources.filter((r) =>
    resFilter.trim() ? r.toLowerCase().includes(resFilter.trim().toLowerCase()) : true,
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      className="max-w-2xl"
      title={t("rolePermissions.rule.title", { role: roleName })}
      description={t("rolePermissions.rule.description")}
      footer={
        applied ? (
          <Button size="sm" onClick={close}>
            {t("rolePermissions.rule.close")}
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" disabled={busy} onClick={close}>
              {tc("actions.cancel")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canPreview}
              onClick={() => void runPreview()}
            >
              {busy && !applied
                ? t("rolePermissions.rule.previewing")
                : t("rolePermissions.rule.preview")}
            </Button>
            <Button
              size="sm"
              disabled={busy || preview === null || applyCount === 0}
              onClick={() => void runApply()}
            >
              {busy
                ? t("rolePermissions.rule.applying")
                : t("rolePermissions.rule.apply", { count: applyCount })}
            </Button>
          </>
        )
      }
    >
      <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
        {/* Tài nguyên */}
        <div>
          <label className="text-sm font-medium">{t("rolePermissions.rule.resources")}</label>
          <p className="mb-1 text-xs text-muted-foreground">
            {t("rolePermissions.rule.resourcesAll")}
          </p>
          <Input
            className="mb-2 w-full"
            placeholder={t("rolePermissions.search")}
            value={resFilter}
            onChange={(e) => setResFilter(e.target.value)}
          />
          <div className="grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-3">
            {filteredResources.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={selRes.has(r)}
                  onChange={() => toggle(selRes, r, setSelRes)}
                />
                <span className="truncate" title={r}>
                  {labelResource(r)}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Nhóm hành động */}
        <div>
          <label className="text-sm font-medium">{t("rolePermissions.rule.actionPreset")}</label>
          <div className="mt-1 flex flex-wrap gap-3">
            {PRESETS.map((p) => (
              <label key={p} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  name="rule-preset"
                  checked={preset === p}
                  onChange={() => {
                    setPreset(p);
                    setPreview(null);
                  }}
                />
                {t(`rolePermissions.rule.preset.${p}`)}
              </label>
            ))}
          </div>
          {preset === "custom" && (
            <div className="mt-2 grid max-h-32 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-3">
              {actions.map((a) => (
                <label key={a} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={selActions.has(a)}
                    onChange={() => toggle(selActions, a, setSelActions)}
                  />
                  <span className="truncate" title={a}>
                    {labelAction(a)}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Phạm vi + nhạy cảm */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-sm font-medium">{t("rolePermissions.rule.dataScope")}</label>
            <Select
              className="mt-1 w-40"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as Scope);
                setPreview(null);
              }}
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>
                  {labelScope(s)}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input
              type="checkbox"
              checked={includeSensitive}
              onChange={() => {
                setIncludeSensitive((v) => !v);
                setPreview(null);
              }}
            />
            {t("rolePermissions.rule.includeSensitive")}
          </label>
        </div>
        {includeSensitive && (
          <p className="text-xs text-warning">{t("rolePermissions.rule.includeSensitiveHint")}</p>
        )}
        {sensitiveBlocked && (
          <p role="alert" className="text-sm text-destructive">
            {t("rolePermissions.rule.errors.sensitiveAllResource")}
          </p>
        )}
        {customEmpty && (
          <p role="alert" className="text-sm text-destructive">
            {t("rolePermissions.rule.errors.customEmpty")}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {/* Preview */}
        {preview && (
          <div className="space-y-3 rounded-md border border-border p-3">
            <p className="text-sm font-medium">
              {t("rolePermissions.rule.summary", {
                add: preview.counts.toAdd,
                change: preview.counts.toChangeScope,
                skip: preview.counts.skipped,
                excluded: preview.counts.excludedSensitive,
              })}
            </p>
            {applied && preview.applied && (
              <p role="status" className="rounded bg-success-muted px-2 py-1 text-sm text-success">
                {t("rolePermissions.rule.done", {
                  ok: preview.applied.filter((a) => a.status === "ok").length,
                  err: preview.applied.filter((a) => a.status === "error").length,
                })}
              </p>
            )}
            {!applied && applyCount === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("rolePermissions.rule.nothingToApply")}
              </p>
            )}
            <PreviewList
              title={t("rolePermissions.rule.sectionAdd")}
              variant="add"
              items={preview.toAdd.map((p) => ({
                key: `${p.action}:${p.resourceType}`,
                label: `${labelAction(p.action)} · ${labelResource(p.resourceType)}`,
                sensitive: p.isSensitive,
              }))}
            />
            <PreviewList
              title={t("rolePermissions.rule.sectionChange")}
              variant="change"
              items={preview.toChangeScope.map((p) => ({
                key: `${p.action}:${p.resourceType}`,
                label: t("rolePermissions.rule.changeLine", {
                  pair: `${labelAction(p.action)} · ${labelResource(p.resourceType)}`,
                  from: labelScope(p.fromScope),
                  to: labelScope(p.toScope),
                }),
              }))}
            />
            <PreviewList
              title={t("rolePermissions.rule.sectionExcluded")}
              variant="excluded"
              items={preview.excludedSensitive.map((p) => ({
                key: `${p.action}:${p.resourceType}`,
                label: `${labelAction(p.action)} · ${labelResource(p.resourceType)}`,
                sensitive: true,
              }))}
            />
            <PreviewList
              title={t("rolePermissions.rule.sectionSkip")}
              variant="skip"
              items={preview.skipped.map((p) => ({
                key: `${p.action}:${p.resourceType}`,
                label: `${labelAction(p.action)} · ${labelResource(p.resourceType)}`,
                detail:
                  p.reason === "denied"
                    ? t("rolePermissions.rule.skipDenied")
                    : t("rolePermissions.rule.skipGranted"),
              }))}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}

interface PreviewItem {
  key: string;
  label: string;
  detail?: string;
  sensitive?: boolean;
}

function PreviewList({
  title,
  items,
  variant,
}: {
  title: string;
  items: PreviewItem[];
  variant: "add" | "change" | "skip" | "excluded";
}) {
  const { t } = useTranslation("system");
  if (items.length === 0) return null;
  const color =
    variant === "add"
      ? "text-success"
      : variant === "change"
        ? "text-info"
        : variant === "excluded"
          ? "text-warning"
          : "text-muted-foreground";
  return (
    <div>
      <p className="text-xs font-semibold text-foreground">
        {title} ({items.length})
      </p>
      <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-sm">
        {items.map((it) => (
          <li key={it.key} className={color}>
            {it.label}
            {it.detail ? ` — ${it.detail}` : ""}
            {it.sensitive && (
              <Badge variant="warning" className="ml-1">
                {t("permissions.sensitive")}
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
