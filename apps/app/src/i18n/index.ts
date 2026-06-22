// App-level i18n — dùng lại instance dùng chung của @mediaos/web-core (đã init đồng bộ với
// 3 namespace `common`/`nav`/`auth`). apps/app CHƯA có namespace feature riêng nên chỉ
// re-export thẳng instance làm default; khi thêm màn nghiệp vụ (S1-FE-LAYOUT-1 trở đi) sẽ
// đăng ký namespace feature qua `registerI18nResources` + import.meta.glob giống apps/console.
//
// Lưu ý: web-core public index xuất i18n dạng NAMED `i18n` (export { default as i18n }),
// KHÔNG phải default của package → phải import named rồi re-default ở đây.
import { i18n } from "@mediaos/web-core";

export default i18n;
