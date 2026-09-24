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
  SocialAttachGateDeniedException,
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
function makeService(alerts?: { emit: (...a: never[]) => Promise<boolean> }): SocialAttachmentsService {
  // S16-SOCIAL-ATTDEBT-1: đối số thứ 4 là `SecurityAlertService`. Mặc định `null` giữ nguyên mọi ca
  // cũ (chúng không đi qua đường alert); ca nào đo `reportAttachGateDeny` thì truyền giả vào.
  return new SocialAttachmentsService(
    null as never,
    null as never,
    null as never,
    (alerts ?? null) as never,
  );
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
/**
 * S16-SOCIAL-ATTDEBT-1 (C-5) — **U3**: `reportAttachGateDeny`.
 *
 * Ba bất biến được đo ở đây, cái nào hỏng cũng im lặng trong production:
 *  1. **Phân biệt bằng `instanceof`**, không bằng thông điệp — cùng transaction còn ném
 *     `ForbiddenException` của `assertCanMutateContent`, và hai hằng `FILE_TARGET_*_DENIED` đang có
 *     một khoản nợ muốn đổi CÂU CHỮ (nợ D-4 của ATTGATE-1). So chuỗi thì lượt đổi đó giết alert.
 *  2. **Tên khoá `detail` sống sót `sanitizeDetail`** — bộ lọc đó cắt mọi khoá khớp
 *     /(password|secret|token|code|otp|dek|cipher|hash|key)/i **trong im lặng**.
 *  3. **Khử trùng theo cửa sổ** — `security_alerts` là append-only, KHÔNG có đường dọn
 *     (`retention.service.ts` PROTECTED_TABLES) và KHÔNG có ThrottlerGuard nào chặn vòng lặp PATCH.
 */
describe("SocialAttachmentsService.reportAttachGateDeny (S16-SOCIAL-ATTDEBT-1 C-5)", () => {
  const COMPANY = "22222222-2222-4222-8222-222222222222";
  const ACTOR = "11111111-1111-4111-8111-111111111111";

  function makeAlerts() {
    return { emit: vi.fn().mockResolvedValue(true) };
  }

  function denial(
    targetId = "33333333-3333-4333-8333-333333333333",
    newFileCount = 2,
  ) {
    return new SocialAttachGateDeniedException(
      SOCIAL_ERR.FILE_TARGET_POST_DENIED,
      {
        targetType: "post",
        targetId,
        actorUserId: ACTOR,
        newFileCount,
      },
    );
  }

  it("ngoại lệ KHÁC ⇒ KHÔNG phát alert (phân biệt bằng instanceof, không bằng thông điệp)", async () => {
    const alerts = makeAlerts();
    const svc = makeService(alerts);
    // Chính hằng mà cổng dùng, nhưng gói trong `ForbiddenException` TRẦN: một lưới so chuỗi sẽ
    // phát alert ở đây (SAI), `instanceof` thì không.
    await svc.reportAttachGateDeny(
      new ForbiddenException(SOCIAL_ERR.FILE_TARGET_POST_DENIED),
      COMPANY,
    );
    await svc.reportAttachGateDeny(new Error("bất kỳ"), COMPANY);
    expect(alerts.emit).not.toHaveBeenCalled();
  });

  it("ngoại lệ của cổng ⇒ phát ĐÚNG một alert, `detail` đủ khoá và sống sót sanitizeDetail", async () => {
    const alerts = makeAlerts();
    const svc = makeService(alerts);
    await svc.reportAttachGateDeny(denial(), COMPANY);

    expect(alerts.emit).toHaveBeenCalledTimes(1);
    const [companyId, signal] = alerts.emit.mock.calls[0] as [
      string,
      {
        alertType: string;
        severity: string;
        subjectUserId: string;
        detail: Record<string, unknown>;
      },
    ];
    expect(companyId).toBe(COMPANY);
    expect(signal.alertType).toBe("attach_gate_deny");
    expect(signal.severity).toBe("low");
    expect(signal.subjectUserId).toBe(ACTOR);
    expect(signal.detail).toEqual({
      route: "postUpdate",
      target: "post",
      targetId: "33333333-3333-4333-8333-333333333333",
      newFiles: 2,
      pair: "create:feed-post",
    });

    // 🔴 Ca ĐỐI CHỨNG: chứng minh bộ lọc THẬT SỰ cắt — không có nó thì assert trên là xanh-rỗng
    // (nó sẽ xanh y hệt kể cả khi `sanitizeDetail` là hàm rỗng).
    const BLOCKED = /(password|secret|token|code|otp|dek|cipher|hash|key)/i;
    for (const k of Object.keys(signal.detail)) {
      expect(
        BLOCKED.test(k),
        `khoá \`${k}\` sẽ bị sanitizeDetail CẮT IM LẶNG`,
      ).toBe(false);
    }
    expect(
      BLOCKED.test("moduleCode"),
      "ca đối chứng: bộ lọc phải cắt `moduleCode`",
    ).toBe(true);
  });

  it("`detail` KHÔNG mang id/tên tệp — chỉ SỐ LƯỢNG", async () => {
    const alerts = makeAlerts();
    const svc = makeService(alerts);
    await svc.reportAttachGateDeny(denial(), COMPANY);
    const [, signal] = alerts.emit.mock.calls[0] as [
      string,
      { detail: Record<string, unknown> },
    ];
    expect(Object.keys(signal.detail)).not.toContain("fileIds");
    expect(JSON.stringify(signal.detail)).not.toContain("file");
  });

  it("khử trùng theo cửa sổ: hai lượt deny CÙNG đích ⇒ 1 alert · đích KHÁC ⇒ 2 alert", async () => {
    const alerts = makeAlerts();
    const svc = makeService(alerts);
    await svc.reportAttachGateDeny(denial(), COMPANY);
    await svc.reportAttachGateDeny(denial(), COMPANY);
    expect(
      alerts.emit,
      "lượt thứ hai cùng đích phải bị khử trùng",
    ).toHaveBeenCalledTimes(1);

    await svc.reportAttachGateDeny(
      denial("44444444-4444-4444-8444-444444444444"),
      COMPANY,
    );
    expect(
      alerts.emit,
      "đích KHÁC là một tín hiệu khác — không được khử",
    ).toHaveBeenCalledTimes(2);
  });

  it("`emit` NÉM ⇒ reporter không làm hỏng luồng (deny vẫn là deny)", async () => {
    const alerts = { emit: vi.fn().mockRejectedValue(new Error("DB sập")) };
    const svc = makeService(alerts);
    // 🔴 Reporter PHẢI nuốt (và log). Caller của nó là khối `catch` của `update()`, ném LẠI lỗi 403
    // ngay sau — một ngoại lệ thoát ra từ đây sẽ THAY THẾ 403 bằng 500, tức để một sự cố hạ tầng
    // ghi đè lên một quyết định an ninh. Ca này đỏ nếu ai bỏ try/catch trong reporter.
    await expect(svc.reportAttachGateDeny(denial(), COMPANY)).resolves.toBeUndefined();
  });
});
