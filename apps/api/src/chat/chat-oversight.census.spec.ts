import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S7-CHAT-BE-7 🔒 — CENSUS TĨNH cho ĐƯỜNG ĐỌC-VƯỢT MEMBERSHIP (CHAT-DEC-004 · API-13 §5.3).
 *
 * ┌─ VÌ SAO KIỂM BẰNG NGUỒN CHỨ KHÔNG CHỈ BẰNG "GỌI API RỒI NHÌN KẾT QUẢ" ────────────────────────────┐
 * │ Bốn trong tám ràng buộc của API-13 §5.3 là **ràng buộc về HÌNH DẠNG MÃ NGUỒN**, không phải về hành │
 * │ vi quan sát được ở một fixture:                                                                     │
 * │   • "đường đọc thường gọi `assertMember` VÔ ĐIỀU KIỆN" — một cờ bỏ-qua thêm vào sau vẫn cho fixture │
 * │     hiện tại chạy y hệt, vì không ca nào truyền cờ đó;                                              │
 * │   • "018c KHÔNG tái dùng truy vấn có JOIN `chat_room_members`" — tái dùng thì kết quả RỖNG, và một  │
 * │     ca test viết lỏng ("không thấy tin của phòng lạ") vẫn XANH trên chính lỗi đó;                    │
 * │   • "DTO oversight KHÔNG kèm URL ký" — thêm `url` vào schema là một dòng, và nó chỉ lộ ra khi có    │
 * │     đúng ca test đọc payload của một tin CÓ tệp;                                                     │
 * │   • "resolver tệp mù với cặp `chat-oversight`" — thêm cặp vào resolver đẻ ra đường tải qua route     │
 * │     FOUNDATION, KHÔNG dòng audit CHAT nào, và không endpoint CHAT nào đổi hành vi.                   │
 * │ Census đọc NGUỒN thì ĐỎ ngay lúc vế biến mất, không phụ thuộc dữ liệu fixture.                       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

function codeOf(relative: string): string {
  return readFileSync(join(__dirname, relative), "utf8");
}

/**
 * Nguồn ĐÃ GỠ chú thích — dùng cho mọi assert dạng "KHÔNG được chứa X".
 *
 * ⚠️ Thiếu bước này thì census bắt trúng chính lời giải thích của mình: các file của WO này nhắc chuỗi
 * `chat-oversight` và `visible_from_seq` hàng chục lần trong jsdoc để giải thích VÌ SAO chúng không được
 * xuất hiện trong mã. Ca test sẽ đỏ, và cách sửa rẻ nhất lúc đó là **xoá comment** — đánh đổi tài liệu
 * tại chỗ lấy một ca xanh (memory `guard-immutability-matches-comments`). Mirror `chat-search.sql.spec.ts`.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function executableCodeOf(relative: string): string {
  return stripComments(codeOf(relative));
}

/**
 * Khối `S7-CHAT-BE-7` của `packages/contracts/src/chat.ts` (từ điểm neo tới hết file), ĐÃ GỠ chú thích.
 *
 * ⚠️ Bước gỡ chú thích ở đây là BẮT BUỘC chứ không phải cho đồng bộ: khối contracts của WO này nhắc
 * `chatAttachmentSchema` và `thumbnailUrl` ngay trong lời giải thích "vì sao KHÔNG tái dùng chúng". Assert
 * trên nguồn nguyên bản sẽ đỏ vì chính tài liệu của mình — đo bằng lượt chạy đầu tiên, không phải lo xa.
 */
function oversightContractsBlock(): string {
  const full = readFileSync(
    join(__dirname, "..", "..", "..", "..", "packages", "contracts", "src", "chat.ts"),
    "utf8",
  );
  const at = full.indexOf("S7-CHAT-BE-7");
  expect(at, "không tìm thấy khối S7-CHAT-BE-7 trong contracts/src/chat.ts").toBeGreaterThan(0);
  return stripComments(full.slice(at));
}

describe("S7-CHAT-BE-7 §1 — đường đọc THƯỜNG giữ nguyên tính chất 'assertMember vô điều kiện'", () => {
  const accessCode = executableCodeOf("chat-access.service.ts");

  it("`ChatAccessService` KHÔNG có một chữ `oversight` nào trong mã thực thi", () => {
    // API-13 §5.3 ràng buộc 1. Nhét `if (isOversight)` vào đây là mất VĨNH VIỄN tính chất "đọc code là
    // chứng minh được" của toàn bộ đường đọc thường — từ đó về sau không ai đọc hàm này mà biết chắc nó chặn.
    expect(accessCode.toLowerCase()).not.toContain("oversight");
  });

  it("`assertMember` giữ ĐÚNG 4 tham số — không có cờ/tuỳ chọn bỏ qua membership", () => {
    const signature = /async assertMember\(([\s\S]*?)\)\s*:\s*Promise/.exec(accessCode);
    expect(signature, "không parse được chữ ký assertMember").not.toBeNull();
    const params = (signature?.[1] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    expect(params.map((p) => p.split(":")[0]?.trim())).toEqual([
      "tx",
      "companyId",
      "roomId",
      "actorUserId",
    ]);
  });

  it("`assertMessageAccess` cũng giữ ĐÚNG 4 tham số (trục TIN NHẮN, cùng luật)", () => {
    const signature = /async assertMessageAccess\(([\s\S]*?)\)\s*:\s*Promise/.exec(accessCode);
    expect(signature).not.toBeNull();
    const params = (signature?.[1] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    expect(params).toHaveLength(4);
  });
});

describe("S7-CHAT-BE-7 §7 — oversight KHÔNG cấp quyền tải tệp", () => {
  it("`ChatMessageFileResolver` mù với cặp `chat-oversight`", () => {
    // Thêm cặp vào resolver đẻ ra đường tải đi qua route FOUNDATION Files — KHÔNG dòng audit CHAT nào,
    // và không endpoint CHAT nào đổi hành vi ⇒ không int-spec nào bắt được.
    expect(executableCodeOf("chat-message-file.resolver.ts")).not.toContain("chat-oversight");
  });

  it("resolver VẪN hỏi đúng cặp `view:chat-room` (đối chứng dương — ca trên không đúng vì file rỗng)", () => {
    const code = executableCodeOf("chat-message-file.resolver.ts");
    expect(code).toContain('action: "view"');
    expect(code).toContain('resourceType: "chat-room"');
  });

  it("mapper oversight KHÔNG phơi URL ký / storagePath / linkId", () => {
    const mapper = executableCodeOf("chat-oversight.mapper.ts");
    for (const forbidden of ["url", "thumbnailUrl", "storagePath", "signedUrl"]) {
      expect(mapper, `mapper oversight phơi trường ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("khối contracts oversight KHÔNG có khoá URL và KHÔNG tái dùng `chatAttachmentSchema`", () => {
    const block = oversightContractsBlock();
    // `.omit()` là hợp đồng NGƯỢC: mọi trường URL thêm vào schema gốc về sau sẽ tự chảy vào payload
    // oversight, im lặng, đúng lúc không ai review lại WO này nữa.
    expect(block).not.toContain("chatAttachmentSchema");
    expect(block).not.toContain("chatMessageSchema");
    expect(block).not.toContain("thumbnailUrl");
    expect(block).not.toMatch(/^\s*url:/m);
    // Đối chứng dương: khối PHẢI khai schema đính kèm RIÊNG của mình — không có ca này thì bốn assert
    // trên "đúng" ngay cả khi khối oversight bị xoá sạch khỏi contracts.
    expect(block).toContain("chatOversightAttachmentSchema = z.object(");
    expect(block).toContain("sizeBytes:");
  });

  it("service oversight KHÔNG gọi dịch vụ ký URL", () => {
    const service = executableCodeOf("chat-oversight.service.ts");
    expect(service).not.toContain("ChatAttachmentPresignService");
    expect(service).not.toContain("presign");
  });
});

describe("S7-CHAT-BE-7 §8 — 018c đọc TOÀN DẢI seq, không mượn vị từ membership", () => {
  const repo = executableCodeOf("chat-oversight.repository.ts");

  it("repo oversight KHÔNG mượn vị từ `visible_from_seq` (SPEC-15 §13.4)", () => {
    // Người đọc-vượt KHÔNG có hàng `chat_room_members` ⇒ mượn vị từ đó trả về RỖNG trên mọi phòng:
    // hỏng lặng lẽ theo chiều ngược lại, nhìn giống "phòng không có tin" chứ không giống lỗi quyền.
    for (const forbidden of [
      "visibleFromSeq",
      "visible_from_seq",
      "chat-visibility",
      "messageReadConditions",
      "assertMember",
    ]) {
      expect(repo, `repo oversight mượn vế của đường đọc thường: ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  it("nhưng VẪN đọc `chat_room_members` cho danh sách thành viên (đối chứng dương)", () => {
    // Không có ca này thì ca trên "đúng vì file rỗng" — nó phải phân biệt được "không mượn vị từ actor"
    // với "không đụng bảng membership".
    expect(repo).toContain("chatRoomMembers");
    expect(repo).toContain("listActiveMembers");
  });

  it("`019` bó CẢ `action` LẪN `module_code`", () => {
    // Bỏ một vế = biến MỘT cặp quyền CHAT thành cổng đọc `audit_logs` TOÀN HỆ THỐNG.
    expect(repo).toContain("eq(auditLogs.action, CHAT_AUDIT.OVERSIGHT_READ)");
    expect(repo).toContain("eq(auditLogs.moduleCode, CHAT_MODULE_CODE)");
  });

  it("`company_id` tường minh trên MỌI truy vấn của repo (đếm, không chỉ 'có')", () => {
    const hits = repo.match(/companyId, companyId\)|companyId, auditLogs\.companyId\)/g) ?? [];
    // 5 hàm đọc × ít nhất 1 vế tenant. RLS đã ép, nhưng đây là đường đọc bỏ qua ranh giới dữ liệu của
    // module nên vế tenant là thứ CUỐI CÙNG còn lại (CLAUDE.md §2 mục 1).
    expect(hits.length).toBeGreaterThanOrEqual(5);
  });

  it("repo oversight CHỈ ĐỌC — không INSERT/UPDATE/DELETE", () => {
    for (const forbidden of ["tx.insert(", "tx.update(", "tx.delete("]) {
      expect(repo, `repo oversight có đường GHI: ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("S7-CHAT-BE-7 §4/§5/§6 — bề mặt chỉ-đọc, không tìm kiếm, không WS", () => {
  const controller = executableCodeOf("chat-oversight.controller.ts");

  it("KHÔNG có route GHI nào dưới `/chat/oversight/`", () => {
    for (const verb of ["@Post(", "@Patch(", "@Put(", "@Delete("]) {
      expect(controller, `controller oversight khai route ghi ${verb}`).not.toContain(verb);
    }
    expect((controller.match(/@Get\(/g) ?? []).length, "đúng 4 route GET").toBe(4);
  });

  it("KHÔNG có `/chat/oversight/search` (ràng buộc thiết kế, không phải thiếu sót)", () => {
    expect(controller).not.toContain('oversight/search"');
    expect(executableCodeOf("chat-oversight.service.ts")).not.toContain("searchMessages");
  });

  it("KHÔNG emit WS ở đường đọc-vượt", () => {
    const service = executableCodeOf("chat-oversight.service.ts");
    for (const forbidden of ["RealtimeEmitter", "emit(", "chatroom:"]) {
      expect(service, `service oversight chạm realtime: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("cả 4 route khai `@RequirePermission` + CẢ HAI guard đúng thứ tự (soi NGUỒN, đai thứ hai)", () => {
    // Đai runtime ở `chat-oversight.permissions.spec.ts`; đai nguồn ở đây bắt được cả trường hợp ai đó
    // thêm route thứ 5 mà quên copy hai decorator.
    const requires = controller.match(/@RequirePermission\("view", "chat-oversight"/g) ?? [];
    const guards =
      controller.match(/@UseGuards\(ChatOversightAuditGuard, PermissionGuard\)/g) ?? [];
    expect(requires).toHaveLength(4);
    expect(guards).toHaveLength(4);
    expect(controller).not.toContain("@UseGuards(PermissionGuard, ChatOversightAuditGuard)");
  });
});

describe("S7-CHAT-BE-7 §2 — đường đọc-vượt không rò ra ngoài module", () => {
  it("`ChatOversightRepository` chỉ được import bởi service + module (không lọt sang nơi khác)", () => {
    // Repo này KHÔNG có vị từ membership. Nó lọt vào một service khác là một đường đọc toàn tenant
    // KHÔNG DẤU VẾT — vì mọi dòng audit chỉ được ghi bởi `ChatOversightService`.
    const importers = ["chat-oversight.service.ts", "chat.module.ts"];
    const forbidden = [
      "chat-rooms.service.ts",
      "chat-messages.service.ts",
      "chat-search.service.ts",
      "chat-members.service.ts",
      "chat-message-file.resolver.ts",
      "chat-derived-rooms-sync.service.ts",
    ];
    for (const f of importers) {
      expect(codeOf(f), `${f} phải import ChatOversightRepository`).toContain(
        "ChatOversightRepository",
      );
    }
    for (const f of forbidden) {
      expect(executableCodeOf(f), `${f} import repo đọc-vượt`).not.toContain(
        "ChatOversightRepository",
      );
    }
  });

  it("`ChatModule` KHÔNG export service/repo đọc-vượt", () => {
    const mod = codeOf("chat.module.ts");
    const exportsBlock = /exports:\s*\[([\s\S]*?)\]/.exec(mod)?.[1] ?? "";
    expect(exportsBlock).not.toContain("ChatOversight");
  });

  it("controller đọc-vượt KHÔNG nằm trong `CHAT_CONTROLLERS` của suite gate đường thường", () => {
    // `chat.permissions.spec.ts:219` khẳng định "0 controller ở đó dùng `chat-oversight`". Thêm
    // controller này vào hằng đó sẽ làm ca ấy đỏ — đúng như thiết kế (jsdoc `:71` đã dặn trước).
    const spec = codeOf("chat.permissions.spec.ts");
    const list = /const CHAT_CONTROLLERS = \[([\s\S]*?)\]/.exec(spec)?.[1] ?? "";
    expect(list).not.toContain("ChatOversight");
  });
});
