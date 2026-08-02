import { describe, expect, it } from "vitest";
import {
  SENSITIVE_SCREEN_GATE_PAIRS,
  __SENSITIVE_CAPABILITY_ALLOWLIST_FOR_TEST as ALLOWLIST,
} from "./permission.service";

/**
 * S6-LEAVE-CAPALLOW-1 — TEST KHOÁ cho một lớp lỗi đã lặp 8+ lần trong repo.
 *
 * Cơ chế gây lỗi: `getCapabilities()` lọc bỏ TOÀN BỘ cặp `is_sensitive`; chỉ cặp nằm trong
 * `SENSITIVE_CAPABILITY_ALLOWLIST` mới được `getAllowlistedSensitiveCapabilities()` trả lại cho FE.
 * Nên một màn quản trị gác bằng cặp nhạy cảm mà quên allowlist sẽ **biến mất với đúng vai được cấp
 * quyền** — không lỗi, không log, không test nào đỏ. Lần gần nhất (2026-08-02) nó giấu luôn màn Chính
 * sách nghỉ, tức đường DUY NHẤT bật engine cộng dồn phép ⇒ chặn go-live.
 *
 * ⚠️ Test này KHÔNG kiểm enforcement. Allowlist chỉ là CỜ HIỂN THỊ; cổng thật là
 * `can()`/`PermissionGuard` per-resource. Mở rộng allowlist KHÔNG nới quyền.
 */
describe("SENSITIVE_CAPABILITY_ALLOWLIST — cặp gác màn hình phải surface được cho FE", () => {
  it("chứa MỌI cặp trong SENSITIVE_SCREEN_GATE_PAIRS", () => {
    const missing = SENSITIVE_SCREEN_GATE_PAIRS.filter((pair) => !ALLOWLIST.has(pair));

    expect(
      missing,
      missing.length === 0
        ? ""
        : `Thiếu allowlist ⇒ /auth/me sẽ KHÔNG trả các cặp này ⇒ màn/nút tương ứng ẨN với chính vai ` +
            `ĐƯỢC CẤP quyền (im lặng, không lỗi): ${missing.join(", ")}. ` +
            `Thêm vào SENSITIVE_CAPABILITY_ALLOWLIST trong permission.service.ts (APPEND-only).`,
    ).toEqual([]);
  });

  it("không có cặp gác màn nào bị khai trùng", () => {
    const counts = new Map<string, number>();
    for (const pair of SENSITIVE_SCREEN_GATE_PAIRS) {
      counts.set(pair, (counts.get(pair) ?? 0) + 1);
    }
    const repeated = [...counts.entries()].filter(([, n]) => n > 1).map(([pair]) => pair);

    expect(
      repeated,
      `khai trùng trong SENSITIVE_SCREEN_GATE_PAIRS: ${repeated.join(", ")}`,
    ).toEqual([]);
  });

  it("mọi cặp gác màn đều có dạng 'action:resourceType' và KHÔNG dùng wildcard", () => {
    // Wildcard không bao giờ khớp allowlist (xem getAllowlistedSensitiveCapabilities): cặp nhạy cảm
    // KHÔNG kế thừa qua `*:*`. Khai wildcard ở đây là hiểu sai cơ chế ⇒ chặn ngay.
    const malformed = SENSITIVE_SCREEN_GATE_PAIRS.filter(
      (p) => !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(p),
    );

    expect(malformed, `sai định dạng hoặc dùng wildcard: ${malformed.join(", ")}`).toEqual([]);
  });
});
