/**
 * S16-SOCIAL-BE-1B (D13-a, owner ký 22/09/2026) — `payloadOf` của `SocialNotiBridgeRegistrar`.
 * Chạy KHÔNG CẦN DB (fake bridge bắt `registerSource`, khuôn `payroll-noti-bridge.registrar.spec.ts`).
 *
 * 🔴 **Vì sao phải có spec này.** SOC-DEC-011 che `reporter` của `SOCIAL-API-028` theo scope. Nhưng
 * `notifications.payload` là một **bề mặt đọc THỨ HAI** của cùng bí mật đó: người nhận NOTI-036 gồm cả
 * người giữ `manage:feed-report@Department`, và `my-notifications.mapper.ts` trả `payload` NGUYÊN VĂN.
 * Forward `actorUserId` (= user_id NGƯỜI TỐ GIÁC) là vòng qua cổng — khuôn «cổng màn-hình ≠ cổng
 * đường-tải» — và nặng hơn vì hàng `notifications` **sống lâu hơn grant**.
 *
 * Ba reviewer độc lập của FULL gate cùng chỉ ra lỗ này; không cổng nào khác canh nó — int-spec chỉ đọc
 * `outbox_events.payload` (VẪN có `actorUserId`, đúng thiết kế: cần cho `notifications.created_by`),
 * chứ không đọc payload SAU khi `payloadOf` lọc.
 */
import { describe, expect, it } from "vitest";
import {
  SOCIAL_EVENT_MENTIONED,
  SOCIAL_EVENT_POLL_CLOSED,
  SOCIAL_EVENT_POST_REPORTED,
} from "../social/social-noti.payload";
import { SocialNotiBridgeRegistrar } from "./social-noti-bridge.registrar";

interface Registered {
  eventType: string;
  eventCode: string;
  payloadOf?: (ctx: unknown) => Record<string, unknown>;
  dedupeKeyOf?: (ctx: unknown) => string;
  sourceEntityIdOf?: (ctx: unknown) => string;
  resolveRecipients?: (ctx: unknown) => Promise<string[]>;
}

const COMPANY_ID = "3f2b7c10-5d6e-4a8b-9c1d-2e3f4a5b6c7d";
const REPORTER_USER_ID = "11111111-2222-3333-4444-555555555555";

function ctxOf(payload: Record<string, unknown>) {
  return { companyId: COMPANY_ID, eventId: "evt-1", eventType: "x", payload };
}

/** Payload outbox THẬT của NOTI-036 (mirror `SocialPostReportedPayload`). */
function reportedPayload(): Record<string, unknown> {
  return {
    actorUserId: REPORTER_USER_ID,
    postId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    post_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    reportId: "99999999-8888-7777-6666-555555555555",
    report_id: "99999999-8888-7777-6666-555555555555",
    targetType: "post",
    targetId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    target_type_label: "bài viết",
    reason_label: "Quấy rối",
    recipientUserIds: ["77777777-6666-5555-4444-333333333333"],
  };
}

describe("SocialNotiBridgeRegistrar.payloadOf — D13-a (SOC-DEC-011)", () => {
  const registered: Registered[] = [];
  const bridge = { registerSource: (s: Registered) => registered.push(s) };
  const registrar = new SocialNotiBridgeRegistrar(bridge as never);
  registrar.onModuleInit();

  const find = (eventType: string) => registered.find((r) => r.eventType === eventType)!;

  it("NEO DƯƠNG: mapping NOTI-036 có đăng ký và `payloadOf` có thực thi", () => {
    const m = find(SOCIAL_EVENT_POST_REPORTED);
    expect(m, "mapping `social.post_reported` phải được đăng ký").toBeTruthy();
    expect(m.eventCode).toBe("SOCIAL_POST_REPORTED");
    expect(
      typeof m.payloadOf,
      "không có `payloadOf` thì payload outbox đi thẳng — ca dưới vô nghĩa",
    ).toBe("function");
  });

  it("NOTI-036 KHÔNG forward `actorUserId`/`actor_name` (danh tính người tố giác)", () => {
    const out = find(SOCIAL_EVENT_POST_REPORTED).payloadOf!(ctxOf(reportedPayload()));

    // Neo DƯƠNG trước mọi assert phủ định: bộ lọc phải còn chở đủ biến template, nếu không
    // `{}` rỗng cũng «không chứa actorUserId» và ca này xanh vì lý do sai.
    expect(out.target_type_label).toBe("bài viết");
    expect(out.reason_label).toBe("Quấy rối");
    expect(out.post_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    expect(out).not.toHaveProperty("actorUserId");
    expect(out).not.toHaveProperty("actor_name");
    // Vét cả giá trị, không chỉ tên khoá: uuid người tố giác không được lọt qua BẤT KỲ khoá nào.
    expect(JSON.stringify(out)).not.toContain(REPORTER_USER_ID);
  });

  it("CẤM theo TỪNG MÃ: NOTI-028 (nhắc tên) VẪN forward `actorUserId` như cũ", () => {
    const out = find(SOCIAL_EVENT_MENTIONED).payloadOf!(
      ctxOf({
        actorUserId: REPORTER_USER_ID,
        actor_name: "Nguyễn Văn A",
        post_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        target_type_label: "bài viết",
        recipientUserIds: ["77777777-6666-5555-4444-333333333333"],
      }),
    );
    // Việc cấm phải HẸP đúng một mã. Nếu ai đó biến `PAYLOAD_KEYS_DENIED` thành cấm toàn cục,
    // ca trên vẫn xanh còn ca này ĐỬe — đó là việc của nó.
    expect(out.actorUserId).toBe(REPORTER_USER_ID);
    expect(out.actor_name).toBe("Nguyễn Văn A");
  });

  it("thiếu biến template vẫn NÉM — phép trừ chạy SAU `requireField`", () => {
    const p = reportedPayload();
    delete p.reason_label;
    expect(() => find(SOCIAL_EVENT_POST_REPORTED).payloadOf!(ctxOf(p))).toThrow(/reason_label/);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  //  S16-SOCIAL-BE-2B-1 · nợ test N7 — NOTI-035 (bình chọn đã đóng)
  // ══════════════════════════════════════════════════════════════════════════════════════════

  const POLL_POST_ID = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";
  const AUTHOR_USER_ID = "22222222-3333-4444-5555-666666666666";

  /** Payload outbox THẬT của NOTI-035 (mirror `SocialPollClosedPayload`). */
  function pollClosedPayload(): Record<string, unknown> {
    return {
      post_id: POLL_POST_ID,
      poll_question: "Ăn trưa ở đâu?",
      recipientUserIds: [AUTHOR_USER_ID],
    };
  }

  it("N-dedupe — `dedupeKeyOf` CÓ khai và trả `post_id`, KHÔNG rơi về `eventId`", () => {
    const m = find(SOCIAL_EVENT_POLL_CLOSED);
    expect(m, "mapping `social.poll_closed` phải được đăng ký").toBeTruthy();
    expect(m.eventCode).toBe("SOCIAL_POLL_CLOSED");

    // 🔴 Đây là vế duy nhất chặn được lỗi CÂM: catalog `0581` khai `dedupe_strategy='DedupeKey'`,
    // còn `registerSource()` để `dedupeKeyOf` OPTIONAL với fallback `ctx.eventId`. Quên khai thì
    // mỗi lượt phát có khoá KHÁC NHAU ⇒ dedupe biến mất mà không lỗi, không log.
    expect(typeof m.dedupeKeyOf, "thiếu `dedupeKeyOf` ⇒ dedupe biến mất CÂM").toBe("function");

    // Hai ngữ cảnh khác `eventId` nhưng CÙNG bài ⇒ PHẢI ra cùng một khoá. Đây chính là cửa sổ đua
    // giữa `044` (đóng tay) và job theo hạn.
    const k1 = m.dedupeKeyOf!({ ...ctxOf(pollClosedPayload()), eventId: "evt-manual" });
    const k2 = m.dedupeKeyOf!({ ...ctxOf(pollClosedPayload()), eventId: "evt-job" });
    expect(k1).toBe(POLL_POST_ID);
    expect(k2).toBe(k1);

    // Đối chứng ÂM: bài KHÁC ⇒ khoá KHÁC (khoá hằng cũng "ổn định" nhưng gộp mọi poll làm một).
    const other = m.dedupeKeyOf!(
      ctxOf({ ...pollClosedPayload(), post_id: "cccccccc-dddd-eeee-ffff-000000000000" }),
    );
    expect(other).not.toBe(k1);
  });

  it("N-035 — người nhận lấy TỪ payload (tác giả), và payload KHÔNG chở gì về cử tri", async () => {
    const m = find(SOCIAL_EVENT_POLL_CLOSED);
    expect(typeof m.resolveRecipients).toBe("function");
    await expect(m.resolveRecipients!(ctxOf(pollClosedPayload()))).resolves.toEqual([
      AUTHOR_USER_ID,
    ]);

    const out = m.payloadOf!(ctxOf(pollClosedPayload()));
    // Neo dương: đủ biến template của `0581:262-267`, nếu không thì `{}` rỗng cũng "không lộ".
    expect(out.poll_question).toBe("Ăn trưa ở đâu?");
    expect(out.post_id).toBe(POLL_POST_ID);

    // 🔴 SOC-DEC-009: `notifications.payload` là bề mặt đọc THỨ HAI và nó sống lâu hơn grant. Một
    // khoá cử tri lọt qua đây là rò danh tính người bỏ phiếu của bình chọn ẩn danh, vòng qua hết
    // mọi cổng mà `043` dựng lên.
    const VOTER_USER_ID = "44444444-5555-6666-7777-888888888888";
    const leaky = m.payloadOf!(
      ctxOf({
        ...pollClosedPayload(),
        voter_user_ids: [VOTER_USER_ID],
        actorUserId: VOTER_USER_ID,
      }),
    );
    expect(
      JSON.stringify(leaky),
      "whitelist khoá phải LOẠI mọi thứ ngoài biến template",
    ).not.toContain(VOTER_USER_ID);
  });

  it("N-035 — thiếu `post_id` hoặc người nhận RỖNG thì NÉM, không phát im lặng", () => {
    const m = find(SOCIAL_EVENT_POLL_CLOSED);

    const noPost = pollClosedPayload();
    delete noPost.post_id;
    expect(() => m.sourceEntityIdOf!(ctxOf(noPost))).toThrow(/post_id/);

    const noRecipient = { ...pollClosedPayload(), recipientUserIds: [] };
    // Producer đã chặn tập rỗng từ trước (log WARN rồi `continue`); vế này gác nốt đường còn lại.
    expect(() => m.resolveRecipients!(ctxOf(noRecipient))).toThrow(/recipientUserIds/);
  });
});
