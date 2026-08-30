import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { assetApi, assetKeys } from "@mediaos/web-core";
import type { AssetDetailResponseDto, AssetReturnConditionDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { ASSET_RETURN_CONDITION_OPTIONS } from "../constants";
import { assetErrorI18nKey, parseAssetError } from "../asset-errors";

interface AssetRevokeDialogProps {
  open: boolean;
  onClose: () => void;
  assetId: string;
  onRevoked: (asset: AssetDetailResponseDto) => void;
}

/**
 * ASSET-SCREEN-004 (S11-ASSET-FE-1) — thu hồi tài sản.
 *
 * `returnCondition` BẮT BUỘC và thuộc bộ đóng `Good`/`Damaged`/`Lost` — ép ở **CHECK cấp DB**, không
 * chỉ Zod (ASSET-ERR-016). Không có giá trị mặc định rỗng: select luôn có giá trị hợp lệ ngay từ đầu.
 *
 * `Lost` KHÔNG phải là "một tình trạng như hai cái kia": nó đưa tài sản sang trạng thái `Lost` thay vì
 * về kho (SPEC-13 §13.2) — tức là một quyết định vòng đời, nên phải cảnh báo TRƯỚC khi gửi chứ không
 * để người dùng phát hiện sau khi bảng đã đổi.
 *
 * KHÔNG cần `Idempotency-Key`: thu hồi hai lần thì lần thứ hai gặp ASSET-ERR-003 (không còn lượt
 * Active) — đã idempotent về mặt nghiệp vụ nhờ partial unique, khác hẳn cấp phát.
 */
export function AssetRevokeDialog({ open, onClose, assetId, onRevoked }: AssetRevokeDialogProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();

  const [returnCondition, setReturnCondition] = useState<AssetReturnConditionDto>("Good");
  const [returnNote, setReturnNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReturnCondition("Good");
    setReturnNote("");
    setError(null);
  }, [open]);

  const revokeMutation = useMutation({
    mutationFn: () =>
      assetApi.revokeAsset(assetId, {
        returnCondition,
        returnNote: returnNote.trim() === "" ? null : returnNote.trim(),
      }),
    onSuccess: (asset) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: assetKeys.detail(assetId) });
      void queryClient.invalidateQueries({ queryKey: assetKeys.assignmentsOf(assetId) });
      void queryClient.invalidateQueries({ queryKey: [...assetKeys.all, "list"] });
      onRevoked(asset);
      onClose();
    },
    onError: (err) => {
      const info = parseAssetError(err);
      setError(t(assetErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("revoke.title")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button
            variant={returnCondition === "Lost" ? "destructive" : "default"}
            disabled={revokeMutation.isPending}
            onClick={() => revokeMutation.mutate()}
          >
            {revokeMutation.isPending ? t("states.saving") : t("revoke.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("revoke.returnCondition")}</span>
          <Select
            value={returnCondition}
            onChange={(e) => setReturnCondition(e.target.value as AssetReturnConditionDto)}
          >
            {ASSET_RETURN_CONDITION_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {t(`returnCondition.${c}`)}
              </option>
            ))}
          </Select>
        </label>

        {returnCondition === "Lost" && (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {t("revoke.lostWarning")}
          </p>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("revoke.returnNote")}</span>
          <Input value={returnNote} onChange={(e) => setReturnNote(e.target.value)} />
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
