/**
 * S19-OPS-STORAGEPUBLIC-1 (plan v2 D2) — hành vi ĐO ĐƯỢC của từng nhà cung cấp object storage mà int-spec
 * phải ghim, chọn theo `S3_ENDPOINT` của lượt chạy.
 *
 * Hàm THUẦN: chỉ đọc chuỗi truyền vào, không I/O, không ném.
 *
 * VÌ SAO CÓ FILE NÀY
 * PROD chuyển sang Cloudflare R2 trong khi dev · CI · lane vẫn chạy storage tự host. Cùng một int-spec chạy
 * được trên cả hai (CI và lane: storage tự host; `scripts/storage-r2-compat.sh`: bucket R2 thử), nên chỗ
 * nào hai bên KHÁC nhau theo số đo thì ca phải hỏi helper này thay vì ghim cứng một phía.
 *
 * Nhận diện R2 bằng quy tắc DƯƠNG trên hostname đã phân tích (không `includes`, không so tiền tố/hậu tố
 * của chuỗi thô): `https` + `<32 hex chữ thường>[.eu|.fedramp].r2.cloudflarestorage.com`. Mọi thứ khác —
 * kể cả chuỗi không phải URL — được coi là storage tự host; nếu đoán sai, ca ghim sẽ ĐỎ (không xanh giả).
 */

const R2_HOSTNAME_RE = /^[0-9a-f]{32}(\.(eu|fedramp))?\.r2\.cloudflarestorage\.com$/;

export function isR2Endpoint(endpoint: string | undefined): boolean {
  if (!endpoint || !URL.canParse(endpoint)) return false;
  const url = new URL(endpoint);
  return url.protocol === "https:" && R2_HOSTNAME_RE.test(url.hostname);
}

/**
 * Giá trị header `x-content-type-options` mà GET theo URL ký PHẢI mang:
 * - storage tự host — ĐO 08/10/2026: `nosniff`;
 * - R2 — ĐO 14/10/2026: KHÔNG có header (owner chấp nhận, plan S19-OPS-STORAGEPUBLIC-1 B11).
 */
export function expectedNoSniff(endpoint: string | undefined): "nosniff" | null {
  return isR2Endpoint(endpoint) ? null : "nosniff";
}
