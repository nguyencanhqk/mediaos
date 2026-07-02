/**
 * Namespace "account" (vi) — màn hình self-service tài khoản (/account/*).
 * S2-FE-AUTH-5 (lane FE batch C) — /account/sessions (list + revoke phiên đăng nhập của chính user).
 * KHÔNG hard-code chuỗi tiếng Việt rải rác trong component — tất cả qua t("account.*").
 */
export default {
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
