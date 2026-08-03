import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S7-CHAT-BE-GATE-3 (L2 HIGH) — census TĨNH cho bất biến "thu hồi phiên ⇒ CẮT phiên WS".
 *
 * Vì sao census nguồn chứ không phải test hành vi: đây là bất biến về **cấu trúc điểm gọi**, không phải
 * về đầu ra của một hàm. Hành vi của `severUserSessions` đã có test riêng ở
 * `realtime/realtime-emitter.chat.spec.ts`; cái dễ vỡ về sau là có người thêm đường thu hồi phiên THỨ HAI
 * mà quên cắt socket — và một test hành vi trên đường CŨ sẽ vẫn xanh trong khi lỗ mở ở đường MỚI. Đó
 * đúng bài học "bất biến phải kèm DANH SÁCH WRITER và chốt ở method dùng chung".
 *
 * Nền: cổng quyền WS chỉ chạy lúc handshake; socket đang mở không bao giờ tự biết phiên đã bị thu hồi.
 * Access token stateless hết hạn ~15 phút chỉ chặn lần RECONNECT, nên tab mở liên tục giữ phiên sống
 * nhiều ngày (SPEC-15 §18 đòi "cắt phiên WS đang mở").
 */
const readSrc = (relative: string) => readFileSync(join(__dirname, relative), "utf8");

/** Bỏ chú thích để census không khớp nhầm chữ trong comment (memory: guard-immutability-matches-comments). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("S7-CHAT-BE-GATE-3 — thu hồi phiên PHẢI cắt luôn phiên WS", () => {
  const code = stripComments(readSrc("./auth.service.ts"));

  it("chốt cắt socket nằm TRONG revokeAllSessionsForUserTx (điểm gọi dùng chung)", () => {
    const body = code.slice(
      code.indexOf("private async revokeAllSessionsForUserTx"),
      code.indexOf("async revokeAllForUserTx"),
    );
    expect(body, "không tìm thấy thân revokeAllSessionsForUserTx").not.toBe("");
    expect(body).toContain("severUserSessions(companyId, userId)");
  });

  it("MỌI điểm gọi đều truyền companyId — thiếu là cắt nhầm tenant hoặc không cắt được", () => {
    const calls = code.match(/revokeAllSessionsForUserTx\([^)]*\)/g) ?? [];
    // 1 định nghĩa + 7 điểm gọi; con số cụ thể không quan trọng bằng việc KHÔNG có lời gọi 3 tham số.
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const call of calls) {
      if (call.startsWith("revokeAllSessionsForUserTx(tx,")) {
        const args = call.slice(call.indexOf("(") + 1, -1).split(",");
        expect(args.length, `điểm gọi thiếu companyId: ${call}`).toBe(4);
      }
    }
  });

  /**
   * Chính census này đã bắt ra HAI lỗ mà review thủ công bỏ sót: `self_revoke` và `self_revoke_others`
   * thu hồi phiên ở DB nhưng KHÔNG cắt socket — thiết bị vừa bị "đăng xuất từ xa" vẫn nhận tin nhắn
   * realtime. Giữ ca này ở dạng liệt kê-toàn-bộ-writer chứ không đếm số: đếm số sẽ xanh trở lại ngay khi
   * ai đó thêm writer thứ tư rồi sửa con số cho khớp.
   */
  it("MỌI đường thu hồi user_sessions đều cắt socket — trừ 'rotated' (không phải thu hồi bảo mật)", () => {
    const writes = [
      ...code.matchAll(/\.update\(userSessions\)([\s\S]{0,600}?)(?=\n\s*(?:await|return|\}))/g),
    ];
    expect(
      writes.length,
      "không tìm thấy writer nào — census hỏng, không phải code sạch",
    ).toBeGreaterThanOrEqual(4);

    for (const [block] of writes) {
      if (!block.includes("revokedAt")) continue; // không phải đường thu hồi
      if (block.includes('revokedReason: "rotated"')) {
        // Xoay vòng phiên lúc refresh: user VẪN đang hoạt động và nhận phiên mới ngay trong cùng
        // request. Cắt socket ở đây là tự ngắt kết nối người đang dùng bình thường mỗi ~15 phút.
        expect(block, "nhánh 'rotated' KHÔNG được cắt socket").not.toContain("severUserSessions");
        continue;
      }
      expect(
        block,
        `đường thu hồi phiên thiếu severUserSessions — phiên WS sẽ sống sót:\n${block.slice(0, 220)}`,
      ).toContain("severUserSessions");
    }
  });
});
