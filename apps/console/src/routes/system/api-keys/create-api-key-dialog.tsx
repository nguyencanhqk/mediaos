import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createApiKeyRequestSchema,
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
} from "@mediaos/contracts";
import { Button, Dialog, Input } from "@mediaos/ui";
import { apiKeysApi } from "@/lib/api-keys-api";

interface CreateApiKeyDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Tạo PAT. 2 giai đoạn:
 *   (1) form: tên + ngày hết hạn (tuỳ chọn) + chọn scope (catalog ∩ grant actor, fetch /api-keys/scopes).
 *   (2) reveal: hiển thị token plaintext ĐÚNG 1 LẦN + nút copy + cảnh báo. token CHỈ ở state local, KHÔNG
 *       lưu/log; clear khi đóng dialog (unmount). BẤT BIẾN #3.
 */
export function CreateApiKeyDialog({ open, onClose, onSuccess }: CreateApiKeyDialogProps) {
  const { t } = useTranslation("api-keys");
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreateApiKeyResponse | null>(null);
  const [copied, setCopied] = React.useState(false);

  const scopesQuery = useQuery({ queryKey: ["api-keys", "scopes"], queryFn: apiKeysApi.scopes });

  const mutation = useMutation({
    mutationFn: (body: CreateApiKeyRequest) => apiKeysApi.create(body),
    onSuccess: (res) => {
      setCreated(res);
      void queryClient.invalidateQueries({ queryKey: ["api-keys", "list"] });
      onSuccess();
    },
    onError: () => setError(t("feedback.createFailed")),
  });

  const handleClose = () => {
    // Clear MỌI state — token plaintext không sống quá vòng đời dialog.
    setName("");
    setExpiresAt("");
    setSelected(new Set());
    setError(null);
    setCreated(null);
    setCopied(false);
    mutation.reset();
    onClose();
  };

  const toggleScope = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError(t("create.nameRequired"));
      return;
    }
    if (selected.size === 0) {
      setError(t("create.scopeRequired"));
      return;
    }
    const body: CreateApiKeyRequest = {
      name: name.trim(),
      scopePermissionIds: [...selected],
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    };
    const parsed = createApiKeyRequestSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? t("feedback.createFailed"));
      return;
    }
    mutation.mutate(parsed.data);
  };

  const onCopy = () => {
    if (!created) return;
    void navigator.clipboard?.writeText(created.token);
    setCopied(true);
  };

  // ── Giai đoạn 2: reveal token (1 lần) ─────────────────────────────────────────
  if (created) {
    return (
      <Dialog
        open={open}
        onClose={handleClose}
        title={t("reveal.title")}
        description={t("reveal.warning")}
        footer={<Button onClick={handleClose}>{t("actions.close")}</Button>}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="ak-token">
            {t("reveal.tokenLabel")}
          </label>
          <div className="flex items-center gap-2">
            <Input id="ak-token" readOnly value={created.token} className="font-mono text-xs" />
            <Button variant="outline" size="sm" onClick={onCopy}>
              {copied ? t("actions.copied") : t("actions.copy")}
            </Button>
          </div>
          <p role="alert" className="text-xs text-destructive">
            {t("reveal.warning")}
          </p>
        </div>
      </Dialog>
    );
  }

  // ── Giai đoạn 1: form ─────────────────────────────────────────────────────────
  const scopes = scopesQuery.data ?? [];

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t("create.title")}
      description={t("create.description")}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button type="submit" form="create-api-key-form" disabled={mutation.isPending}>
            {mutation.isPending ? t("create.submitting") : t("create.submit")}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form id="create-api-key-form" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="ak-name">
            {t("create.nameLabel")}
          </label>
          <Input
            id="ak-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("create.namePlaceholder")}
            autoFocus
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="ak-expires">
            {t("create.expiresLabel")}
          </label>
          <Input
            id="ak-expires"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <span className="text-sm font-medium">{t("create.scopesLabel")}</span>
          <p className="text-xs text-muted-foreground">{t("create.scopesHint")}</p>
          {scopesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">…</p>
          ) : scopes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("create.scopesEmpty")}</p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {scopes.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleScope(s.id)}
                    />
                    <code className="text-xs">
                      {s.action}:{s.resourceType}
                    </code>
                    {s.isSensitive && (
                      <span className="text-[10px] uppercase text-amber-400">sensitive</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </form>
    </Dialog>
  );
}
