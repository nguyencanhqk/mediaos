/**
 * Khóa dùng chung cho EmployeeMultiPickerDialog (components/) — deep-merge vào namespace `common`
 * của @mediaos/web-core qua registerI18nResources. Nhãn RIÊNG theo ngữ cảnh (title/description/
 * badge hàng khóa/slot phụ) do caller truyền bằng namespace của feature, KHÔNG nằm ở đây.
 */
export default {
  employeePicker: {
    searchPlaceholder: "Tìm theo tên, email, mã nhân viên…",
    allDepartments: "Tất cả phòng ban",
    departmentFilter: "Lọc theo phòng ban",
    columns: {
      name: "Họ và tên",
      position: "Vị trí công việc",
      email: "Email",
      department: "Phòng ban",
    },
    selectAllPage: "Chọn tất cả trang này",
    selectedCount: "Đã chọn {{count}}",
    totalCount: "Tổng số {{count}} nhân viên",
    prevPage: "Trang trước",
    nextPage: "Trang sau",
    empty: "Không tìm thấy nhân viên phù hợp.",
    loadError: "Không tải được danh sách nhân viên. Vui lòng thử lại.",
    partialError:
      "{{count}} nhân viên chưa thêm được — họ vẫn đang được chọn, bấm Thêm để thử lại.",
    confirm: "Thêm",
    confirmCount: "Thêm ({{count}})",
    cancel: "Hủy",
  },
} as const;
