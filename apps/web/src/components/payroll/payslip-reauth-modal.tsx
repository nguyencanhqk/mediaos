import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PayslipDto } from "@mediaos/contracts";
import { payslipApi } from "@/lib/payslip-api";

interface PayslipReauthModalProps {
  open: boolean;
  payslipId: string;
  onClose: () => void;
  /**
   * Receives the revealed PayslipDto ONE TIME — caller keeps it ephemeral.
   * Modal does NOT state-hoá tiền; passes through via callback then forgets.
   */
  onRevealed: (detail: PayslipDto) => void;
  /** Injectable for tests; defaults to payslipApi.reauth */
  reauth?: (id: string, password: string) => Promise<{ expiresAt: string }>;
  /** Injectable for tests; defaults to payslipApi.getOne */
  getOne?: (id: string) => Promise<PayslipDto>;
}

/**
 * PayslipReauthModal (G12-FE) — mirror of ReAuthModal (G6-2h) for payslip reveal.
 *
 * BẤT BIẾN:
 *  - Step-up via password ONLY (no OTP field — payslip uses password re-auth, not 2FA).
 *  - Calls reauth → getOne directly (NOT useQuery) → tiền không vào React Query cache.
 *  - Password (factor nhạy) cleared on close/unmount.
 *  - onRevealed hands detail to caller; modal does NOT retain the detail.
 */
export function PayslipReauthModal({
  open,
  payslipId,
  onClose,
  onRevealed,
  reauth = payslipApi.reauth,
  getOne = payslipApi.getOne,
}: PayslipReauthModalProps) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear factor nhạy mỗi khi modal đóng (kể cả unmount).
  useEffect(() => {
    if (!open) {
      setPassword("");
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;
    setError(null);
    setLoading(true);
    // Tách 2 bước: lỗi re-auth (sai mật khẩu / cửa sổ từ chối) PHẢI phân biệt với
    // lỗi tải phiếu lương sau khi đã xác minh — nếu gộp, user không biết đã xác minh hay chưa.
    try {
      await reauth(payslipId, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xác minh thất bại.");
      setLoading(false);
      return;
    }
    let detail;
    try {
      detail = await getOne(payslipId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Không tải được phiếu lương sau xác minh. Thử lại.",
      );
      setLoading(false);
      return;
    }
    // Clear factor nhạy TRƯỚC callbacks; đóng modal TRƯỚC khi bàn giao data
    // (onRevealed có ném thì modal đã đóng, không kẹt mở im lặng).
    setLoading(false);
    setPassword("");
    onClose();
    onRevealed(detail);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Xác minh để xem phiếu lương"
      description="Nhập lại mật khẩu để xem chi tiết phiếu lương. Mỗi lần xem được ghi nhật ký."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1">
          <label htmlFor="payslip-reauth-password" className="text-sm font-medium">
            Mật khẩu
          </label>
          <Input
            id="payslip-reauth-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoFocus
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
            {loading ? "Đang xác minh…" : "Xác minh để xem"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
