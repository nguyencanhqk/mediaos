// harness/spec-file-re.mjs — MỘT định nghĩa duy nhất cho "file này có phải spec không".
//
// TÁCH RA KHỎI `chunk-test.mjs` để test được TẤT ĐỊNH (`harness/spec-file-re.test.mjs`, chạy ở step
// `tooling-tests` của check.sh + CI) — cùng lý do đã tách `chunk-bisect.mjs`: `chunk-test.mjs` gọi
// `main()` ở top-level nên `import` nó là CHẠY nó ([[script-with-toplevel-main-runs-on-import]]).
//
// ─── VÌ SAO FILE NÀY TỒN TẠI (sự cố 03–04/09/2026) ─────────────────────────────────────────────
// Bản cũ nằm trong `chunk-test.mjs` và thiếu MỘT nhánh:
//
//     /\.(spec|e2e-spec|int-spec)\.(ts|tsx)$/     ← KHÔNG khớp `*.unit-spec.ts`
//
// (`.unit-spec.ts` không khớp `\.spec\.` vì ký tự ngay trước `spec` là `-`, không phải `.`.)
//
// Hậu quả đo được: `apps/api` có 651 file spec, chunk runner chạy 631 — thiếu ĐÚNG 20, là toàn bộ
// họ `*.unit-spec.ts`. `check.sh` trên Windows vì thế XANH mà chưa từng chạy 20 spec đó; chỉ CI
// (chạy `pnpm test` thẳng) mới thấy chúng. Một WO của S18 đã đi tới tận PR với cổng an ninh ĐỎ mà
// gate cục bộ báo "XANH 631/631".
//
// ⚠️ Tệ hơn: lưới an toàn `listUncollected()` của chính runner — cái sinh ra để bắt "file mang tên
// spec nhưng không được thu thập" — dùng CÙNG regex này, nên nó cũng lọc mất 20 file đó và không
// thể báo thiếu. Cổng tự-kiểm mù đúng thứ nó sinh ra để bắt.
//
// ⚠️ Và họ `*.unit-spec.ts` KHÔNG phải nhóm phụ: đó là quy ước dành cho spec TĨNH (census/ratchet
// của `apps/api/test/foundation/**`) — chọn tên đó CHÍNH VÌ chúng phải chạy ở mọi lần `pnpm test`
// kể cả khi không có `LANE_DB`. Nhóm được thiết kế để luôn chạy lại là nhóm runner không bao giờ chạy.
//
// LUẬT khi thêm hậu tố mới: sửa Ở ĐÂY, và thêm ca vào `spec-file-re.test.mjs`. Đừng nhân bản regex
// sang file khác — hai bản sao lệch nhau là cách sự cố này quay lại.

/**
 * Hậu tố của file spec, KHÔNG kèm `.spec`. Rỗng = `*.spec.ts` trần.
 *
 * Nguồn sự thật: `include` trong các `vitest.config.ts` của apps + packages. Ca
 * `assert` trong `spec-file-re.test.mjs` đối chiếu danh sách này với hiện trạng cây repo, nên thêm
 * họ mới trên đĩa mà quên khai ở đây sẽ ĐỎ chứ không im lặng bị bỏ chạy.
 */
export const SPEC_SUFFIXES = ["", "unit-", "int-", "e2e-"];

/** `<gì đó>.[unit-|int-|e2e-]spec.ts|tsx`. */
export const SPEC_FILE_RE = /\.(?:unit-|int-|e2e-)?spec\.(?:ts|tsx)$/;

/** Tiện dụng cho chỗ gọi: `isSpecFile('a/b.unit-spec.ts') === true`. */
export function isSpecFile(p) {
  return SPEC_FILE_RE.test(p);
}
