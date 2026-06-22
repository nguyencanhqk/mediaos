import "@testing-library/jest-dom/vitest";
// Khởi tạo instance i18n dùng chung (resources vi nhúng sẵn) để component shared dùng
// useTranslation (vd DataTable empty/pagination) render đúng chuỗi vi trong test —
// tránh cảnh báo NO_I18NEXT_INSTANCE và phủ nhánh empty/loading có chữ.
import "@mediaos/web-core";
