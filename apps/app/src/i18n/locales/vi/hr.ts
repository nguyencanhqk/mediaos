/**
 * Namespace "hr" (vi) — màn hình nhân sự (S2-FE-HR-1).
 * KHÔNG hard-code chuỗi tiếng Việt rải rác trong component — tất cả qua t("hr.*").
 */
export default {
  pageTitle: "Nhân sự",
  employees: {
    title: "Danh sách nhân viên",
    description: "Quản lý hồ sơ nhân viên trong công ty",
    addEmployee: "Thêm nhân viên",
    exportList: "Xuất file",
    search: "Tìm theo tên, mã, email…",
    filterDepartment: "Phòng ban",
    filterStatus: "Trạng thái",
    allDepartments: "Tất cả phòng ban",
    allStatuses: "Tất cả trạng thái",
    columns: {
      code: "Mã NV",
      name: "Họ tên",
      email: "Email",
      department: "Phòng ban",
      position: "Chức vụ",
      status: "Trạng thái",
      actions: "Hành động",
    },
    actions: {
      view: "Xem hồ sơ",
      edit: "Chỉnh sửa",
      changeStatus: "Đổi trạng thái",
    },
    empty: {
      title: "Không có nhân viên",
      description: "Chưa có hồ sơ nhân viên nào phù hợp với bộ lọc.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách nhân viên. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem danh sách nhân viên.",
    },
  },
  detail: {
    title: "Hồ sơ nhân viên",
    backToList: "Quay lại danh sách",
    tabs: {
      overview: "Tổng quan",
      personal: "Thông tin cá nhân",
      work: "Công việc",
    },
    fields: {
      code: "Mã nhân viên",
      name: "Họ tên",
      email: "Email công ty",
      department: "Phòng ban",
      position: "Chức vụ",
      status: "Trạng thái",
      startDate: "Ngày vào làm",
      endDate: "Ngày kết thúc",
      workType: "Hình thức làm việc",
      employmentType: "Loại hợp đồng",
    },
    sensitiveFields: {
      phone: "Số điện thoại",
      contractType: "Loại hợp đồng (nhạy cảm)",
      notes: "Ghi chú",
      baseSalary: "Lương cơ bản",
    },
    masked: "— (bị ẩn do phân quyền) —",
    notLinked: "Chưa liên kết",
    error: {
      title: "Không thể tải hồ sơ",
      description: "Có lỗi khi tải hồ sơ nhân viên. Vui lòng thử lại.",
    },
    notFound: {
      title: "Không tìm thấy hồ sơ",
      description: "Hồ sơ nhân viên không tồn tại hoặc bạn không có quyền xem.",
    },
  },
  me: {
    title: "Hồ sơ của tôi",
    description: "Thông tin hồ sơ cá nhân của bạn",
    notLinked: {
      title: "Chưa liên kết hồ sơ nhân viên",
      description: "Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên. Vui lòng liên hệ HR.",
    },
    error: {
      title: "Không thể tải hồ sơ",
      description: "Có lỗi khi tải hồ sơ của bạn. Vui lòng thử lại.",
    },
  },
  status: {
    active: "Đang làm việc",
    inactive: "Tạm nghỉ",
    resigned: "Đã nghỉ việc",
    terminated: "Chấm dứt HĐ",
    Probation: "Thử việc",
    Official: "Chính thức",
    "Temporarily Suspended": "Tạm nghỉ",
    Resigned: "Đã nghỉ việc",
    Terminated: "Chấm dứt",
    Onboarding: "Đang onboarding",
  },
};
