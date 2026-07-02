/**
 * Namespace "account" (vi) — màn hình self-service tài khoản (/account/*).
 * S2-FE-AUTH-5 (lane FE batch C) — /account/sessions (list + revoke phiên đăng nhập của chính user).
 * S2-FE-AUTH-6 — /account/setup-2fa (ép enroll 2FA, AUTH-003) + /account/profile (đọc, từ /auth/me).
 * KHÔNG hard-code chuỗi tiếng Việt rải rác trong component — tất cả qua t("account.*").
 */
export default {
  setup2fa: {
    title: "Thiết lập xác thực 2 lớp",
    description: "Vai trò của bạn yêu cầu bật xác thực 2 lớp (2FA) trước khi tiếp tục.",
    requiredNote: "Bạn cần hoàn tất bước này để vào hệ thống — không thể bỏ qua.",
    loading: "Đang khởi tạo mã QR…",
    loadFailed: "Không thể khởi tạo mã QR thiết lập 2FA. Vui lòng thử lại.",
    verifying: "Đang xác nhận…",
    recoveryCodesHint: "Lưu lại các mã này ở nơi an toàn — chỉ hiển thị MỘT LẦN duy nhất.",
  },
  profile: {
    title: "Tài khoản của tôi",
    description: "Thông tin tài khoản của bạn.",
    loading: "Đang tải thông tin tài khoản…",
    error: {
      title: "Không thể tải thông tin tài khoản",
      description: "Có lỗi khi tải thông tin tài khoản. Vui lòng thử lại.",
    },
    sections: {
      account: "Tài khoản",
      employee: "Hồ sơ nhân sự",
      roles: "Vai trò",
    },
    fields: {
      email: "Email",
      fullName: "Họ tên",
      status: "Trạng thái",
      employeeCode: "Mã nhân viên",
      employmentStatus: "Trạng thái làm việc",
      company: "Công ty",
    },
    noEmployee: "Tài khoản chưa liên kết hồ sơ nhân sự.",
    noRoles: "Chưa được gán vai trò nào.",
    links: {
      changeRequest: "Đề nghị thay đổi hồ sơ",
      changePassword: "Đổi mật khẩu",
      sessions: "Phiên đăng nhập",
    },
  },
  sessions: {
    title: "Phiên đăng nhập",
    description: "Danh sách phiên đăng nhập của bạn trên các thiết bị — thu hồi nếu không nhận ra",
    currentBadge: "Phiên này",
    revoke: "Thu hồi",
    revoking: "Đang thu hồi…",
    revokeOthers: "Thu hồi mọi phiên khác",
    revokingOthers: "Đang thu hồi…",
    confirm: {
      revokeTitle: "Xác nhận thu hồi phiên",
      revokeDescription: "Thiết bị này sẽ bị đăng xuất ngay lập tức. Tiếp tục?",
      revokeOthersTitle: "Xác nhận thu hồi mọi phiên khác",
      revokeOthersDescription:
        "Mọi thiết bị khác (trừ thiết bị hiện tại) sẽ bị đăng xuất ngay lập tức. Tiếp tục?",
      confirmLabel: "Xác nhận",
      cancelLabel: "Huỷ",
    },
    revokeSuccess: "Đã thu hồi phiên đăng nhập.",
    revokeOthersSuccess: "Đã thu hồi {{count}} phiên khác.",
    columns: {
      device: "Thiết bị",
      platform: "Nền tảng",
      ipAddress: "Địa chỉ IP",
      lastUsedAt: "Hoạt động gần nhất",
      createdAt: "Đăng nhập lúc",
      actions: "Thao tác",
    },
    unknownDevice: "Không xác định",
    empty: {
      title: "Không có phiên đăng nhập",
      description: "Không tìm thấy phiên đăng nhập nào đang hoạt động.",
    },
    error: {
      title: "Không thể tải danh sách phiên",
      description: "Có lỗi khi tải danh sách phiên đăng nhập. Vui lòng thử lại.",
    },
    errors: {
      forbidden: "Bạn không có quyền thực hiện thao tác này.",
      notFound: "Phiên đăng nhập không tồn tại hoặc đã bị thu hồi.",
      server: "Có lỗi hệ thống. Vui lòng thử lại sau.",
      generic: "Thao tác thất bại. Vui lòng thử lại.",
    },
  },
};
