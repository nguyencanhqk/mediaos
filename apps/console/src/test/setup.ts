import "@testing-library/jest-dom/vitest";
// Khởi tạo i18n (đồng bộ, resources vi nhúng sẵn) để `t()` trả đúng chuỗi vi
// trong test — component dùng useTranslation render giống hệt literal cũ.
import "@/i18n";
