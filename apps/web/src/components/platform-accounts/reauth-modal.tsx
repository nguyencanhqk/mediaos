import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { platformAccountsApi } from "@/lib/platform-accounts-api";

interface ReAuthModalProps {
  open: boolean;
  accountId: string;
  /** Nhãn tài khoản hiển thị trong tiêu đề (vd tên kênh). */
  accountLabel?: string;
  onClose: () => void;
  /** Plaintext trả về MỘT LẦN — caller (SecretField) giữ ephemeral, modal KHÔNG giữ. */
  onRevealed: (secret: string) => void;
  /** Step-up + reveal injectable (mặc định api; mock trong test). */
  reveal?: (accountId: string, password: string, otp?: string) => Promise<string>;
}

/**
 * ReAuthModal (🔒 G6-2h) — step-up: xác minh mật khẩu → reveal secret.
 *
 * BẤT BIẾN:
 *  - Gọi `reveal` (revealWithReauth) trực tiếp — KHÔNG qua useQuery/useMutation → plaintext không bao
 *    giờ vào React Query cache. Modal chuyển plaintext qua `onRevealed` rồi quên ngay (không state hoá).
 *  - Mật khẩu (factor nhạy) chỉ ở state local, clear khi đóng/mở-lại/unmount.
 */
export function ReAuthModal({
  open,
  accountId,
  accountLabel,
  onClose,
  onRevealed,
  reveal = platformAccountsApi.revealWithReauth,
}: ReAuthModalProps) {
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear mọi factor nhạy mỗi khi modal đóng (kể cả unmount của panel).
  useEffect(() => {
    if (!open) {
      setPassword("");
      setOtp("");
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;
    setError(null);
    setLoading(true);
    try {
      const secret = await reveal(accountId, password, otp.trim() === "" ? undefined : otp.trim());
      // Clear loading + factor TRƯỚC onClose: onClose có thể unmount modal ngay (tránh setState sau unmount).
      setLoading(false);
      setPassword("");
      setOtp("");
      onRevealed(secret);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xác minh thất bại.");
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Xác minh để hiện secret"
      description={
        accountLabel
          ? `Nhập lại mật khẩu của bạn để xem secret của "${accountLabel}".`
          : "Nhập lại mật khẩu của bạn để xem secret. Mỗi lần xem được ghi nhật ký."
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="reauth-password" className="text-sm font-medium">
            Mật khẩu
          </label>
          <Input
            id="reauth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="reauth-otp" className="text-sm font-medium text-muted-foreground">
            Mã 2FA (nếu có)
          </label>
          <Input
            id="reauth-otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            placeholder="123456"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Huỷ
          </Button>
          <Button type="submit" size="sm" disabled={!password.trim() || loading}>
            {loading ? "Đang xác minh…" : "Xác minh & hiện"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
