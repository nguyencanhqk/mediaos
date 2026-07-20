/**
 * DeptHeadPickerDialog — đặt/đổi TRƯỞNG ĐƠN VỊ cho một phòng ban ngay trên sơ đồ tổ chức.
 *
 * Wrapper chọn-MỘT của EmployeeMultiPickerDialog. PATCH /hr/departments/:id — gate
 * update:department ở SERVER (hr-department.controller).
 *
 * LƯU Ý field: DTO đặt tên `managerEmployeeId` nhưng BE (hr-department.service) ghi giá trị này
 * THẲNG vào org_units.head_user_id (FK → users.id, tree join users.fullName ra headUserName) —
 * nên PHẢI truyền `userId` (tài khoản liên kết) của nhân viên, KHÔNG phải employee id. Nhân viên
 * chưa liên kết tài khoản (userId null) không làm trưởng đơn vị được → khóa hàng + badge.
 */
import { useTranslation } from "react-i18next";
import { hrMasterDataApi } from "@mediaos/web-core";
import { EmployeeMultiPickerDialog } from "../../../components/EmployeeMultiPickerDialog";

interface DeptHeadPickerDialogProps {
  dept: { id: string; name: string };
  onClose: () => void;
  /** Chạy sau khi lưu (kể cả lưu lỗi một phần) — trang cha invalidate org data hiển thị ngay. */
  onSaved: () => void;
}

export function DeptHeadPickerDialog({ dept, onClose, onSaved }: DeptHeadPickerDialogProps) {
  const { t } = useTranslation("hr");

  return (
    <EmployeeMultiPickerDialog
      selectionMode="single"
      title={t("orgChart.actions.setHead")}
      description={t("orgChart.dialogs.setHeadDesc", { dept: dept.name })}
      isRowDisabled={(e) => !e.userId}
      disabledBadge={t("orgChart.dialogs.noLinkedAccount")}
      confirmLabel={t("orgChart.dialogs.save")}
      onAddOne={(e) =>
        e.userId
          ? hrMasterDataApi.updateDepartment(dept.id, { managerEmployeeId: e.userId })
          : Promise.reject(new Error("employee has no linked user account"))
      }
      onBatchSettled={onSaved}
      onClose={onClose}
      testIdPrefix="dept-head-picker"
    />
  );
}
