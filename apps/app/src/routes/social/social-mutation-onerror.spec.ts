import { describe, expect, it } from "vitest";

/**
 * S20-FE-TOAST-2 — rào cho «ghi hỏng im lặng» ở SOCIAL.
 *
 * Kiểm kê 06/11/2026: 28 chỗ khai mutation ở `routes/social` ĐỀU có `onError` hiện lỗi TẠI CHỖ (dải
 * `ActionErrorBanner` · ô lỗi trong hộp thoại · thông báo của tab) ⇒ không chỗ nào cần chuyển sang toast,
 * và thêm toast sẽ báo HAI lần. Ca này giữ bất biến đó cho mutation viết sau: tệp nào khai `mutationFn:`
 * thì phải có ít nhất bằng ngần ấy `onError:` — nếu không muốn tự vẽ lỗi, dùng `showApiErrorToast`.
 */
const SOURCES = import.meta.glob<string>(["./**/*.{ts,tsx}", "!./**/*.spec.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const MUTATION_FN = /\bmutationFn\s*:/g;
const ON_ERROR = /\bonError\s*:/g;
/** Số chỗ khai mutation đo ngày 06/11/2026 (không tính chính định nghĩa `useGuardedMutation`). */
const MIN_MUTATION_SITES = 28;
const GUARDED_HOOK_FILE = "./admin/lib/use-guarded-mutation.ts";

function count(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("SOCIAL — mọi mutation có đường hiện lỗi (S20-FE-TOAST-2)", () => {
  const files = Object.entries(SOURCES).filter(([, source]) => count(source, MUTATION_FN) > 0);

  it("kiểm kê đọc được mã nguồn (chống xanh rỗng khi glob trượt)", () => {
    const sites = files
      .filter(([path]) => path !== GUARDED_HOOK_FILE)
      .reduce((sum, [, source]) => sum + count(source, MUTATION_FN), 0);
    expect(sites).toBeGreaterThanOrEqual(MIN_MUTATION_SITES);
  });

  it("tệp nào khai mutationFn cũng có đủ onError tương ứng", () => {
    const missing = files
      .filter(([, source]) => count(source, ON_ERROR) < count(source, MUTATION_FN))
      .map(([path]) => path);
    expect(missing).toEqual([]);
  });
});
