import { describe, expect, it } from "vitest";
import {
  REVEAL_CLASS_PAIRS,
  REVEAL_CLASS_PAIRS_TOKEN,
  isRevealClassPair,
  revealClassPairsProvider,
} from "./reveal-class-pairs";

/**
 * S10-AUTH-STEPUP-1 · D3 (DECISIONS-09 §6 điểm 4) — registry cặp "reveal-secret" khởi tạo RỖNG.
 *
 * Cổng này không phải thủ tục: chừng nào registry còn rỗng thì `POST /auth/step-up` KHÔNG mint được
 * cửa sổ nào, nên không route sản phẩm nào được phép khai `requiresReauth` (đó chính là bẫy KI-065 —
 * cờ khai xong thì route 403 VĨNH VIỄN, im lặng). Thêm một cặp vào đây là QUYẾT ĐỊNH BẢO MẬT phải qua
 * ba điều kiện của §6 điểm (5), không phải thao tác "vá cho chạy".
 */
describe("REVEAL_CLASS_PAIRS — D3: registry RỖNG, MỘT nguồn cho cả endpoint lẫn cổng test", () => {
  it("RỖNG (length === 0) — PROD hôm nay không cặp nào mintable", () => {
    expect(REVEAL_CLASS_PAIRS.length).toBe(0);
  });

  it("DEFAULT của DI token là CHÍNH const đó — so bằng IDENTITY, không deep-equal", () => {
    expect(revealClassPairsProvider.provide).toBe(REVEAL_CLASS_PAIRS_TOKEN);
    // Identity: `useValue` PHẢI là chính đối tượng, không phải một bản sao rỗng.
    expect(revealClassPairsProvider.useValue).toBe(REVEAL_CLASS_PAIRS);
    // Ca thử-ngược cho chính phép đo: một mảng rỗng KHÁC deep-equal được với const nhưng KHÔNG identity.
    // Nếu ai đó hạ assert trên xuống `toEqual`, ca này chứng minh phép đo đã mất răng.
    expect([]).toEqual(REVEAL_CLASS_PAIRS);
    expect(Object.is([], REVEAL_CLASS_PAIRS)).toBe(false);
  });

  it("registry TIÊM có cặp ⇒ khớp ĐÚNG cả hai vế (ca ALLOW đối chứng — đo nhánh true có tồn tại)", () => {
    const injected = [{ action: "read", resourceType: "employee_salary" }] as const;
    expect(isRevealClassPair(injected, "read", "employee_salary")).toBe(true);
    // Lệch ĐÚNG MỘT vế mỗi lần: nếu hàm chỉ so `action` (hoặc chỉ `resourceType`) thì một trong hai đỏ.
    expect(isRevealClassPair(injected, "export", "employee_salary")).toBe(false);
    expect(isRevealClassPair(injected, "read", "employee_profile")).toBe(false);
  });

  it("registry RỖNG ⇒ mọi cặp đều false (không có đường 'mặc định cho qua')", () => {
    expect(isRevealClassPair(REVEAL_CLASS_PAIRS, "read", "employee_salary")).toBe(false);
    expect(isRevealClassPair(REVEAL_CLASS_PAIRS, "*", "*")).toBe(false);
  });
});
