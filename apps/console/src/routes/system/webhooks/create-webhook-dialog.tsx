import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createWebhookEndpointSchema,
  type CreateWebhookEndpointRequest,
  type CreateWebhookEndpointResponse,
} from "@mediaos/contracts";
import { Button, Dialog, Input } from "@mediaos/ui";
import { webhooksApi } from "@/lib/webhooks-api";

interface CreateWebhookDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * Tạo webhook endpoint. 2 giai đoạn:
 *   (1) form: URL (https) + mô tả tuỳ chọn. Secret sinh server-side.
 *   (2) reveal: hiển thị secret plaintext ĐÚNG 1 LẦN + nút copy + cảnh báo. secret CHỈ ở state local,
 *       KHÔNG lưu/log; clear khi đóng dialog. BẤT BIẾN #3.
 */
export function CreateWebhookDialog({ open, onClose, onSuccess }: CreateWebhookDialogProps) {
  const { t } = useTranslation("webhooks");
  const queryClient = useQueryClient();
  const [url, setUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreateWebhookEndpointResponse | null>(null);
  const [copied, setCopied] = React.useState(false);

  const mutation = useMutation({
    mutationFn: (body: CreateWebhookEndpointRequest) => webhooksApi.createEndpoint(body),
    onSuccess: (res) => {
      setCreated(res);
      void queryClient.invalidateQueries({ queryKey: ["webhooks", "endpoints"] });
      onSuccess();
    },
    onError: () => setError(t("feedback.createFailed")),
  });

  const handleClose = () => {
    setUrl("");
    setDescription("");
    setError(null);
    setCreated(null);
    setCopied(false);
    mutation.reset();
    onClose();
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: CreateWebhookEndpointRequest = {
      url: url.trim(),
      description: description.trim() || null,
    };
    const parsed = createWebhookEndpointSchema.safeParse(body);
    if (!parsed.success) {
      setError(t("create.urlRequired"));
      return;
    }
    mutation.mutate(parsed.data);
  };

  const onCopy = () => {
    if (!created) return;
    void navigator.clipboard?.writeText(created.secret);
    setCopied(true);
  };

  // ── Giai đoạn 2: reveal secret (1 lần) ───────────────────────────────────────
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
          <label className="text-sm font-medium" htmlFor="wh-secret">
            {t("reveal.secretLabel")}
          </label>
          <div className="flex items-center gap-2">
            <Input id="wh-secret" readOnly value={created.secret} className="font-mono text-xs" />
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

  // ── Giai đoạn 1: form ───────────────────────────────────────────────────────
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
          <Button type="submit" form="create-webhook-form" disabled={mutation.isPending}>
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
      <form id="create-webhook-form" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="wh-url">
            {t("create.urlLabel")}
          </label>
          <Input
            id="wh-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("create.urlPlaceholder")}
            autoFocus
            required
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="wh-desc">
            {t("create.descriptionLabel")}
          </label>
          <Input
            id="wh-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </form>
    </Dialog>
  );
}
