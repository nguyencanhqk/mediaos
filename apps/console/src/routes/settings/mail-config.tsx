import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { MailConfigDto, UpsertMailConfigRequest } from "@mediaos/contracts";
import { upsertMailConfigSchema } from "@mediaos/contracts";
import { PermissionGate } from "@mediaos/web-core";
import { Button, Input, Select } from "@mediaos/ui";
import { mailConfigApi } from "@/lib/mail-config-api";

const DEFAULT_SCOPE = "default";

type ScopeTab = "default" | "app";

// ── Container ───────────────────────────────────────────────────────────────────

export function MailConfigPage() {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();
  const [tab, setTab] = useState<ScopeTab>("default");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["settings", "mail-config"],
    queryFn: mailConfigApi.list,
  });

  const configs = data?.configs ?? [];
  const defaultConfig = useMemo(() => configs.find((c) => c.scope === DEFAULT_SCOPE), [configs]);
  const appConfigs = useMemo(() => configs.filter((c) => c.scope.startsWith("app:")), [configs]);

  const upsert = useMutation({
    mutationFn: (payload: UpsertMailConfigRequest) => mailConfigApi.upsert(payload),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["settings", "mail-config"] }),
  });

  const active = tab === "default" ? defaultConfig : appConfigs[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("mailConfig.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("mailConfig.pageDesc")}</p>
      </div>

      {/* Tab bar: Mặc định / Theo ứng dụng */}
      <div className="flex gap-1 border-b border-border">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "default"}
          onClick={() => setTab("default")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "default"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("mailConfig.tabDefault")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "app"}
          onClick={() => setTab("app")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === "app"
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t("mailConfig.tabPerApp")}
        </button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("mailConfig.loadError")}</p>}

      {!isLoading && !isError && (
        <PermissionGate
          action="configure-mail"
          resourceType="company"
          fallback={<p className="text-sm text-muted-foreground">{t("mailConfig.noPermission")}</p>}
        >
          <MailConfigForm
            key={`${tab}:${active?.scope ?? "new"}`}
            initial={active ?? null}
            scopeTab={tab}
            onSubmit={(payload) => upsert.mutate(payload)}
            isSaving={upsert.isPending}
            isSaved={upsert.isSuccess}
            isSaveError={upsert.isError}
          />
        </PermissionGate>
      )}
    </div>
  );
}

// ── Form (presentational — validate Zod client; secret là việc server) ──────────

interface MailConfigFormProps {
  initial: MailConfigDto | null;
  scopeTab: ScopeTab;
  onSubmit: (payload: UpsertMailConfigRequest) => void;
  isSaving?: boolean;
  isSaved?: boolean;
  isSaveError?: boolean;
  /** Test-connection runner — mặc định gọi API; cho phép inject trong test. */
  runTest?: (payload: import("@mediaos/contracts").TestMailConfigRequest) => Promise<{
    ok: boolean;
    errorMessage?: string | null;
  }>;
}

export function MailConfigForm({
  initial,
  scopeTab,
  onSubmit,
  isSaving = false,
  isSaved = false,
  isSaveError = false,
  runTest = mailConfigApi.test,
}: MailConfigFormProps) {
  const { t } = useTranslation("settings");
  const isNew = initial === null;

  const [editing, setEditing] = useState(!isNew); // empty-state → bấm "Thiết lập" mới mở form
  const [scope, setScope] = useState(initial?.scope ?? (scopeTab === "app" ? "app:" : DEFAULT_SCOPE));
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 587));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState(""); // KHÔNG bao giờ prefill (server không trả) — masked
  const [secure, setSecure] = useState(initial?.secure ?? true);
  const [fromName, setFromName] = useState(initial?.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(initial?.fromEmail ?? "");

  const [errors, setErrors] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; errorMessage?: string | null } | null>(null);
  const [testing, setTesting] = useState(false);

  // Empty-state (chưa thiết lập + chưa bấm Thiết lập).
  if (isNew && !editing) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <p className="text-sm text-muted-foreground">{t("mailConfig.emptyState")}</p>
        <Button type="button" className="mt-4" onClick={() => setEditing(true)}>
          {t("mailConfig.setupButton")}
        </Button>
      </div>
    );
  }

  const buildPayload = (withPassword: boolean): UpsertMailConfigRequest | null => {
    const raw: Record<string, unknown> = {
      scope: scope.trim(),
      host: host.trim(),
      port: Number(port),
      username: username.trim(),
      secure,
      fromName: fromName.trim() || null,
      fromEmail: fromEmail.trim(),
    };
    // Password optional: chỉ gửi khi người dùng nhập (đổi password). Khi giữ nguyên → bỏ qua.
    if (withPassword && password.length > 0) raw.password = password;
    const parsed = upsertMailConfigSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return null;
    }
    setErrors([]);
    return parsed.data;
  };

  const handleSubmit = () => {
    // Tạo mới BẮT BUỘC có password (server từ chối nếu thiếu). Cập nhật thì optional.
    if (isNew && password.length === 0) {
      setErrors([t("mailConfig.passwordRequiredNew")]);
      return;
    }
    const payload = buildPayload(true);
    if (payload) onSubmit(payload);
  };

  const handleTest = async () => {
    setTestResult(null);
    const raw: Record<string, unknown> = {
      scope: scope.trim(),
      host: host.trim(),
      port: Number(port),
      username: username.trim(),
      secure,
    };
    if (password.length > 0) raw.password = password;
    setTesting(true);
    try {
      const res = await runTest(raw as import("@mediaos/contracts").TestMailConfigRequest);
      setTestResult(res);
    } catch {
      setTestResult({ ok: false, errorMessage: t("mailConfig.testFailedGeneric") });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5 rounded-xl border border-border p-6">
      {scopeTab === "app" && (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("mailConfig.scopeLabel")}</span>
          <Input
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            placeholder="app:studio"
          />
        </label>
      )}

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("mailConfig.hostLabel")}</span>
        <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("mailConfig.portLabel")}</span>
          <Input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pt-7 text-sm">
          <input
            type="checkbox"
            checked={secure}
            onChange={(e) => setSecure(e.target.checked)}
            className="h-4 w-4"
          />
          {t("mailConfig.secureLabel")}
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("mailConfig.usernameLabel")}</span>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="noreply@example.com" />
      </label>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("mailConfig.passwordLabel")}</span>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={initial?.hasPassword ? t("mailConfig.passwordKeepPlaceholder") : "••••••••"}
          autoComplete="new-password"
        />
        {initial?.hasPassword && (
          <span className="text-xs text-muted-foreground">{t("mailConfig.passwordKeepHint")}</span>
        )}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("mailConfig.fromNameLabel")}</span>
          <Input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Funtime Media" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("mailConfig.fromEmailLabel")}</span>
          <Input
            type="email"
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            placeholder="noreply@example.com"
          />
        </label>
      </div>

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="space-y-1">
            {errors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {testResult && (
        <p
          role="status"
          className={`text-sm ${testResult.ok ? "text-green-600" : "text-destructive"}`}
        >
          {testResult.ok
            ? t("mailConfig.testSuccess")
            : testResult.errorMessage || t("mailConfig.testFailedGeneric")}
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button type="button" onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? t("common:saving") : t("mailConfig.saveButton")}
        </Button>
        <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? t("mailConfig.testing") : t("mailConfig.testButton")}
        </Button>
        {isSaved && (
          <p role="status" className="text-sm text-green-600">
            {t("mailConfig.saveSuccess")}
          </p>
        )}
        {isSaveError && (
          <p role="alert" className="text-sm text-destructive">
            {t("mailConfig.saveError")}
          </p>
        )}
      </div>
    </div>
  );
}
