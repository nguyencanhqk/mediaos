/**
 * i18n (vi) cho module Hợp đồng nhân viên — S2-FE-HR-7.
 *
 * Đóng góp `hr.contracts.*` (dùng cho /hr/contracts + /hr/employees/:id/contracts) + `hr.masterData.
 * employeeContracts.*` (MasterDataCrudScreen tKey="employeeContracts", tái dùng cho CRUD hợp đồng của 1
 * nhân viên) vào namespace `hr` dùng chung (deep-merge, KHÔNG ghi đè hr.ts) qua `registerI18nResources` —
 * chạy 1 lần khi module được import.
 */
import { registerI18nResources } from "@mediaos/web-core";

const hrVi = {
  masterData: {
    employeeContracts: {
      title: "Hợp đồng lao động",
      description: "Quản lý hợp đồng lao động của nhân viên này.",
      addButton: "Thêm hợp đồng",
      entity: "hợp đồng",
    },
  },
  contracts: {
    title: "Hợp đồng lao động",
    description: "Danh sách hợp đồng lao động toàn công ty (theo phạm vi quyền).",
    backToEmployee: "Quay lại hồ sơ nhân viên",
    status: {
      Draft: "Nháp",
      Active: "Đang hiệu lực",
      Expired: "Đã hết hạn",
      Terminated: "Đã chấm dứt",
      Cancelled: "Đã huỷ",
    },
    filters: {
      employeeId: "Mã nhân viên",
      employeeIdPlaceholder: "UUID nhân viên…",
      status: "Trạng thái",
      allStatuses: "Tất cả trạng thái",
      expiringOnly: "Chỉ hợp đồng sắp hết hạn",
    },
    columns: {
      code: "Số HĐ",
      title: "Tiêu đề",
      employee: "Nhân viên",
      contractType: "Loại hợp đồng",
      startDate: "Ngày bắt đầu",
      endDate: "Ngày kết thúc",
      status: "Trạng thái",
      expiring: "Cảnh báo",
      actions: "Hành động",
    },
    expiringSoon: "Sắp hết hạn",
    viewEmployeeContracts: "Xem hợp đồng",
    empty: {
      title: "Không có hợp đồng",
      description: "Chưa có hợp đồng nào phù hợp với bộ lọc.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách hợp đồng. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem hợp đồng lao động.",
    },
    fields: {
      contractType: "Loại hợp đồng",
      contractCode: "Số hợp đồng",
      title: "Tiêu đề",
      startDate: "Ngày bắt đầu",
      endDate: "Ngày kết thúc",
      signedDate: "Ngày ký",
      status: "Trạng thái",
      isPrimary: "Hợp đồng chính",
      note: "Ghi chú",
    },
    validation: {
      contractTypeRequired: "Vui lòng chọn loại hợp đồng.",
      startDateRequired: "Vui lòng nhập ngày bắt đầu.",
      dateInvalid: "Ngày không hợp lệ (định dạng YYYY-MM-DD).",
      endBeforeStart: "Ngày kết thúc không được trước ngày bắt đầu.",
    },
    download: "Tải hợp đồng",
    downloading: "Đang mở…",
    downloadError: "Không thể tạo liên kết tải. Vui lòng thử lại.",
    linkFile: {
      button: "Gắn file",
      title: "Gắn file hợp đồng",
      description: "Nhập ID file đã tải lên hệ thống (Foundation Files) để gắn vào hợp đồng này.",
      fileIdLabel: "ID file (UUID)",
      submit: "Gắn file",
      submitting: "Đang gắn…",
      cancel: "Huỷ",
      error: "Không thể gắn file. Kiểm tra lại ID file.",
    },
  },
} as const;

registerI18nResources("vi", { hr: hrVi });

export {};
