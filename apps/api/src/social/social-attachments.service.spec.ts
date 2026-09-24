/**
 * S16-SOCIAL-ATTGATE-1 — luật của cổng vế 6a (`AttachNewGate`), đo KHÔNG cần DB.
 *
 * Ca int-spec (`test/integration/social-attgate-1-update-attach.int-spec.ts`) đã đo hành vi end-to-end
 * của 4 route. Ba ca ở đây đo thứ int-spec **không chạm tới được**:
 *   1. cổng DENY nhưng lượt sửa không thêm tệp nào ⇒ KHÔNG ném (đó là toàn bộ D-1 — quyền gỡ đính
 *      kèm của kiểm duyệt);
 *   2. thứ tự: cổng quyền chạy TRƯỚC `assertLinkableFilesTx` (vế sở hữu);
 *   3. **fail-CLOSED của hình dạng**: một object cổng dựng THIẾU field `allow` (qua cast — chính là
 *      thứ TS không bắt khi có `Partial`/`as`) vẫn phải ném. Hình dạng cũ `{denyMessage: string|null}`
 *      sẽ IM LẶNG CHO QUA ở ca này (plan F-2).
 */

import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { TenantTx } from "../db/db.service";
import {
  ATTACH_GATE_ENFORCED_BY_TIER1,
  SocialAttachmentsService,
  type AttachNewGate,
} from "./social-attachments.service";
import { SOCIAL_ERR } from "./social.errors";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const TARGET = "33333333-3333-3333-3333-333333333333";
const FILE_A = "44444444-4444-4444-4444-444444444444";

const DENY: AttachNewGate = { allow: false, reason: SOCIAL_ERR.FILE_TARGET_POST_DENIED };

/**
 * `tx` giả tối thiểu cho đúng đoạn đường tới cổng: đọc link hiện có → (gỡ mềm) → cổng.
 * `insert` là spy để chứng minh "không ném" cũng KHÔNG có nghĩa là "đã ghi".
 */
function fakeTx(currentLinks: ReadonlyArray<{ id: string; fileId: string }>) {
  const insert = vi.fn(() => ({ values: vi.fn(async () => undefined) }));
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
  const tx = {
    select: () => ({ from: () => ({ where: async () => currentLinks }) }),
    update,
    insert,
  } as unknown as TenantTx;
  return { tx, insert, update };
}

/**
 * Service với mọi phụ thuộc rỗng — đoạn đường đang đo không chạm tới cái nào.
 *
 * ⚠️ **ĐỪNG khai rằng `null` ở đây là phép đo thứ tự cổng.** Bản đầu của comment này viết vậy và
 * SAI: `this.policy` được dùng ở `decorateMany` (`social-attachments.service.ts:371`), KHÔNG ở
 * `assertLinkableFilesTx` — nên đảo thứ tự cổng sẽ ném `UnprocessableEntityException` (vế «thiếu
 * tệp», vì `tx` giả trả 0 hàng), không phải TypeError. Ca vẫn ĐỎ, nhưng bằng cơ chế KHÁC cơ chế
 * được khai — đúng lớp lỗi WO này ra đời để dọn.
 * Thứ tự cổng được đo THẬT ở ca G18 của `test/integration/social-attgate-1-update-attach.int-spec.ts`
 * (403 chứ không 422). (FULL gate 24/09/2026, `silent-failure-hunter` S-2.)
 */
function makeService(): SocialAttachmentsService {
  return new SocialAttachmentsService(null as never, null as never, null as never);
}

describe("SocialAttachmentsService — cổng `AttachNewGate` (S16-SOCIAL-ATTGATE-1)", () => {
  it("hằng đường TẠO cho phép gắn (tầng-1 của 002/015 đã ép cặp create)", () => {
    expect(ATTACH_GATE_ENFORCED_BY_TIER1.allow).toBe(true);
  });

  it("DENY + KHÔNG tệp mới ⇒ KHÔNG ném, KHÔNG ghi (quyền gỡ đính kèm của kiểm duyệt còn nguyên)", async () => {
    const { tx, insert } = fakeTx([{ id: "l1", fileId: FILE_A }]);
    await expect(
      makeService().syncLinksTx(tx, COMPANY, USER, "post", TARGET, [FILE_A], DENY),
    ).resolves.toBeUndefined();
    expect(insert, "không tệp mới ⇒ không INSERT").not.toHaveBeenCalled();
  });

  it("DENY + gỡ HẾT (mảng rỗng) ⇒ KHÔNG ném — `[]` là lượt gỡ, không phải lượt thêm", async () => {
    const { tx, insert } = fakeTx([{ id: "l1", fileId: FILE_A }]);
    await expect(
      makeService().syncLinksTx(tx, COMPANY, USER, "post", TARGET, [], DENY),
    ).resolves.toBeUndefined();
    expect(insert).not.toHaveBeenCalled();
  });

  it("DENY + CÓ tệp mới ⇒ ném 403 mang ĐÚNG hằng, TRƯỚC vế sở hữu", async () => {
    const { tx, insert } = fakeTx([]);
    await expect(
      makeService().syncLinksTx(tx, COMPANY, USER, "post", TARGET, [FILE_A], DENY),
      // `toBeInstanceOf` chứ không chỉ `toThrow`: dời cổng xuống SAU `assertLinkableFilesTx` thì lỗi
      // ra là `UnprocessableEntityException`, và `toThrow` theo THÔNG ĐIỆP không phân biệt nổi hai
      // lớp đó.
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      makeService().syncLinksTx(tx, COMPANY, USER, "post", TARGET, [FILE_A], DENY),
    ).rejects.toThrow(SOCIAL_ERR.FILE_TARGET_POST_DENIED);
    expect(insert).not.toHaveBeenCalled();
  });

  it("hằng của ĐÍCH bình luận KHÁC hằng của bài — một cửa hỏng không núp sau cửa kia", async () => {
    const { tx } = fakeTx([]);
    const denyComment: AttachNewGate = {
      allow: false,
      reason: SOCIAL_ERR.FILE_TARGET_COMMENT_DENIED,
    };
    await expect(
      makeService().syncLinksTx(tx, COMPANY, USER, "comment", TARGET, [FILE_A], denyComment),
    ).rejects.toThrow(SOCIAL_ERR.FILE_TARGET_COMMENT_DENIED);
    expect(SOCIAL_ERR.FILE_TARGET_COMMENT_DENIED).not.toBe(SOCIAL_ERR.FILE_TARGET_POST_DENIED);
  });

  it("🔴 FAIL-CLOSED: object cổng dựng THIẾU field vẫn ném (hình dạng cũ sẽ im lặng cho qua)", async () => {
    const { tx, insert } = fakeTx([]);
    // Đây KHÔNG phải ca giả định: `{}` là hình dạng mà một `Partial<…>`, một mock test, hay một
    // object dựng dở qua `as` đều tạo ra — và TS không bắt được sau một cast.
    const broken = {} as AttachNewGate;
    await expect(
      makeService().syncLinksTx(tx, COMPANY, USER, "post", TARGET, [FILE_A], broken),
    ).rejects.toThrow(ForbiddenException);
    expect(insert, "không được ghi khi cổng không đọc được").not.toHaveBeenCalled();
  });
});
