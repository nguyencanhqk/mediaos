import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assetApi, assetKeys } from "@mediaos/web-core";
import type { AssetDetailResponseDto, AssetIssueConditionDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { EmployeePicker } from "@/routes/tasks/EmployeePicker";
import { ASSET_ISSUE_CONDITION_OPTIONS } from "../constants";
import { assetErrorI18nKey, parseAssetError, shouldRotateIdempotencyKey } from "../asset-errors";

interface AssetAssignDialogProps {
  open: boolean;
  onClose: () => void;
  assetId: string;
  onAssigned: (asset: AssetDetailResponseDto) => void;
}

/** Khoá idempotency = UUID client sinh. `crypto.randomUUID` có ở mọi trình duyệt mục tiêu (secure ctx). */
const newIdempotencyKey = () => crypto.randomUUID();

/**
 * ASSET-SCREEN-004 (S11-ASSET-FE-1) — cấp phát tài sản, một bước (ASSET-DEC-002).
 *
 * **Vòng đời `Idempotency-Key`** (SPEC-13 §12) — client sinh khoá MỘT LẦN KHI MỞ FORM, không phải mỗi
 * lần bấm Gửi: cả điểm của khoá là hai lần bấm-đúp trên CÙNG một ý định phải mang CÙNG khoá thì server
 * mới gộp được. Sinh lại mỗi lần submit là vô hiệu hoá cơ chế.
 *
 * Server KHÔNG tự suy khoá từ payload: ngày cấp không nằm trong body ⇒ mọi khoá "suy từ payload" phải
 * lấy đồng hồ server (vi phạm `period-key-idempotency-needs-frozen-source`), và nó chặn nhầm ca hợp lệ
 * "thu hồi rồi cấp lại cùng người trong ngày".
 *
 * Khoá được sinh MỚI ở đúng ba thời điểm:
 *   1. mở form            — ý định mới
 *   2. sau khi gửi THÀNH CÔNG — lần cấp phát kế tiếp là ý định khác
 *   3. sau `KEY_REUSED`   — server đã ghim khoá đó cho một payload khác trong 15′; giữ nguyên là kẹt
 *      vòng lặp vĩnh viễn cho tới khi TTL hết
 * `IN_PROGRESS` thì NGƯỢC LẠI: giữ nguyên khoá và chờ — đổi khoá lúc đó tạo bản ghi THỨ HAI.
 */
export function AssetAssignDialog({ open, onClose, assetId, onAssigned }: AssetAssignDialogProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();

  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [issueCondition, setIssueCondition] = useState<AssetIssueConditionDto>("Good");
  const [issueNote, setIssueNote] = useState("");
  const [expectedReturnDate, setExpectedReturnDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  // (1) Mở form ⇒ khoá mới + form sạch. Không reset khi ĐÓNG: người dùng đóng nhầm rồi mở lại nhanh
  // vẫn là cùng một ý định, và khoá cũ đã hết vai trò khi lần mở sau cấp khoá mới.
  useEffect(() => {
    if (!open) return;
    setIdempotencyKey(newIdempotencyKey());
    setEmployeeId(null);
    setEmployeeName(null);
    setIssueCondition("Good");
    setIssueNote("");
    setExpectedReturnDate("");
    setError(null);
  }, [open]);

  const assignMutation = useMutation({
    mutationFn: () =>
      assetApi.assignAsset(
        assetId,
        {
          employeeId: employeeId as string,
          issueCondition,
          issueNote: issueNote.trim() === "" ? null : issueNote.trim(),
          expectedReturnDate: expectedReturnDate === "" ? null : expectedReturnDate,
        },
        idempotencyKey,
      ),
    onSuccess: (asset) => {
      // (2) Gửi thành công ⇒ ý định kế tiếp phải mang khoá khác.
      setIdempotencyKey(newIdempotencyKey());
      setError(null);
      void queryClient.invalidateQueries({ queryKey: assetKeys.detail(assetId) });
      void queryClient.invalidateQueries({ queryKey: assetKeys.assignmentsOf(assetId) });
      void queryClient.invalidateQueries({ queryKey: [...assetKeys.all, "list"] });
      onAssigned(asset);
      onClose();
    },
    onError: (err) => {
      const info = parseAssetError(err);
      setError(t(assetErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
      // (3) KEY_REUSED ⇒ xoay khoá. IN_PROGRESS ⇒ GIỮ (shouldRotate trả false) rồi để người dùng bấm lại.
      if (shouldRotateIdempotencyKey(info)) setIdempotencyKey(newIdempotencyKey());
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("assign.title")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("form.cancel")}
          </Button>
          <Button
            disabled={!employeeId || assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
          >
            {assignMutation.isPending ? t("states.saving") : t("assign.submit")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-sm">
          <span className="mb-1 block font-medium">{t("assign.employee")}</span>
          {/* TÁI DÙNG EmployeePicker của TASK: nó đã lọc `status: "active"` ở server — đúng ràng buộc
              SPEC-13 §9 ("chỉ active") và ASSET-ERR-002 (nhân viên nghỉ việc ⇒ 422). Dựng bản thứ hai
              ở đây là chắc chắn trôi khỏi bản kia, đúng lý do component này từng được gom lại. */}
          <EmployeePicker
            employeeId={employeeId}
            name={employeeName}
            avatarUrl={null}
            onSelect={(id) => setEmployeeId(id)}
            canEdit
            showName
            testId="asset-assign-employee"
            emptyLabel={t("assign.employeePlaceholder")}
          />
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("assign.issueCondition")}</span>
          <Select
            value={issueCondition}
            onChange={(e) => setIssueCondition(e.target.value as AssetIssueConditionDto)}
          >
            {ASSET_ISSUE_CONDITION_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {t(`issueCondition.${c}`)}
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("assign.expectedReturnDate")}</span>
          <Input
            type="date"
            value={expectedReturnDate}
            onChange={(e) => setExpectedReturnDate(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("assign.issueNote")}</span>
          <Input value={issueNote} onChange={(e) => setIssueNote(e.target.value)} />
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
