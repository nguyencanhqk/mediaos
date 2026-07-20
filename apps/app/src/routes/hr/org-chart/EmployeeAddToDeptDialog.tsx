/**
 * EmployeeAddToDeptDialog — thêm nhân viên CÓ SẴN vào một phòng ban (S5-HR-ORGCHART-FE-3).
 *
 * Nâng cấp theo benchmark Base/AMIS: wrapper mỏng của EmployeeMultiPickerDialog (tìm kiếm server +
 * lọc phòng ban + phân trang + chọn NHIỀU) thay cho <select> đơn cũ. PATCH /hr/employees/:id
 * { orgUnitId: dept.id } TỪNG người — gate update:employee ở SERVER. Người ĐANG ở phòng này
 * (orgUnitId === dept.id) hiện mờ + khóa checkbox.
 */
import { useTranslation } from "react-i18next";
import { hrApi } from "@mediaos/web-core";
import { EmployeeMultiPickerDialog } from "../../../components/EmployeeMultiPickerDialog";

interface EmployeeAddToDeptDialogProps {
  dept: { id: string; name: string };
  onClose: () => void;
  /** Chạy sau MỖI đợt thêm (kể cả partial) — trang cha invalidate org data hiển thị ngay. */
  onSaved: () => void;
}

export function EmployeeAddToDeptDialog({ dept, onClose, onSaved }: EmployeeAddToDeptDialogProps) {
  const { t } = useTranslation("hr");

  return (
    <EmployeeMultiPickerDialog
      title={t("orgChart.actions.addToDept")}
      description={t("orgChart.dialogs.addToDeptDesc", { dept: dept.name })}
      isRowDisabled={(e) => e.orgUnitId === dept.id}
      disabledBadge={t("orgChart.dialogs.alreadyInDept")}
      onAddOne={(e) => hrApi.updateEmployee(e.id, { orgUnitId: dept.id })}
      onBatchSettled={onSaved}
      onClose={onClose}
      testIdPrefix="dept-picker"
    />
  );
}
