import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assetApi, assetKeys } from "@mediaos/web-core";
import type { AssetDetailResponseDto } from "@mediaos/contracts";
import { Button, Dialog, Input } from "@mediaos/ui";
import { ASSET_REASON_MIN_LENGTH } from "../constants";
import { assetErrorI18nKey, parseAssetError } from "../asset-errors";

/** Ba hành động dùng CHUNG một hộp thoại vì cùng hình: một ô lý do bắt buộc + một nút xác nhận. */
export type AssetDisposeMode = "dispose" | "markLost" | "recover";

interface AssetDisposeDialogProps {
  open: boolean;
  onClose: () => void;
  assetId: string;
  mode: AssetDisposeMode;
  onDone: (asset: AssetDetailResponseDto) => void;
}

/**
 * S11-ASSET-FE-1 — thanh lý (ASSET-API-016 `kind: Disposed`) · ghi nhận mất (016 `kind: Lost`) · tìm
 * thấy lại (017). Cả ba đi CHUNG cặp quyền `dispose:asset` (SPEC-13 §11) nên gộp một hộp thoại là
 * đúng ranh giới, không phải gộp cho tiện.
 *
 * `reason` tối thiểu 3 ký tự — chặn ở client cho khỏi round-trip, nhưng vế thật là Zod ở server trả
 * **400 VALIDATION-ERR-001** (không phải 422 ASSET-ERR-009 như bảng spec ghi: `.min(3)` bắt trước khi
 * service chạy). Vì thế nút bị disable là đường chính, còn thông điệp lỗi chỉ là lưới hứng.
 */
export function AssetDisposeDialog({
  open,
  onClose,
  assetId,
  mode,
  onDone,
}: AssetDisposeDialogProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();

  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(null);
  }, [open, mode]);

  const mutation = useMutation({
    mutationFn: () => {
      const trimmed = reason.trim();
      if (mode === "recover") return assetApi.recoverAsset(assetId, { reason: trimmed });
      return assetApi.disposeAsset(assetId, {
        kind: mode === "dispose" ? "Disposed" : "Lost",
        reason: trimmed,
      });
    },
    onSuccess: (asset) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: assetKeys.detail(assetId) });
      // Thanh lý/mất có thể tự đóng lượt cấp phát Active và lượt bảo trì Open (SPEC-13 §13.1) ⇒ làm
      // mới CẢ HAI sổ, không chỉ chi tiết: nếu không, tab «Lịch sử cấp phát» vẫn hiện lượt đang Active
      // cho một tài sản đã thanh lý.
      void queryClient.invalidateQueries({ queryKey: assetKeys.assignmentsOf(assetId) });
      void queryClient.invalidateQueries({ queryKey: assetKeys.maintenancesOf(assetId) });
      void queryClient.invalidateQueries({ queryKey: [...assetKeys.all, "list"] });
      onDone(asset);
      onClose();
    },
    onError: (err) => {
      const info = parseAssetError(err);
      setError(t(assetErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  const titleKey =
    mode === "dispose"
      ? "dispose.disposeTitle"
      : mode === "markLost"
        ? "dispose.lostTitle"
        : "dispose.recoverTitle";

  const reasonOk = reason.trim().length >= ASSET_REASON_MIN_LENGTH;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(titleKey)}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button
            variant={mode === "recover" ? "default" : "destructive"}
            disabled={!reasonOk || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? t("states.saving") : t("dispose.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("dispose.reason")}</span>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-invalid={reason !== "" && !reasonOk}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("dispose.reasonHint")}
          </span>
        </label>

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
