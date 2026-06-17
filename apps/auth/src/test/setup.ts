import "@testing-library/jest-dom/vitest";
// Khởi tạo i18n dùng chung của @mediaos/web-core (đồng bộ, namespace common/nav/auth nhúng sẵn) để `t()` trả
// đúng chuỗi vi trong test — apps/auth chỉ dùng namespace `auth`/`common`, không khai feature namespace riêng.
import "@mediaos/web-core";
