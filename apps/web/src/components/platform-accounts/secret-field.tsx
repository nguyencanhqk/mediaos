import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@mediaos/ui";

const MASK = "••••••••••";
/** Tự ẩn plaintext sau 60s nếu người dùng quên ẩn (giảm cửa sổ lộ trên màn hình). */
const DEFAULT_AUTO_HIDE_MS = 60_000;

interface SecretFieldProps {
  /**
   * Mở luồng step-up (ReAuthModal) và resolve plaintext, hoặc `null` nếu người dùng huỷ.
   * SecretField KHÔNG biết cách lấy plaintext — parent lái modal/api. Ném ⇒ hiển thị lỗi.
   */
  onRequestReveal: () => Promise<string | null>;
  /** Nhãn aria cho nút hiện/ẩn (vd "mật khẩu", "recovery email"). */
  label?: string;
  /** Tự ẩn sau N ms (mặc định 60s). */
  autoHideMs?: number;
}

/**
 * SecretField (🔒 G6-2h) — hiển thị secret nhạy với reveal có kiểm soát.
 *
 * BẤT BIẾN: plaintext CHỈ sống trong state local của component này; KHÔNG đẩy ra ngoài
 * (zustand / query cache / localStorage). Tự clear khi: bấm ẩn · focus rời field · hết autoHideMs ·
 * unmount. Đây là điểm RED test ép (secret-field.spec).
 */
export function SecretField({ onRequestReveal, label, autoHideMs }: SecretFieldProps) {
  const { t } = useTranslation("settings");
  const resolvedLabel = label ?? t("platformAccounts.secretField.defaultLabel");
  const [secret, setSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hideMs = autoHideMs ?? DEFAULT_AUTO_HIDE_MS;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auto-hide: bất cứ khi nào có plaintext, hẹn giờ xoá. Cleanup huỷ timer khi clear/unmount.
  useEffect(() => {
    if (secret === null) return;
    const timer = setTimeout(() => setSecret(null), hideMs);
    return () => clearTimeout(timer);
  }, [secret, hideMs]);

  const hide = () => setSecret(null);

  const handleReveal = async () => {
    setError(null);
    setLoading(true);
    try {
      const plaintext = await onRequestReveal();
      if (!mountedRef.current) return;
      if (plaintext !== null) setSecret(plaintext);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : t("platformAccounts.secretField.revealError"));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <div
      data-testid="secret-field"
      className="space-y-1"
      // Clear khi focus RỜI HẲN field (không clear khi nhảy từ plaintext sang nút ẩn).
      onBlur={(e) => {
        if (secret !== null && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
          hide();
        }
      }}
    >
      <div className="flex items-center gap-2">
        {secret === null ? (
          <code
            data-testid="secret-masked"
            className="flex-1 rounded bg-muted px-2 py-1 font-mono text-sm tracking-widest text-muted-foreground"
          >
            {MASK}
          </code>
        ) : (
          <code
            data-testid="secret-plaintext"
            tabIndex={0}
            className="flex-1 select-all break-all rounded bg-muted px-2 py-1 font-mono text-sm"
          >
            {secret}
          </code>
        )}

        {secret === null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleReveal}
            disabled={loading}
            aria-label={t("platformAccounts.secretField.revealAriaLabel", { label: resolvedLabel })}
          >
            <Eye className="size-4" />
            {loading ? t("platformAccounts.secretField.verifying") : t("platformAccounts.secretField.revealButton")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={hide}
            aria-label={t("platformAccounts.secretField.hideAriaLabel", { label: resolvedLabel })}
          >
            <EyeOff className="size-4" />
            {t("platformAccounts.secretField.hideButton")}
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
