/**
 * i18n (vi) cho màn quản trị Loại nghỉ / Chính sách nghỉ phép — S3-FE-LEAVE-5 (LEAVE-SCREEN-010/011).
 *
 * Đóng góp `hr.masterData.leaveTypes.*` + `hr.masterData.leavePolicies.*` vào namespace `hr` DÙNG CHUNG
 * (deep-merge, KHÔNG ghi đè hr.ts) qua `registerI18nResources` — chạy 1 lần khi module được import.
 *
 * LÝ DO namespace "hr" (dù đây là màn LEAVE): `MasterDataCrudScreen` + field helpers dùng chung
 * (TextField/SelectField/StatusField/CheckboxField, `apps/app/src/routes/hr/departments/`) hard-code
 * `useTranslation("hr")` bên trong — tái dùng NGUYÊN component đòi khớp namespace đó (mirror
 * routes/hr/contracts/contracts-i18n.ts đã làm y hệt cho `masterData.employeeContracts`). Tránh viết lại
 * 1 CRUD-screen wrapper mới chỉ để đổi namespace (DRY — packages/ui + component sẵn có).
 */
import { registerI18nResources } from "@mediaos/web-core";

const leaveMasterDataVi = {
  masterData: {
    leaveTypes: {
      title: "Loại nghỉ phép",
      description: "Cấu hình danh mục loại nghỉ phép (LEAVE-SCREEN-010).",
      addButton: "Thêm loại nghỉ",
      entity: "loại nghỉ",
      fields: {
        code: "Mã loại nghỉ",
        name: "Tên loại nghỉ",
        paid: "Có hưởng lương",
        description: "Mô tả",
        deductBalance: "Trừ số dư phép",
        balanceUnit: "Đơn vị tính",
        allowFullDay: "Cho nghỉ cả ngày",
        allowHalfDay: "Cho nghỉ nửa ngày",
        allowHourly: "Cho nghỉ theo giờ",
        allowMultipleDays: "Cho nghỉ nhiều ngày",
        requireReason: "Bắt buộc nhập lý do",
        requireAttachment: "Bắt buộc đính kèm file",
        minNoticeDays: "Số ngày báo trước tối thiểu",
        maxDaysPerRequest: "Số ngày tối đa/đơn",
        maxHoursPerRequest: "Số giờ tối đa/đơn",
        allowNegativeBalance: "Cho phép số dư âm",
        sortOrder: "Thứ tự hiển thị",
      },
      balanceUnitOptions: { Day: "Ngày", Hour: "Giờ" },
      knownGap:
        "Danh sách chỉ hiện loại nghỉ đang hoạt động (BE chưa có API xem loại đã vô hiệu hoá).",
    },
    leavePolicies: {
      title: "Chính sách nghỉ phép",
      description: "Cấu hình chính sách áp dụng theo phạm vi (LEAVE-SCREEN-011).",
      addButton: "Thêm chính sách",
      entity: "chính sách",
      fields: {
        leaveTypeId: "Loại nghỉ áp dụng",
        policyCode: "Mã chính sách",
        name: "Tên chính sách",
        description: "Mô tả",
        policyScope: "Phạm vi áp dụng",
        departmentId: "Phòng ban áp dụng",
        employeeId: "Nhân viên áp dụng (UUID)",
        jobLevelId: "Cấp bậc áp dụng",
        contractTypeId: "Loại hợp đồng áp dụng",
        yearlyQuotaDays: "Số ngày phép/năm",
        yearlyQuotaHours: "Số giờ phép/năm",
        accrualMethod: "Phương thức tích luỹ",
        accrualDayOfMonth: "Ngày tích luỹ trong tháng",
        prorateOnJoinDate: "Tính theo ngày vào làm (prorate)",
        includeWeekends: "Tính cả cuối tuần",
        includePublicHolidays: "Tính cả ngày lễ",
        reserveBalanceOnPending: "Giữ chỗ số dư khi đơn chờ duyệt",
        allowNegativeBalance: "Cho phép số dư âm",
        maxNegativeDays: "Số ngày âm tối đa",
        allowCancelAfterApproved: "Cho huỷ đơn sau khi đã duyệt",
        cancelBeforeDays: "Số ngày phải huỷ trước",
        requiresManagerApproval: "Cần quản lý duyệt",
        requiresHrApproval: "Cần HR duyệt",
        effectiveFrom: "Hiệu lực từ ngày",
        effectiveTo: "Hiệu lực đến ngày",
        priority: "Độ ưu tiên",
        status: "Trạng thái",
      },
      scopeOptions: {
        Company: "Toàn công ty",
        Department: "Phòng ban",
        Employee: "Nhân viên",
        JobLevel: "Cấp bậc",
        ContractType: "Loại hợp đồng",
      },
      accrualOptions: {
        None: "Không tích luỹ",
        Monthly: "Theo tháng",
        Yearly: "Theo năm",
        Manual: "Thủ công",
        Prorated: "Chia theo tỷ lệ",
      },
      statusOptions: { Active: "Đang áp dụng", Inactive: "Ngưng áp dụng" },
      validation: {
        departmentRequired: "Phạm vi 'Phòng ban' bắt buộc chọn phòng ban.",
        employeeRequired: "Phạm vi 'Nhân viên' bắt buộc nhập UUID nhân viên.",
        jobLevelRequired: "Phạm vi 'Cấp bậc' bắt buộc chọn cấp bậc.",
        contractTypeRequired: "Phạm vi 'Loại hợp đồng' bắt buộc chọn loại hợp đồng.",
        effectiveFromRequired: "Vui lòng nhập ngày hiệu lực.",
        dateInvalid: "Ngày không hợp lệ (định dạng YYYY-MM-DD).",
      },
    },
  },
} as const;

registerI18nResources("vi", { hr: leaveMasterDataVi });

export {};
