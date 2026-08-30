import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assetApi, assetKeys } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";
import { assetErrorI18nKey, parseAssetError } from "../asset-errors";

interface AssetMaintenanceDialogProps {
  open: boolean;
  onClose: () => void;
  assetId: string;
  /** `null` = MỞ lượt mới; có id = ĐÓNG lượt đang mở. */
  openMaintenanceId: string | null;
  onDone: () => void;
}

/**
 * S11-ASSET-FE-1 — mở lượt bảo trì (ASSET-API-013) / đóng lượt (014).
 *
 * Trạng thái sau khi ĐÓNG là **dẫn xuất**, không do client chọn: về `Assigned` nếu còn lượt cấp phát
 * Active, ngược lại `In Stock` (ASSET-FUNC-007 — hệ thống KHÔNG lưu "trạng thái trước"). Nên form đóng
 * lượt không có ô trạng thái, và sau khi đóng phải đọc lại chi tiết để biết tài sản rơi về đâu.
 *
 * `nextDueDate` phải SAU ngày đóng (ASSET-ERR-014 / kind `next-due-not-after-close`) — để server quyết
 * vì "ngày đóng" là đồng hồ server, client so bằng đồng hồ máy mình sẽ lệch ở gần nửa đêm.
 */
export function AssetMaintenanceDialog({
  open,
  onClose,
  assetId,
  openMaintenanceId,
  onDone,
}: AssetMaintenanceDialogProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();
  const isClosing = openMaintenanceId !== null;

  const [reason, setReason] = useState("");
  const [vendor, setVendor] = useState("");
  const [resultNote, setResultNote] = useState("");
  const [cost, setCost] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setVendor("");
    setResultNote("");
    setCost("");
    setNextDueDate("");
    setError(null);
  }, [open, openMaintenanceId]);

  const mutation = useMutation({
    mutationFn: () => {
      if (isClosing) {
        return assetApi.closeMaintenance(assetId, openMaintenanceId, {
          resultNote: resultNote.trim() === "" ? null : resultNote.trim(),
          cost: cost === "" ? null : Number(cost),
          nextDueDate: nextDueDate === "" ? null : nextDueDate,
        });
      }
      return assetApi.openMaintenance(assetId, {
        reason: reason.trim(),
        vendor: vendor.trim() === "" ? null : vendor.trim(),
      });
    },
    onSuccess: () => {
      setError(null);
      // Trạng thái tài sản đổi ở CẢ hai chiều (mở ⇒ Under Maintenance; đóng ⇒ dẫn xuất) nên phải
      // invalidate chi tiết, không chỉ sổ bảo trì.
      void queryClient.invalidateQueries({ queryKey: assetKeys.detail(assetId) });
      void queryClient.invalidateQueries({ queryKey: assetKeys.maintenancesOf(assetId) });
      void queryClient.invalidateQueries({ queryKey: [...assetKeys.all, "list"] });
      onDone();
      onClose();
    },
    onError: (err) => {
      const info = parseAssetError(err);
      setError(t(assetErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  const canSubmit = isClosing || reason.trim() !== "";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(isClosing ? "maintenance.closeTitle" : "maintenance.openTitle")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending
              ? t("states.saving")
              : t(isClosing ? "maintenance.submitClose" : "maintenance.submitOpen")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {isClosing ? (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("maintenance.resultNote")}</span>
              <Input value={resultNote} onChange={(e) => setResultNote(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("maintenance.cost")}</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("maintenance.nextDueDate")}</span>
              <Input
                type="date"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("maintenance.reason")}</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("maintenance.vendor")}</span>
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </label>
          </>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
