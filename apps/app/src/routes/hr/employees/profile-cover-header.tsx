import { type ReactNode } from "react";
import { EmployeeStatusBadge } from "../employee-status";
import { type HrEmployeeDetail } from "@mediaos/contracts";

/**
 * Banner "cover" của màn hồ sơ — avatar + tên + mã + chức vụ–đơn vị + trạng thái + hành động.
 *
 * TÁCH RA dùng chung cho /hr/employees/:id (EmployeeDetailPage) và /me/profile (MyProfilePage) để 2 màn
 * KHÔNG trôi khỏi nhau về mặt hiển thị. Component này THUẦN trình bày — KHÔNG chứa logic quyền, KHÔNG tự
 * gọi API: mỗi màn tự dựng phần avatar (scope KHÁC NHAU: HR đổi ảnh người khác qua update:employee, còn
 * /me/profile là own-scope qua /me/avatar) rồi truyền vào slot `avatar`, tương tự với `actions`.
 */
interface ProfileCoverHeaderProps {
  /** Slot avatar — mỗi màn tự dựng theo scope quyền của nó (xem ghi chú trên). */
  avatar: ReactNode;
  fullName: HrEmployeeDetail["fullName"];
  employeeCode: HrEmployeeDetail["employeeCode"];
  positionName: HrEmployeeDetail["positionName"];
  orgUnitName: HrEmployeeDetail["orgUnitName"];
  status: HrEmployeeDetail["status"];
  /** Slot nút hành động bên phải (Quay lại/Sửa/Hợp đồng… hoặc Đề nghị thay đổi hồ sơ). */
  actions?: ReactNode;
}

export function ProfileCoverHeader({
  avatar,
  fullName,
  employeeCode,
  positionName,
  orgUnitName,
  status,
  actions,
}: ProfileCoverHeaderProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Banner luôn tối (navy chrome) theo chủ đích cả 2 theme, không đổi theo light/dark */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#0f1a2e] via-[#16243d] to-[#1e304f] px-5 py-5">
        <div className="flex items-center gap-4">
          {avatar}
          <div className="text-white">
            <p className="text-lg leading-tight font-semibold uppercase">
              {fullName ?? "—"}
              <span className="ml-2 text-sm font-normal text-white/80">
                ({employeeCode ?? "—"})
              </span>
            </p>
            <p className="text-sm text-white/80">
              {[positionName, orgUnitName].filter(Boolean).join(" – ") || "—"}
            </p>
          </div>
          <EmployeeStatusBadge status={status} />
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** Class dùng chung cho nút đặt TRÊN banner tối — giữ tương phản ở cả 2 theme. */
export const COVER_ACTION_BUTTON_CLASS = "border-white/40 bg-white/10 text-white hover:bg-white/20";
