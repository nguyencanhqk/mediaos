import { useCallback, useEffect, useMemo, useState } from "react";
import type { PayslipDto } from "@mediaos/contracts";
import { PayslipReauthModal } from "./payslip-reauth-modal";

interface PendingReauth {
  payslipId: string;
  resolve: (detail: PayslipDto | null) => void;
}

interface PayslipReauthController {
  /** Open modal for payslipId → resolve detail (or null if cancelled). */
  requestReauth: (payslipId: string) => Promise<PayslipDto | null>;
  /** Render once at page level. */
  modal: React.ReactNode;
}

/**
 * usePayslipReauthController — mirror of useRevealController (G6-2h) for payslips.
 *
 * One modal per page, Promise-based. The controller never retains the detail
 * (plaintext money) in its own state — it forwards via Promise.resolve and forgets.
 * Cleanup on unmount resolves any pending promise with null (no leak).
 */
export function usePayslipReauthController(): PayslipReauthController {
  const [pending, setPending] = useState<PendingReauth | null>(null);

  const requestReauth = useCallback(
    (payslipId: string) =>
      new Promise<PayslipDto | null>((resolve) => {
        setPending((prev) => {
          prev?.resolve(null);
          return { payslipId, resolve };
        });
      }),
    [],
  );

  const handleRevealed = useCallback((detail: PayslipDto) => {
    setPending((prev) => {
      prev?.resolve(detail);
      return null;
    });
  }, []);

  const handleClose = useCallback(() => {
    setPending((prev) => {
      prev?.resolve(null);
      return null;
    });
  }, []);

  // Unmount cleanup — resolve pending promise as null to prevent leak.
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
        <PayslipReauthModal
          open
          payslipId={pending.payslipId}
          onRevealed={handleRevealed}
          onClose={handleClose}
        />
      ) : null,
    [pending, handleRevealed, handleClose],
  );

  return { requestReauth, modal };
}
