import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../db/db.service";
import type { PermissionService } from "../permission/permission.service";
import { FilePolicyAction, type FilePermissionInput } from "../foundation/files/file-policy.types";
import type { ChatAccessService } from "./chat-access.service";
import { CHAT_ROOM_AVATAR_ENTITY_TYPE } from "./chat-file.constants";
import { ChatRoomAvatarFileResolver } from "./chat-room-avatar-file.resolver";
import { CHAT_MODULE_CODE } from "./chat.errors";

/**
 * S8-CHAT-UX-QA-1 — `ChatRoomAvatarFileResolver` (nghiệm thu BE-2).
 *
 * ══ VÌ SAO SUITE NÀY MỞ MUỘN ══
 * Đo coverage 07/08 trên cụm S8 (lane `mediaos_s8qa1`): file này **49.29% dòng · 11.11% hàm** — tức 8/9
 * hàm CHƯA TỪNG chạy trong bất kỳ test nào của wave. Nó là **cổng đường TẢI** của ảnh đại diện phòng:
 * `FilePolicyService` hỏi đúng object này "ai được xem/tải/gắn/gỡ/xoá file `(CHAT, chat_room_avatar)`".
 * Int-spec của BE-2 chỉ đi đường ĐẶT ảnh và đọc `avatarUrl` (ký qua `ChatRoomAvatarPresignService`) —
 * không đường nào chạm resolver ⇒ cặp quyền đọc và ba vế `false` cứng nằm đó **không ai chứng minh**.
 *
 * Đây đúng lớp lỗ mà memory `read-path-gate-pair-must-match-download-pair` nói tới: màn hình hiện ảnh
 * bằng một cặp quyền, đường tải chấp nhận bằng một cặp khác — và không có test nào so hai vế.
 *
 * Hành vi đầu-cuối (403 thật trên route FOUNDATION) thuộc int-spec; suite này kiểm HÌNH DẠNG QUYẾT ĐỊNH,
 * chạy được ở CI không cần Postgres.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const ROOM = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";

/**
 * `action` là trường BẮT BUỘC của `FilePermissionInput` và policy layer luôn điền đúng động từ đang
 * hỏi. Dựng input theo từng động từ (thay vì một hằng dùng chung) để suite không vô tình chứng minh
 * điều gì đó chỉ đúng khi `action` sai — resolver này CỐ Ý bỏ qua `action` (nó phân nhánh bằng chính
 * tên method), và đó là điều ca "view/download đối xứng" đo.
 */
const inputFor = (action: FilePolicyAction): FilePermissionInput => ({
  userId: ACTOR,
  companyId: COMPANY,
  fileId: FILE,
  moduleCode: CHAT_MODULE_CODE,
  entityType: CHAT_ROOM_AVATAR_ENTITY_TYPE,
  entityId: ROOM,
  action,
});

const VIEW = inputFor(FilePolicyAction.View);
const DOWNLOAD = inputFor(FilePolicyAction.Download);

function build(opts?: { allow?: boolean; memberError?: unknown }) {
  const db = {
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  const can = vi.fn(async () => ({ allow: opts?.allow ?? true, reason: "test" }));
  const permission = { can } as unknown as PermissionService;

  const assertMember = vi.fn(async () => {
    if (opts?.memberError) throw opts.memberError;
    return { role: "member" as const, visibleFromSeq: null };
  });
  const access = { assertMember } as unknown as ChatAccessService;

  return {
    resolver: new ChatRoomAvatarFileResolver(db, permission, access),
    can,
    assertMember,
  };
}

describe("ChatRoomAvatarFileResolver — đăng ký vào policy layer", () => {
  it("khai ĐÚNG cặp (moduleCode, entityType) — sai một chữ là `deny-no-resolver` cho MỌI người", () => {
    const { resolver } = build();

    // `FilePolicyService.decideForLinkedFile` fail-closed và KHÔNG escalate xuống fallback
    // `FOUNDATION.FILE.*`: cặp không khớp ⇒ đặt được avatar mà không ai tải được, kể cả người vừa đặt.
    expect(resolver.moduleCode).toBe("CHAT");
    expect(resolver.entityTypes).toContain("chat_room_avatar");
  });
});

describe("ChatRoomAvatarFileResolver — ĐỌC (view/download) = cặp `view:chat-room` VÀ là thành viên", () => {
  it("✅ đối chứng dương: có cặp + là thành viên ⇒ xem VÀ tải đều được", async () => {
    const { resolver } = build({ allow: true });

    await expect(resolver.canViewFile(VIEW)).resolves.toBe(true);
    await expect(resolver.canDownloadFile(DOWNLOAD)).resolves.toBe(true);
  });

  it("🔒 hai vế đối xứng: view và download KHÔNG BAO GIỜ lệch nhau", async () => {
    // Lệch hai vế là lỗ kinh điển "thấy ảnh mà không tải được" (hoặc ngược lại — nặng hơn nhiều).
    for (const opts of [
      { allow: true, memberError: undefined },
      { allow: false, memberError: undefined },
      { allow: true, memberError: new NotFoundException("CHAT-ERR-001") },
    ]) {
      const { resolver } = build(opts);
      const view = await resolver.canViewFile(VIEW);
      const download = await resolver.canDownloadFile(DOWNLOAD);
      expect(download, JSON.stringify({ allow: opts.allow, member: !opts.memberError })).toBe(view);
    }
  });

  it("🔒 thiếu cặp `view:chat-room` ⇒ từ chối và KHÔNG hỏi tới membership (không tốn truy vấn, không rò)", async () => {
    const { resolver, assertMember } = build({ allow: false });

    await expect(resolver.canDownloadFile(DOWNLOAD)).resolves.toBe(false);
    expect(
      assertMember,
      "vế thứ hai không được chạy khi vế thứ nhất đã trượt",
    ).not.toHaveBeenCalled();
  });

  it("🔒 có cặp nhưng KHÔNG phải thành viên (404 hằng của ChatAccessService) ⇒ từ chối SẠCH, không ném", async () => {
    // Cũng là ca bắt được bẫy `await`: so một Promise với `null` luôn `true` — nếu `isRoomMember` mất
    // `await`, ca này trả `true` và ai cũng tải được avatar của phòng mình không thuộc.
    const { resolver } = build({ allow: true, memberError: new NotFoundException("CHAT-ERR-001") });

    await expect(resolver.canDownloadFile(DOWNLOAD)).resolves.toBe(false);
  });

  it("🔒 lỗi KHÁC 404 (DB hỏng) phải NÉM TIẾP — không được hoá trang thành 'không có quyền'", async () => {
    // Nuốt trắng mọi exception biến một sự cố hạ tầng thành 403 im lặng: người dùng báo "mất quyền",
    // log không có gì, và nguyên nhân thật (DB) không bao giờ lộ ra (silent-failure-hunter).
    const { resolver } = build({ allow: true, memberError: new Error("connection terminated") });

    await expect(resolver.canDownloadFile(DOWNLOAD)).rejects.toThrow("connection terminated");
  });

  it("nhận diện 404 qua `getStatus()` chứ không `instanceof` — lỗi đã bị bọc lại vẫn là 404", async () => {
    // Hai bản `@nestjs/common` khác instance trong worker vitest làm `instanceof` trượt IM LẶNG.
    const wrapped = { getStatus: () => 404, message: "CHAT-ERR-001" };
    const { resolver } = build({ allow: true, memberError: wrapped });

    await expect(resolver.canDownloadFile(DOWNLOAD)).resolves.toBe(false);
  });
});

describe("ChatRoomAvatarFileResolver — GHI qua FOUNDATION luôn bị chặn (đường ghi thứ hai)", () => {
  it("🔒 link · unlink · delete đều `false` — kể cả với người có ĐỦ cặp và LÀ thành viên", async () => {
    const { resolver } = build({ allow: true });

    // Ba method này OPTIONAL trên interface: bỏ trống ⇒ policy layer rơi xuống fallback
    // `FOUNDATION.FILE.LINK/UNLINK/DELETE`, cặp mà company-admin ĐANG giữ từ bulk grant `0005`.
    // Khi đó `POST /foundation/files/:id/links` gắn được ảnh BẤT KỲ (kể cả tệp của người khác) làm bộ
    // mặt một phòng họ không thuộc — vòng qua trọn bộ luật CHAT-DEC-016.
    await expect(resolver.canLinkFile()).resolves.toBe(false);
    await expect(resolver.canUnlinkFile()).resolves.toBe(false);
    await expect(resolver.canDeleteFile()).resolves.toBe(false);
  });

  it("🔒 ba vế đó KHÔNG hỏi quyền/membership — chúng là `false` VÔ ĐIỀU KIỆN, không phải 'tuỳ role'", async () => {
    const { resolver, can, assertMember } = build({ allow: true });

    await resolver.canLinkFile();
    await resolver.canUnlinkFile();
    await resolver.canDeleteFile();

    expect(can).not.toHaveBeenCalled();
    expect(assertMember).not.toHaveBeenCalled();
  });
});
