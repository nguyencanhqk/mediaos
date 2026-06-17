import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TenantModuleStateDto } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { modulesApi } from "@/lib/modules-api";
import { tenantModulesQueryKey } from "./modules-query";

interface ModuleToggleDialogProps {
  /** Tenant đang thao tác. */
  companyId: string;
  /** Module đang bật/tắt; null = dialog đóng. */
  module: TenantModuleStateDto | null;
  onClose: () => void;
}

/**
 * Dialog xác nhận bật/tắt 1 module cho 1 tenant (gate `manage:module-toggle` — is_sensitive + step-up).
 * Map vào `PUT admin/platform/companies/:id/modules/:moduleKey`. enabled = đảo trạng thái hiện tại.
 *
 * Lưu ý: route server yêu cầu step-up window (OperatorReauthGuard). Nếu thiếu, server trả 403
 * (deny-reauth-required) → hiển thị error.reauthRequired để operator step-up trước.
 */
export function ModuleToggleDialog({ companyId, module, onClose }: ModuleToggleDialogProps) {
  const { t } = useTranslation("modules");
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [module]);

  const nextEnabled = module ? !module.enabled : false;

  const mutation = useMutation({
    mutationFn: () => {
      if (!module) throw new Error("no module");
      return modulesApi.toggle(companyId, module.key, { enabled: nextEnabled });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: tenantModulesQueryKey(companyId) });
      handleClose();
    },
    onError: (err: unknown) => {
      // 403 step-up thiếu vs lỗi chung — thông điệp riêng để operator biết cần re-auth.
      const status = (err as { status?: number } | null)?.status;
      setError(status === 403 ? t("error.reauthRequired") : t("error.toggleFailed"));
    },
  });

  const handleClose = () => {
    setError(null);
    mutation.reset();
    onClose();
  };

  return (
    <Dialog
      open={module !== null}
      onClose={handleClose}
      title={nextEnabled ? t("toggle.enableTitle") : t("toggle.disableTitle")}
      description={module ? t("toggle.description", { name: module.name }) : ""}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={mutation.isPending}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            variant={nextEnabled ? "default" : "destructive"}
          >
            {mutation.isPending
              ? t("common:saving")
              : nextEnabled
                ? t("toggle.confirmEnable")
                : t("toggle.confirmDisable")}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" aria-live="assertive" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {module && (
        <p className="text-sm text-muted-foreground">
          {t("toggle.featureKeys", { keys: module.featureKeys.join(", ") || "—" })}
        </p>
      )}
    </Dialog>
  );
}
