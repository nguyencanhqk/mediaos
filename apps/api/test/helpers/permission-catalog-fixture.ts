/**
 * S14-SEC-CATALOGSNAP-HARDEN-1 — hàng canh cho stub `IPermissionRepository.getAllPermissions()`.
 *
 * ## Vì sao tồn tại
 *
 * ADR `DECISIONS-12` **D9**: `permissions` là catalog GLOBAL do migration seed, nên `rows.length === 0`
 * là một phát biểu **HẠ TẦNG** («DB chưa seed / vừa bị xoá»), KHÔNG phải phát biểu nghiệp vụ («hệ này
 * không có cặp nhạy cảm nào»). Từ D9, `PermissionCatalogSnapshot` coi catalog RỖNG là trạng thái **SUY
 * BIẾN** và siết (mọi cặp = sensitive) thay vì nới.
 *
 * Hệ quả cho test: một stub trả `[]` giờ **nói dối** — nó tuyên bố «hạ tầng hỏng» trong khi ý định thật
 * chỉ là «spec này không quan tâm tới catalog». Bảy stub như vậy sẽ kéo cả bảy spec vào nhánh suy biến
 * vì một lý do sai.
 *
 * ## Vì sao MỘT hằng dùng chung, không phải bảy hàng tự chế
 *
 * Hàng canh phải là một cặp mà **không spec nào truy vấn**. Bảy file tự chế bảy hàng canh là bảy cơ hội
 * để một hàng vô tình **trùng cặp** mà chính spec đó đang kiểm — và khi trùng thì kết quả đổi **âm
 * thầm**, không ai đọc ra được từ diff.
 *
 * ## Vì sao để cặp thật VẮNG là đúng, không phải hạ sàn
 *
 * ADR **D3**: ảnh chụp đã nạp **và KHÔNG RỖNG** mà cặp VẮNG ⇒ `false`. Các spec dùng hàng canh này
 * không đo sensitivity; chúng đo cơ chế grant/scope. Để cặp của chúng VẮNG khỏi catalog cho ra đúng
 * `false` — tức **y hệt hành vi trước D9** — mà vẫn đi qua ngữ nghĩa D3 thật, không phải qua một lối
 * thoát. Thuộc tính «wildcard không mở được cặp sensitive» có canh gác riêng, trên catalog THẬT, ở
 * `permission.decide.pair-sensitive.spec.ts` và `test/integration/dash-wildcard-sensitive-gate.int-spec.ts`.
 *
 * ⚠️ **KHÔNG** thêm cặp vào đây để «cho đầy đủ». Chỉ thêm một cặp khi kết quả của một ca **phụ thuộc
 * cờ của chính cặp đó** — và khi ấy hãy thêm nó tại spec đó, không phải vào hằng dùng chung này.
 */
import type { PermissionCatalogEntry } from "../../src/permission/permission.types";

/**
 * Catalog tối thiểu KHÔNG RỖNG. Cặp được đặt tên để không thể va vào cặp thật nào (`__`… không phải
 * hình dạng động từ/tài nguyên hợp lệ theo DECISIONS-06), và `isSensitive: false` để nó không đóng góp
 * gì vào tập cặp nhạy cảm — `Set` kết quả vẫn RỖNG, nhưng `rows.length === 1` nên KHÔNG suy biến.
 *
 * Chính chỗ đó là giả định chịu lực: vị ngữ của D9 là `rows.length`, TUYỆT ĐỐI không phải `next.size`.
 * Có ca ghim ở `permission-catalog-snapshot.spec.ts`.
 */
export const CATALOG_SENTINEL_ROW: PermissionCatalogEntry = {
  id: "00000000-0000-4000-8000-0000000000ca",
  action: "__catalog-sentinel__",
  resourceType: "__catalog-sentinel__",
  isSensitive: false,
};

/** Catalog stub KHÔNG RỖNG dùng chung. Trả bản sao để một spec không sửa được mảng của spec khác. */
export function sentinelCatalog(): PermissionCatalogEntry[] {
  return [{ ...CATALOG_SENTINEL_ROW }];
}
