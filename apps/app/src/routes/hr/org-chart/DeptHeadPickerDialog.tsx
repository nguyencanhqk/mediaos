/**
 * DeptHeadPickerDialog — đặt/đổi/GỠ trưởng đơn vị cho một phòng ban ngay trên sơ đồ tổ chức.
 *
 * Wrapper chọn-MỘT của EmployeeMultiPickerDialog. PATCH /hr/departments/:id — gate
 * update:department ở SERVER (hr-department.controller).
 *
 * `managerEmployeeId` = EMPLOYEE id đúng spec (DB-03 §15 rule 5) — BE validate active + cùng
 * company rồi tự resolve user liên kết ghi vào org_units.head_user_id. Nhân viên CHƯA liên kết
 * tài khoản bị BE 400 (cột lưu FK users) → picker khóa trước + badge cho đỡ vòng lỗi.
 * `managerEmployeeId: null` = GỠ trưởng đơn vị (nút ở footer, chỉ hiện khi phòng ĐANG có trưởng).
 */
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { hrMasterDataApi } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { EmployeeMultiPickerDialog } from "../../../components/EmployeeMultiPickerDialog";

interface DeptHeadPickerDialogProps {
  dept: { id: string; name: string };
  /** Tên trưởng đơn vị hiện tại (từ node sơ đồ) — có thì mới hiện nút GỠ. */
  currentHeadName?: string | null;
  onClose: () => void;
  /** Chạy sau khi lưu/gỡ (kể cả lưu lỗi một phần) — trang cha invalidate org data hiển thị ngay. */
  onSaved: () => void;
}

export function DeptHeadPickerDialog({
  dept,
  currentHeadName = null,
  onClose,
  onSaved,
}: DeptHeadPickerDialogProps) {
  const { t } = useTranslation("hr");

  const removeMutation = useMutation({
    mutationFn: () => hrMasterDataApi.updateDepartment(dept.id, { managerEmployeeId: null }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  return (
    <EmployeeMultiPickerDialog
      selectionMode="single"
      title={t("orgChart.actions.setHead")}
      description={t("orgChart.dialogs.setHeadDesc", { dept: dept.name })}
      isRowDisabled={(e) => !e.userId}
      disabledBadge={t("orgChart.dialogs.noLinkedAccount")}
      confirmLabel={t("orgChart.dialogs.save")}
      onAddOne={(e) => hrMasterDataApi.updateDepartment(dept.id, { managerEmployeeId: e.id })}
      onBatchSettled={onSaved}
      onClose={onClose}
      footerExtra={
        currentHeadName ? (
          <span className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              data-testid="dept-head-picker-remove"
            >
              {t("orgChart.dialogs.removeHead", { name: currentHeadName })}
            </Button>
            {removeMutation.isError && (
              <span role="alert" className="text-xs text-destructive">
                {t("orgChart.dialogs.removeHeadError")}
              </span>
            )}
          </span>
        ) : undefined
      }
      testIdPrefix="dept-head-picker"
    />
  );
}
