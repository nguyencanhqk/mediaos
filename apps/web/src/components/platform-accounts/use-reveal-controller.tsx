import { useCallback, useEffect, useMemo, useState } from "react";
import { ReAuthModal } from "./reauth-modal";

interface PendingReveal {
  accountId: string;
  accountLabel?: string;
  resolve: (secret: string | null) => void;
}

interface RevealController {
  /** Mở ReAuthModal cho 1 account và resolve plaintext (hoặc null nếu huỷ). Dùng cho SecretField. */
  requestReveal: (accountId: string, accountLabel?: string) => Promise<string | null>;
  /** JSX modal — render MỘT LẦN ở cấp trang. */
  modal: React.ReactNode;
}

/**
 * Cầu nối SecretField ↔ ReAuthModal (🔒 G6-2h): 1 modal dùng chung cho cả bảng, SecretField gọi
 * `requestReveal(accountId)` → mở modal → resolve plaintext về đúng field. Plaintext KHÔNG đi qua đây
 * dưới dạng state lưu giữ — chỉ chuyển tiếp qua Promise.resolve rồi quên (controller không cache secret).
 */
export function useRevealController(): RevealController {
  const [pending, setPending] = useState<PendingReveal | null>(null);

  const requestReveal = useCallback(
    (accountId: string, accountLabel?: string) =>
      new Promise<string | null>((resolve) => {
        // Nếu đang có yêu cầu khác treo → huỷ nó (resolve null) trước khi thay.
        setPending((prev) => {
          prev?.resolve(null);
          return { accountId, accountLabel, resolve };
        });
      }),
    [],
  );

  const handleRevealed = useCallback((secret: string) => {
    setPending((prev) => {
      prev?.resolve(secret);
      return null;
    });
  }, []);

  const handleClose = useCallback(() => {
    setPending((prev) => {
      prev?.resolve(null);
      return null;
    });
  }, []);

  // Controller unmount (vd điều hướng rời trang khi modal đang mở): resolve yêu cầu treo = null,
  // tránh Promise treo vĩnh viễn giữ closure resolve (leak).
  useEffect(() => {
    return () => {
      setPending((prev) => {
        prev?.resolve(null);
        return null;
      });
    };
  }, []);

  const modal = useMemo(
    () =>
      pending ? (
        <ReAuthModal
          open
          accountId={pending.accountId}
          accountLabel={pending.accountLabel}
          onRevealed={handleRevealed}
          onClose={handleClose}
        />
      ) : null,
    [pending, handleRevealed, handleClose],
  );

  return { requestReveal, modal };
}
