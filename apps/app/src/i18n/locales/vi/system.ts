/**
 * Namespace "system" (vi) — màn hình quản trị hệ thống (S2-FE-HR-3).
 * KHÔNG hard-code chuỗi tiếng Việt rải rác trong component — tất cả qua t("system.*").
 */
export default {
  users: {
    title: "Người dùng",
    description: "Danh sách tài khoản người dùng trong hệ thống",
    sprint3Notice: "Chức năng quản lý đầy đủ sẽ có trong Sprint 3",
    columns: {
      email: "Email",
      fullName: "Họ tên",
      status: "Trạng thái",
      lastLogin: "Lần đăng nhập cuối",
    },
    status: {
      active: "Đang hoạt động",
      suspended: "Đã tạm khóa",
    },
    empty: {
      title: "Không có người dùng",
      description: "Chưa có tài khoản người dùng nào trong hệ thống.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách người dùng. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem danh sách người dùng.",
    },
  },
  roles: {
    title: "Vai trò",
    description: "Danh sách vai trò phân quyền trong hệ thống",
    sprint3Notice: "Quản lý quyền chi tiết theo vai trò sẽ có trong Sprint 3",
    columns: {
      name: "Tên vai trò",
      id: "ID",
    },
    empty: {
      title: "Không có vai trò",
      description: "Chưa có vai trò nào được định nghĩa.",
    },
    error: {
      title: "Không thể tải danh sách",
      description: "Có lỗi khi tải danh sách vai trò. Vui lòng thử lại.",
    },
    forbidden: {
      title: "Không có quyền truy cập",
      description: "Bạn không có quyền xem danh sách vai trò.",
    },
  },
};
