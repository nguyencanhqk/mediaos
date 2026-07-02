/**
 * LinkContractFileDialog — gắn file hợp đồng đã upload (Foundation Files) vào 1 hợp đồng — S2-FE-HR-7.
 *
 * Đi qua endpoint RIÊNG POST /hr/contracts/:id/file (contractsApi.linkContractFile) — server validate
 * file thuộc cùng tenant + scan_status khác Infected trước khi set contract.file_id (KHÔNG set fileId
 * trực tiếp qua create/update, tránh bỏ qua validate). Upload file (chọn/tải lên) là tính năng Foundation
 * Files riêng, ngoài phạm vi WO này — dialog chỉ nhận ID file đã có sẵn.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { EmployeeContractDto } from "@mediaos/contracts";
import { contractsApi, hrContractsInvalidation } from "@mediaos/web-core";
import { Button, Dialog, Input } from "@mediaos/ui";

export function LinkContractFileDialog({
  contract,
  employeeId,
  onClose,
}: {
  contract: EmployeeContractDto;
  employeeId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("hr");
  const queryClient = useQueryClient();
  const [fileId, setFileId] = useState("");

  const mutation = useMutation({
    mutationFn: () => contractsApi.linkContractFile(contract.id, fileId.trim()),
    onSuccess: async () => {
      await Promise.all(
        hrContractsInvalidation
          .mutate(employeeId)
          .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      onClose();
    },
  });

  const busy = mutation.isPending;
  const noop = () => {};
  const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    fileId.trim(),
  );

  return (
    <Dialog
      open
      onClose={busy ? noop : onClose}
      title={t("contracts.linkFile.title")}
      description={t("contracts.linkFile.description")}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("contracts.linkFile.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={busy || !isValidUuid}
            data-testid="link-file-submit"
          >
            {busy ? t("contracts.linkFile.submitting") : t("contracts.linkFile.submit")}
          </Button>
        </>
      }
    >
      {mutation.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("contracts.linkFile.error")}
        </p>
      )}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          {t("contracts.linkFile.fileIdLabel")}
        </label>
        <Input
          value={fileId}
          onChange={(e) => setFileId(e.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          autoComplete="off"
        />
      </div>
    </Dialog>
  );
}
