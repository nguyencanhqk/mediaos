import "@testing-library/jest-dom/vitest";
// Khởi tạo i18n (đồng bộ, resources vi nhúng sẵn ở @mediaos/web-core) để `t()` trả đúng
// chuỗi vi trong test — component dùng useTranslation render giống hệt runtime.
import "@/i18n";
