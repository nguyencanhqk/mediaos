import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S19-HR-AVATARWRITE-1 (D-8) — ràng buộc CẤU TRÚC cho điểm ghi chung của cột `employee_profiles.avatar_url`.
 *
 * `HrWriteRepository.updateAvatarUrlTx` nhận chuỗi tuỳ ý — nó KHÔNG tự kiểm tệp. Bất biến «giá trị khác
 * NULL trong `avatar_url` chỉ là fileId có link `ME/avatar` đã xác minh» vì vậy dựa vào việc sink chỉ được
 * gọi từ hai đường đã kiểm tệp:
 *   - W1 `MeAvatarService` (`me/me-avatar.service.ts`) → `HrWriteService.updateOwnAvatar` → sink;
 *   - W2 `HrEmployeeAvatarService` (`employees/hr-employee-avatar.service.ts`) → sink trực tiếp.
 *
 * Thêm caller mới ⇒ ca đỏ. Người thêm phải chứng minh caller đã kiểm tệp (owner + image + link) TRƯỚC
 * khi sửa danh sách dưới đây. Khuôn đọc nguồn + bỏ comment: `social/social-avatar-sign-structure.spec.ts`.
 */

const SRC_ROOT = join(__dirname, "..");

/** Tệp được phép nhắc tới lời gọi (gồm cả tệp ĐỊNH NGHĨA hàm). Đường dẫn tương đối `apps/api/src`. */
const ALLOWED: Record<string, readonly string[]> = {
  updateAvatarUrlTx: [
    "employees/hr-write.repository.ts", // định nghĩa
    "employees/hr-write.service.ts", // updateOwnAvatar (W1)
    "employees/hr-employee-avatar.service.ts", // W2
  ],
  updateOwnAvatar: [
    "employees/hr-write.service.ts", // định nghĩa
    "me/me-avatar.service.ts", // W1
  ],
};

/** Bỏ comment — luật nói về CODE, không về văn xuôi (docblock nhắc tên hàm sẽ đỏ oan). */
const stripComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

function filesMentioning(fn: string): string[] {
  const pattern = new RegExp(`\\b${fn}\\s*\\(`);
  return walk(SRC_ROOT)
    .filter((full) => pattern.test(stripComments(readFileSync(full, "utf8"))))
    .map((full) => relative(SRC_ROOT, full).split(sep).join("/"))
    .sort();
}

describe("S19-HR-AVATARWRITE-1 D-8 — sink cột ảnh chỉ có caller W1/W2", () => {
  it.each(Object.keys(ALLOWED))("%s( chỉ xuất hiện ở các tệp đã kiểm tệp", (fn) => {
    const found = filesMentioning(fn);
    // Neo dương: quét thật sự thấy định nghĩa + caller (một đường dẫn sai làm `found` rỗng ⇒ xanh rỗng).
    expect(found.length).toBeGreaterThan(0);
    expect(found).toEqual([...(ALLOWED[fn] ?? [])].sort());
  });
});
