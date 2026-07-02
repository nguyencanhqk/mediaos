/**
 * i18n (vi) cho nhóm màn quản trị dữ liệu gốc HR — S2-FE-HR-5 (lane HR5-SCREENS).
 *
 * Đóng góp cây `hr.masterData.*` vào namespace `hr` DÙNG CHUNG (deep-merge, không ghi đè hr.ts) qua
 * `registerI18nResources` — chạy 1 lần khi module được import (mọi màn master-data import file này).
 *
 * LÝ DO CO-LOCATE: lane HR5-SCREENS chỉ được sửa trong routes/hr/{departments,positions,job-levels,
 * contract-types}. Đặt file i18n ở đây (thay vì sửa apps/app/src/i18n/locales/vi/hr.ts ngoài phạm vi)
 * giữ chuỗi tiếng Việt tập trung 1 chỗ (KHÔNG hard-code rải rác trong component) mà vẫn trong scope.
 */
import { registerI18nResources } from "@mediaos/web-core";

const masterDataVi = {
  masterData: {
    departments: {
      title: "Phòng ban",
      description: "Quản lý cơ cấu phòng ban trong công ty.",
      addButton: "Thêm phòng ban",
      entity: "phòng ban",
    },
    positions: {
      title: "Chức vụ",
      description: "Quản lý danh mục chức vụ / vị trí công việc.",
      addButton: "Thêm chức vụ",
      entity: "chức vụ",
    },
    jobLevels: {
      title: "Cấp bậc",
      description: "Quản lý danh mục cấp bậc nhân sự.",
      addButton: "Thêm cấp bậc",
      entity: "cấp bậc",
    },
    contractTypes: {
      title: "Loại hợp đồng",
      description: "Quản lý danh mục loại hợp đồng lao động.",
      addButton: "Thêm loại hợp đồng",
      entity: "loại hợp đồng",
    },
    common: {
      createTitle: "Thêm {{entity}}",
      editTitle: "Chỉnh sửa {{entity}}",
      deleteTitle: "Xoá {{entity}}",
      deleteDescription:
        'Bạn có chắc muốn xoá "{{name}}"? Mục sẽ được đánh dấu xoá (soft-delete) và có thể khôi phục bởi quản trị.',
      confirmDelete: "Xoá",
      cancel: "Huỷ",
      save: "Lưu",
      create: "Tạo",
      saving: "Đang lưu…",
      deleting: "Đang xoá…",
      edit: "Sửa",
      delete: "Xoá",
      retry: "Thử lại",
      yes: "Có",
      no: "Không",
      columns: {
        code: "Mã",
        name: "Tên",
        status: "Trạng thái",
        level: "Bậc",
        rankOrder: "Thứ hạng",
        requiresEndDate: "Cần ngày kết thúc",
        parent: "Trực thuộc",
        department: "Phòng ban",
        actions: "Thao tác",
      },
      fields: {
        name: "Tên",
        code: "Mã",
        description: "Mô tả",
        parent: "Phòng ban cha",
        department: "Phòng ban",
        level: "Bậc (1–99)",
        rankOrder: "Thứ hạng",
        requiresEndDate: "Yêu cầu ngày kết thúc hợp đồng",
        status: "Trạng thái",
      },
      placeholders: {
        select: "— Chọn —",
        none: "— Không —",
      },
      status: {
        active: "Đang dùng",
        inactive: "Ngưng dùng",
      },
      empty: {
        title: "Chưa có dữ liệu",
        description: "Chưa có mục nào. Nhấn nút thêm để tạo mục đầu tiên.",
      },
      error: {
        title: "Không thể tải danh sách",
        description: "Có lỗi khi tải dữ liệu. Vui lòng thử lại.",
      },
      forbidden: {
        title: "Không có quyền truy cập",
        description: "Bạn không có quyền xem màn hình này.",
      },
      validation: {
        nameRequired: "Vui lòng nhập tên.",
        codeRequired: "Vui lòng nhập mã.",
        nameTooLong: "Tên quá dài (tối đa 200 ký tự).",
        codeTooLong: "Mã quá dài (tối đa 50 ký tự).",
        numberInvalid: "Giá trị không hợp lệ.",
      },
      submitErrors: {
        conflict: "Mã đã tồn tại. Vui lòng dùng mã khác.",
        forbidden: "Bạn không có quyền thực hiện thao tác này.",
        validation: "Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.",
        server: "Lỗi hệ thống. Vui lòng thử lại sau.",
        generic: "Không thể lưu. Vui lòng thử lại.",
        deleteFailed: "Không thể xoá. Vui lòng thử lại.",
      },
    },
  },
} as const;

// Đóng góp vào namespace `hr` (deep-merge với hr.ts đã init qua @/i18n) — an toàn gọi nhiều lần.
registerI18nResources("vi", { hr: masterDataVi });

export {};
