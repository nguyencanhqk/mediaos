import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { Button, EmptyState, Input } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
import { securityPolicyApi } from "@/lib/security-policy-api";
import type {
  SecurityPolicyDto,
  TimeWindow,
  UpdateSecurityPolicyRequest,
} from "@mediaos/contracts";
import { updateSecurityPolicySchema } from "@mediaos/contracts";

const WEEKDAYS: { value: number; key: string }[] = [
  { value: 1, key: "mon" },
  { value: 2, key: "tue" },
  { value: 3, key: "wed" },
  { value: 4, key: "thu" },
  { value: 5, key: "fri" },
  { value: 6, key: "sat" },
  { value: 0, key: "sun" },
];

/** Khoá remount form khi giá trị server đổi (sau save → refetch). */
function serverStateKey(p: SecurityPolicyDto): string {
  return JSON.stringify(p);
}

export function SecurityPolicyPage() {
  const { t } = useTranslation("security-policy");
  const qc = useQueryClient();
  const canConfigure = useCan("configure-security-policy", "company");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "security-policy"],
    queryFn: securityPolicyApi.getPolicy,
    enabled: canConfigure,
  });

  const update = useMutation({
    mutationFn: (payload: UpdateSecurityPolicyRequest) => securityPolicyApi.updatePolicy(payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["settings", "security-policy"] }),
  });

  if (!canConfigure) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <EmptyState
          icon={ShieldCheck}
          title={t("noPermission.title")}
          description={t("noPermission.description")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("loadError")}</p>}

      {data && (
        <SecurityPolicyForm
          key={serverStateKey(data)}
          initial={data}
          onSubmit={(payload) => update.mutate(payload)}
          isSaving={update.isPending}
          isSaved={update.isSuccess}
          isSaveError={update.isError}
        />
      )}
    </div>
  );
}

interface FormProps {
  initial: SecurityPolicyDto;
  onSubmit: (payload: UpdateSecurityPolicyRequest) => void;
  isSaving?: boolean;
  isSaved?: boolean;
  isSaveError?: boolean;
}

/** Tách dòng (mỗi dòng 1 mục) → mảng đã trim, bỏ dòng rỗng. */
function linesToArray(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function SecurityPolicyForm({
  initial,
  onSubmit,
  isSaving = false,
  isSaved = false,
  isSaveError = false,
}: FormProps) {
  const { t } = useTranslation("security-policy");

  const [autoLogoutEnabled, setAutoLogoutEnabled] = useState(initial.autoLogoutMinutes != null);
  const [autoLogoutMinutes, setAutoLogoutMinutes] = useState(
    String(initial.autoLogoutMinutes ?? 30),
  );

  const [ipEnabled, setIpEnabled] = useState(initial.ipRestrictionEnabled);
  const [cidrText, setCidrText] = useState(initial.allowlistCidrs.join("\n"));

  const [timeEnabled, setTimeEnabled] = useState(initial.timeRestrictionEnabled);
  const [windows, setWindows] = useState<TimeWindow[]>(initial.timeWindows);

  const [applyScope, setApplyScope] = useState<SecurityPolicyDto["applyScope"]>(initial.applyScope);
  const [appKeysText, setAppKeysText] = useState(initial.applyAppKeys.join(", "));

  const [exemptText, setExemptText] = useState(initial.exemptUserIds.join("\n"));

  const [domainEnabled, setDomainEnabled] = useState(initial.emailDomainRestrictionEnabled);
  const [domainsText, setDomainsText] = useState(initial.allowedEmailDomains.join("\n"));

  // 2FA: null = theo global, true = ép thêm. UI 3-trạng-thái rút gọn về checkbox "ép cho công ty".
  const [twoFactorEnforced, setTwoFactorEnforced] = useState(initial.twoFactorEnforced === true);

  const [errors, setErrors] = useState<string[]>([]);

  const addWindow = () => setWindows((w) => [...w, { day: 1, start: "08:00", end: "17:00" }]);
  const removeWindow = (idx: number) => setWindows((w) => w.filter((_, i) => i !== idx));
  const patchWindow = (idx: number, patch: Partial<TimeWindow>) =>
    setWindows((w) => w.map((win, i) => (i === idx ? { ...win, ...patch } : win)));

  const handleSubmit = () => {
    const payload: UpdateSecurityPolicyRequest = {
      autoLogoutMinutes: autoLogoutEnabled ? Number(autoLogoutMinutes) : null,
      ipRestrictionEnabled: ipEnabled,
      allowlistCidrs: linesToArray(cidrText),
      timeRestrictionEnabled: timeEnabled,
      timeWindows: windows,
      applyScope,
      applyAppKeys: linesToArray(appKeysText),
      exemptUserIds: linesToArray(exemptText),
      emailDomainRestrictionEnabled: domainEnabled,
      allowedEmailDomains: linesToArray(domainsText).map((d) => d.toLowerCase()),
      // null = theo global (không ép riêng); true = ép thêm. KHÔNG cho hạ global ở UI.
      twoFactorEnforced: twoFactorEnforced ? true : null,
    };

    const parsed = updateSecurityPolicySchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    setErrors([]);
    onSubmit(parsed.data);
  };

  return (
    <div className="space-y-5">
      {/* Tự động đăng xuất */}
      <section className="space-y-3 rounded-xl border border-border p-6">
        <Toggle
          checked={autoLogoutEnabled}
          onChange={setAutoLogoutEnabled}
          label={t("autoLogout.label")}
          hint={t("autoLogout.hint")}
        />
        {autoLogoutEnabled && (
          <label className="block max-w-xs space-y-1.5">
            <span className="text-sm font-medium">{t("autoLogout.minutesLabel")}</span>
            <Input
              type="number"
              min={1}
              max={1440}
              value={autoLogoutMinutes}
              onChange={(e) => setAutoLogoutMinutes(e.target.value)}
            />
          </label>
        )}
      </section>

      {/* Giới hạn IP */}
      <section className="space-y-3 rounded-xl border border-border p-6">
        <Toggle
          checked={ipEnabled}
          onChange={setIpEnabled}
          label={t("ip.label")}
          hint={t("ip.hint")}
        />
        {ipEnabled && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("ip.cidrLabel")}</span>
            <textarea
              className="min-h-24 w-full rounded-md border border-border bg-background p-2 font-mono text-sm"
              value={cidrText}
              onChange={(e) => setCidrText(e.target.value)}
              placeholder={"203.0.113.0/24\n10.0.0.0/8"}
            />
            <span className="text-xs text-muted-foreground">{t("ip.cidrHint")}</span>
          </label>
        )}
      </section>

      {/* Giới hạn khung giờ */}
      <section className="space-y-3 rounded-xl border border-border p-6">
        <Toggle
          checked={timeEnabled}
          onChange={setTimeEnabled}
          label={t("time.label")}
          hint={t("time.hint")}
        />
        {timeEnabled && (
          <div className="space-y-2">
            {windows.length === 0 && (
              <p className="text-xs text-warning">{t("time.emptyWarning")}</p>
            )}
            {windows.map((w, idx) => (
              <div key={idx} className="flex flex-wrap items-end gap-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t("time.dayLabel")}</span>
                  <select
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                    value={w.day}
                    onChange={(e) => patchWindow(idx, { day: Number(e.target.value) })}
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {t(`time.weekday.${d.key}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t("time.startLabel")}</span>
                  <Input
                    type="time"
                    value={w.start}
                    onChange={(e) => patchWindow(idx, { start: e.target.value })}
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">{t("time.endLabel")}</span>
                  <Input
                    type="time"
                    value={w.end}
                    onChange={(e) => patchWindow(idx, { end: e.target.value })}
                  />
                </label>
                <Button type="button" variant="ghost" onClick={() => removeWindow(idx)}>
                  {t("time.remove")}
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addWindow}>
              {t("time.add")}
            </Button>
          </div>
        )}
      </section>

      {/* Phạm vi áp dụng */}
      <section className="space-y-3 rounded-xl border border-border p-6">
        <h2 className="text-base font-semibold">{t("scope.title")}</h2>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="applyScope"
              checked={applyScope === "all"}
              onChange={() => setApplyScope("all")}
            />
            {t("scope.all")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="applyScope"
              checked={applyScope === "selected"}
              onChange={() => setApplyScope("selected")}
            />
            {t("scope.selected")}
          </label>
        </div>
        {applyScope === "selected" && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("scope.appKeysLabel")}</span>
            <Input
              value={appKeysText}
              onChange={(e) => setAppKeysText(e.target.value)}
              placeholder="studio, people, console"
            />
          </label>
        )}
      </section>

      {/* Danh sách miễn giới hạn */}
      <section className="space-y-3 rounded-xl border border-border p-6">
        <h2 className="text-base font-semibold">{t("exempt.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("exempt.hint")}</p>
        <textarea
          className="min-h-20 w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
          value={exemptText}
          onChange={(e) => setExemptText(e.target.value)}
          placeholder={"11111111-1111-1111-1111-111111111111"}
        />
      </section>

      {/* Giới hạn tên miền email */}
      <section className="space-y-3 rounded-xl border border-border p-6">
        <Toggle
          checked={domainEnabled}
          onChange={setDomainEnabled}
          label={t("emailDomain.label")}
          hint={t("emailDomain.hint")}
        />
        {domainEnabled && (
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">{t("emailDomain.listLabel")}</span>
            <textarea
              className="min-h-20 w-full rounded-md border border-border bg-background p-2 font-mono text-sm"
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
              placeholder={"company.com\nfuntime.vn"}
            />
          </label>
        )}
      </section>

      {/* Ép 2FA cho công ty */}
      <section className="space-y-3 rounded-xl border border-border p-6">
        <Toggle
          checked={twoFactorEnforced}
          onChange={setTwoFactorEnforced}
          label={t("twoFactor.label")}
          hint={t("twoFactor.hint")}
        />
      </section>

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="space-y-1">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button type="button" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? t("common:saving") : t("saveButton")}
        </Button>
        {isSaved && (
          <p role="status" className="text-sm text-success">
            {t("saveSuccess")}
          </p>
        )}
        {isSaveError && (
          <p role="alert" className="text-sm text-destructive">
            {t("saveError")}
          </p>
        )}
      </div>
    </div>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}

function Toggle({ checked, onChange, label, hint }: ToggleProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
