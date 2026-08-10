import { HttpException, HttpStatus } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCallDto } from "@mediaos/contracts";
import { CHAT_CALL_COOLDOWN_SCOPE, ChatCallCooldownService } from "./chat-call-cooldown.service";
import { CHAT_CALL_INVITE_COOLDOWN_MESSAGE, ChatCallsService } from "./chat-calls.service";
import type { ChatAccessService } from "./chat-access.service";
import type { ChatCallsRepository } from "./chat-calls.repository";
import type { AuditService } from "../events/audit.service";
import type { DatabaseService } from "../db/db.service";

/**
 * S7-CALL-BE-FIX-1 (MEDIUM-3, vế TẦN SUẤT) — trần lời mời/phút/người trên `CHAT-API-026`.
 *
 * ┌─ VÌ SAO Ở ĐÂY CHỨ KHÔNG CHỈ Ở INT-SPEC ────────────────────────────────────────────────────────┐
 * │ Ca int-spec tương ứng nằm sau `describe.skipIf(!hasLaneDb)` — không có Postgres thì nó SKIP, và │
 * │ SKIP không phải FAIL. Hàng rào chống-lạm-dụng mà bằng chứng duy nhất ngủ trên máy dev/CI thường │
 * │ là hàng rào không ai biết đã gỡ (memory `src-green-is-not-integration-green`). Bốn ca dưới đây  │
 * │ chạy ở MỌI lần `pnpm test` vì đúng điểm mấu chốt của thiết kế là **không chạm DB**.             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * `withTenant` cố tình KHÔNG gọi callback: mọi ca ở đây đo cái CỔNG, không đo thân `invite`. Thân đã có
 * 20+ ca int-spec riêng, và mô phỏng nó bằng stub sẽ chỉ chứng minh stub hoạt động.
 */

const CO = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "33333333-3333-4333-8333-333333333333";
const ROOM = "44444444-4444-4444-8444-444444444444";
const ACTOR = { id: USER, companyId: CO };
const DTO = { kind: "audio" } as const;

/** Trần nhỏ để ca test ngắn — đặt qua env TRƯỚC khi dựng service (service đọc một lần lúc construct). */
const MAX = 3;

function makeService() {
  // Sentinel: `invite` trả thẳng giá trị này khi qua được cổng ⇒ phân biệt "đi tiếp" với "bị chặn" mà
  // không cần dựng cả đường ghi DB.
  const passed = { id: "passed-the-gate" } as unknown as ChatCallDto;
  const withTenant = vi.fn(async () => passed);
  const db = { withTenant } as unknown as DatabaseService;

  // Cooldown thật, KHÔNG Valkey ⇒ đếm in-memory, xác định. Chính lớp production, không phải bản mô phỏng.
  const cooldown = new ChatCallCooldownService();

  const svc = new ChatCallsService(
    db,
    {} as unknown as ChatCallsRepository,
    {} as unknown as ChatAccessService,
    {} as unknown as AuditService,
    cooldown,
  );
  return { svc, withTenant, cooldown, passed };
}

describe("ChatCallsService.invite — cooldown tần suất (MEDIUM-3 vế 2)", () => {
  const prevMax = process.env.CHAT_CALL_INVITE_MAX_PER_MIN;

  beforeEach(() => {
    process.env.CHAT_CALL_INVITE_MAX_PER_MIN = String(MAX);
  });

  afterEach(() => {
    if (prevMax === undefined) delete process.env.CHAT_CALL_INVITE_MAX_PER_MIN;
    else process.env.CHAT_CALL_INVITE_MAX_PER_MIN = prevMax;
  });

  it(`cho qua đúng ${MAX} lời mời, lần thứ ${MAX + 1} trả 429 (không phải 4xx khác, không phải im lặng)`, async () => {
    const { svc, passed } = makeService();

    for (let i = 0; i < MAX; i += 1) {
      await expect(svc.invite(ACTOR, ROOM, DTO)).resolves.toBe(passed);
    }

    // `rejects.toThrow` MỘT MÌNH sẽ xanh với BẤT KỲ lỗi nào — kể cả `TypeError` do stub thiếu. Bắt tận
    // tay để assert được cả status lẫn thông điệp.
    const err = await svc.invite(ACTOR, ROOM, DTO).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((err as HttpException).message).toBe(CHAT_CALL_INVITE_COOLDOWN_MESSAGE);
  });

  it("lần bị chặn KHÔNG mở transaction — cổng đứng TRƯỚC mọi công việc DB", async () => {
    // Đây là lý do tồn tại của hàng rào: chặn trước khi tiêu tài nguyên. Đặt cooldown sau `assertMember`
    // vẫn "đúng chức năng" nhưng mỗi lần bị chặn vẫn phải mở tx + query — ca này ghim thứ tự đó lại.
    const { svc, withTenant } = makeService();
    for (let i = 0; i < MAX; i += 1) await svc.invite(ACTOR, ROOM, DTO);
    expect(withTenant).toHaveBeenCalledTimes(MAX);

    await svc.invite(ACTOR, ROOM, DTO).catch(() => undefined);

    expect(withTenant).toHaveBeenCalledTimes(MAX); // KHÔNG tăng
  });

  it("hạn mức tách theo NGƯỜI — người khác không bị chặn lây, và phòng khác KHÔNG cấp thêm hạn mức", async () => {
    const { svc, passed } = makeService();
    for (let i = 0; i < MAX; i += 1) await svc.invite(ACTOR, ROOM, DTO);

    // Vế 1 — cùng người, PHÒNG KHÁC: vẫn bị chặn. Khoá theo (company, user), KHÔNG theo phòng: chia hạn
    // mức theo phòng thì ai ở nhiều phòng sẽ nhân hạn mức lên bấy nhiêu lần.
    const otherRoom = await svc
      .invite(ACTOR, "55555555-5555-4555-8555-555555555555", DTO)
      .catch((e: unknown) => e);
    expect((otherRoom as HttpException).getStatus?.()).toBe(HttpStatus.TOO_MANY_REQUESTS);

    // Vế 2 — người khác, cùng phòng: KHÔNG bị chặn lây. Bucket dùng chung sẽ biến một người ồn ào thành
    // một cú DoS lên đồng nghiệp của họ.
    await expect(svc.invite({ id: OTHER_USER, companyId: CO }, ROOM, DTO)).resolves.toBe(passed);
  });

  it("bucket `call-invite` TÁCH khỏi bucket `ice-config` (không chung hạn mức)", async () => {
    // Hai endpoint dùng CHUNG một lớp cooldown; dùng chung luôn cả bucket sẽ khiến người gọi nhiều bị
    // cắt cấu hình TURN (và ngược lại) — hỏng theo kiểu không ai truy ra được.
    const { svc, cooldown } = makeService();
    const iceKey = ChatCallCooldownService.key(CHAT_CALL_COOLDOWN_SCOPE.ICE_CONFIG, CO, USER);
    const inviteKey = ChatCallCooldownService.key(CHAT_CALL_COOLDOWN_SCOPE.INVITE, CO, USER);

    for (let i = 0; i < MAX + 1; i += 1) await svc.invite(ACTOR, ROOM, DTO).catch(() => undefined);

    // Vế BẮT BUỘC PHẢI CÓ, nếu không ca này xanh cả khi cổng bị gỡ hẳn (lúc đó KHÔNG bucket nào được
    // đếm, và "ice còn nguyên" đúng một cách rỗng tuếch — memory `deny-cases-vacuous-without-allow-case`).
    // Chứng minh bucket `call-invite` THẬT SỰ đã bị tiêu trước khi kết luận bucket kia không liên quan.
    expect(await cooldown.allow(inviteKey, MAX, 60)).toBe(false);
    // Hạn mức ice-config của CHÍNH người đó vẫn còn nguyên sau khi đốt sạch hạn mức mời.
    expect(await cooldown.allow(iceKey, 1, 60)).toBe(true);
  });
});
