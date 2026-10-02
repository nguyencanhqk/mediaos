import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  MailConfigDto,
  TestMailConfigRequest,
  UpsertMailConfigRequest,
} from "@mediaos/contracts";
import {
  FOUNDATION_ERROR_CODES,
  testMailConfigSchema,
  upsertMailConfigSchema,
} from "@mediaos/contracts";
import { ApiError, PermissionGate } from "@mediaos/web-core";
import { Button, Input } from "@mediaos/ui";
import { mailConfigApi } from "@/lib/mail-config-api";

const DEFAULT_SCOPE = "default";

type ScopeTab = "default" | "app";

/**
 * Server từ chối dùng mật khẩu ĐÃ LƯU (đổi đích / chưa có cấu hình) — S19-SEC-MAILCREDEXFIL-1. Mật khẩu
 * SMTP gắn với đúng host/port/username/TLS đã lưu; server là nguồn sự thật, form chỉ chặn sớm.
 */
function isPasswordRequired(err: unknown): boolean {
  return err instanceof ApiError && err.code === FOUNDATION_ERROR_CODES.MAIL_PASSWORD_REQUIRED;
}

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
    // Đích của hàng có thể vừa đổi ở nơi khác (PUT có mật khẩu chen giữa) ⇒ tải lại để form so với đích MỚI.
    onError: (err) => {
      if (isPasswordRequired(err))
        void qc.invalidateQueries({ queryKey: ["settings", "mail-config"] });
    },
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
            saveError={upsert.error}
            onPasswordRequired={() =>
              void qc.invalidateQueries({ queryKey: ["settings", "mail-config"] })
            }
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
  /** Lỗi của lần lưu gần nhất — để hiện thông điệp riêng khi server đòi nhập lại mật khẩu. */
  saveError?: unknown;
  /**
   * "Kiểm tra kết nối" bị server đòi mật khẩu ⇒ đích đã lưu có thể vừa đổi ở nơi khác — container tải lại cấu
   * hình để form so với đích MỚI (nhánh Lưu tự làm qua `onError` của mutation).
   */
  onPasswordRequired?: () => void;
  /** Test-connection runner — mặc định gọi API; cho phép inject trong test. */
  runTest?: (payload: TestMailConfigRequest) => Promise<{
    ok: boolean;
    errorMessage?: string | null;
  }>;
}

const issuesToErrors = (issues: readonly { path: PropertyKey[]; message: string }[]): string[] =>
  issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`);

export function MailConfigForm({
  initial,
  scopeTab,
  onSubmit,
  isSaving = false,
  isSaved = false,
  isSaveError = false,
  saveError,
  onPasswordRequired,
  runTest = mailConfigApi.test,
}: MailConfigFormProps) {
  const { t } = useTranslation("settings");
  const isNew = initial === null;

  const [editing, setEditing] = useState(!isNew); // empty-state → bấm "Thiết lập" mới mở form
  const [scope, setScope] = useState(
    initial?.scope ?? (scopeTab === "app" ? "app:" : DEFAULT_SCOPE),
  );
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 587));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState(""); // KHÔNG bao giờ prefill (server không trả) — masked
  const [secure, setSecure] = useState(initial?.secure ?? true);
  const [fromName, setFromName] = useState(initial?.fromName ?? "");
  const [fromEmail, setFromEmail] = useState(initial?.fromEmail ?? "");

  const [errors, setErrors] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    errorMessage?: string | null;
  } | null>(null);
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

  // Mật khẩu đã lưu chỉ dùng được cho ĐÚNG đích đã lưu (server so chính xác, `secure` vắng = true) ⇒ đổi
  // scope/host/port/username/TLS mà ô mật khẩu trống thì chặn ngay, khỏi gửi một request chắc chắn 400.
  const destinationChanged =
    initial !== null &&
    (scope.trim() !== initial.scope ||
      host.trim() !== initial.host ||
      Number(port) !== initial.port ||
      username.trim() !== initial.username ||
      secure !== initial.secure);
  const needsPassword = (isNew || destinationChanged) && password.length === 0;

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
      setErrors(issuesToErrors(parsed.error.issues));
      return null;
    }
    setErrors([]);
    return parsed.data;
  };

  const passwordRequiredMessage = () =>
    t(isNew ? "mailConfig.passwordRequiredNew" : "mailConfig.passwordRequiredDestChanged");

  const handleSubmit = () => {
    // Hình dạng TRƯỚC (cổng trống/không phải số ⇒ Number() = NaN ⇒ "đã đổi đích" giả), rồi mới xét mật khẩu:
    // tạo mới / đổi đích BẮT BUỘC có password (server từ chối nếu thiếu).
    const payload = buildPayload(true);
    if (!payload) return;
    if (needsPassword) {
      setErrors([passwordRequiredMessage()]);
      return;
    }
    onSubmit(payload);
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
    const parsed = testMailConfigSchema.safeParse(raw);
    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));
      return;
    }
    if (needsPassword) {
      setErrors([passwordRequiredMessage()]);
      return;
    }
    setErrors([]);
    setTesting(true);
    try {
      setTestResult(await runTest(parsed.data));
    } catch (err: unknown) {
      // Request KHÔNG tới được bước SMTP (mã mới · phiên · quyền · máy chủ) ≠ "đã tới SMTP và hỏng" — câu khác
      // `testFailedGeneric` để admin không đi sửa cấu hình SMTP vô ích.
      const passwordRequired = isPasswordRequired(err);
      if (passwordRequired) onPasswordRequired?.();
      setTestResult({
        ok: false,
        errorMessage: passwordRequired
          ? t("mailConfig.passwordRequiredServer")
          : t("mailConfig.testRequestFailed"),
      });
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
        <Input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="smtp.example.com"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("mailConfig.portLabel")}</span>
          <Input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
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
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="noreply@example.com"
        />
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
          <span className="text-xs text-muted-foreground">
            {t(
              destinationChanged
                ? "mailConfig.passwordDestChangedHint"
                : "mailConfig.passwordKeepHint",
            )}
          </span>
        )}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("mailConfig.fromNameLabel")}</span>
          <Input
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
            placeholder="Funtime Media"
          />
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
          className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
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
          <p role="status" className="text-sm text-success">
            {t("mailConfig.saveSuccess")}
          </p>
        )}
        {isSaveError && (
          <p role="alert" className="text-sm text-destructive">
            {isPasswordRequired(saveError)
              ? t("mailConfig.passwordRequiredServer")
              : t("mailConfig.saveError")}
          </p>
        )}
      </div>
    </div>
  );
}
