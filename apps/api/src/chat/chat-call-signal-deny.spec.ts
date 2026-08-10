import { describe, expect, it } from "vitest";
import { CHAT_CALL_INBOUND_EVENTS } from "@mediaos/contracts";
import {
  CALL_SIGNAL_FRAMES_PER_WINDOW,
  CALL_SIGNAL_FRAME_WINDOW_MS,
  CALL_SIGNAL_HARD_MULTIPLIER,
  buildSignalViolationPayload,
  chargeFrame,
  classifyMissingParticipant,
  isInboundCallEvent,
  newFrameBudget,
} from "./chat-call-signal-deny";

/**
 * S7-CALL-RT-1 — luật TỪ CHỐI của `/ws-call`, tách khỏi gateway thành hàm THUẦN.
 *
 * ┌─ VÌ SAO FILE NÀY COLOCATED TRONG `src/` ─────────────────────────────────────────────────────┐
 * │ Mọi `*.int-spec.ts` đều `describe.skipIf(!hasLaneDb)`. Luật phân loại A/B/C là hàng rào an   │
 * │ ninh của kênh DUY NHẤT mà client được ghi lên WS — bằng chứng cho nó không được phép ngủ trên │
 * │ CI thường (memory `vitest-unit-specs-must-be-colocated` · `src-green-is-not-integration-green`).│
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 */
describe("R2 — allowlist inbound là ĐÓNG", () => {
  it("nhận đúng 8 tên trong `CHAT_CALL_INBOUND_EVENTS`", () => {
    for (const e of CHAT_CALL_INBOUND_EVENTS) expect(isInboundCallEvent(e)).toBe(true);
  });

  it("từ chối mọi tên khác — kể cả 5 sự kiện vòng đời CỐ Ý đi REST", () => {
    // DECISIONS-07 §4 liệt kê 5 tên này là "KHÔNG có trong danh sách (cố ý, đi REST)". Chúng là những
    // tên có khả năng bị thêm nhầm nhất, vì LMS xử lý cả 5 ngay trong handler socket (`server.mjs`).
    for (const e of [
      "call:invite",
      "call:accept",
      "call:reject",
      "call:cancel",
      "call:hangup",
      "chat:send",
      "call:evil",
      "",
    ]) {
      expect(isInboundCallEvent(e), e).toBe(false);
    }
  });
});

describe("D5/V11 — phân loại khi actor KHÔNG có hàng participant", () => {
  it("3 sự kiện RELAY → `probe` (dò cửa): đẩy tín hiệu vào cuộc gọi của người khác", () => {
    for (const e of ["call:sdp-offer", "call:sdp-answer", "call:ice-candidate"]) {
      expect(classifyMissingParticipant(e), e).toBe("probe");
    }
  });

  it("5 sự kiện còn lại → `race`: bỏ im lặng, KHÔNG ghi, KHÔNG ngắt", () => {
    // ⚠️ Đây là ca bảo vệ NGƯỜI DÙNG THẬT, không phải nới lỏng:
    //  • người được mời thứ 21 trở đi bị `CHAT_CALL_MAX_INVITEES = 20` cắt — họ là thành viên phòng hợp
    //    lệ, không có hàng participant, và FE của họ vẫn có thể thử `call:join`;
    //  • ICE/ping tới sau khi bên kia vừa gác máy là chuyện xảy ra ở MỌI cuộc gọi.
    // Xếp chúng vào `probe` nghĩa là mỗi cuộc gọi kết thúc bình thường đẻ vài hàng append-only vào
    // `user_security_events` (bảng KHÔNG có job dọn) và ngắt kết nối của người dùng hợp lệ.
    for (const e of [
      "call:join",
      "call:leave",
      "call:ping",
      "call:media-state",
      "call:screen-state",
    ]) {
      expect(classifyMissingParticipant(e), e).toBe("race");
    }
  });

  it("mọi sự kiện trong allowlist đều được phân loại — không có ca rơi vào mặc định im lặng", () => {
    // Thêm sự kiện thứ 9 vào allowlist mà quên phân loại ⇒ ca này ĐỎ, thay vì rơi vào một nhánh mặc
    // định mà không ai chọn.
    for (const e of CHAT_CALL_INBOUND_EVENTS) {
      expect(["probe", "race"], e).toContain(classifyMissingParticipant(e));
    }
  });
});

describe("V3 (CRITICAL) — payload security-event ĐÓNG: không bao giờ chứa SDP/ICE", () => {
  it("đúng 4 khoá, mã CHAT-ERR-030", () => {
    const p = buildSignalViolationPayload("call:sdp-offer", "not_participant");
    expect(Object.keys(p).sort()).toEqual(["code", "event", "ns", "reason"]);
    expect(p).toEqual({
      ns: "ws-call",
      event: "call:sdp-offer",
      reason: "not_participant",
      code: "CHAT-ERR-030",
    });
  });

  it("tên sự kiện NGOÀI allowlist bị thay bằng `unknown` — client không bơm được chuỗi tuỳ ý", () => {
    // ⚠️ Tên sự kiện do CLIENT đặt tự do. Ghi thẳng vào `user_security_events` (append-only, không xoá
    // được) là mở đúng đường bơm mà hàng rào này dựng ra để chặn — và tệ hơn: nội dung SDP có thể bị
    // nhét vào chính chỗ đó. `AuditMaskerService` mask theo TÊN KHOÁ (`password`/`token`/`secret`),
    // `sdp`/`candidate` KHÔNG nằm trong đó ⇒ masker không cứu.
    const sdpish = ["v=0", "o=- 46117 2 IN IP4 127.0.0.1", "a=candidate:1 1 UDP"].join("\r\n");
    const p = buildSignalViolationPayload(sdpish, "not_allowlisted");
    expect(p.event).toBe("unknown");
    expect(JSON.stringify(p)).not.toContain("candidate");
    expect(JSON.stringify(p)).not.toContain("v=0");
  });

  it("KHÔNG có đường nào nhận nội dung khung — chữ ký chỉ có (event, reason)", () => {
    // Ca cấu trúc: hàm nhận đúng 2 tham số. Thêm tham số thứ ba ("để forensic đầy đủ hơn") là bước đầu
    // của việc lưu SDP — mà theo DECISIONS-07 R3, ngày lưu SDP là ngày `CHAT-DEC-020` HẾT HIỆU LỰC.
    expect(buildSignalViolationPayload.length).toBe(2);
  });
});

describe("V7 — trần khung theo socket (chống khuếch đại DoS lên DB)", () => {
  const T0 = 1_000_000;

  it("cho qua đúng hạn mức, rồi BỎ khung — trickle ICE bình thường không bị đụng", () => {
    // Ca ALLOW bắt buộc (memory `deny-cases-vacuous-without-allow-case`): một phiên trickle 40 candidate
    // KHÔNG được bỏ khung nào. Đặt trần quá chặt là bóp chết chính cuộc gọi, và hỏng IM LẶNG.
    let b = newFrameBudget(T0);
    for (let i = 0; i < 40; i += 1) {
      const r = chargeFrame(b, T0 + i);
      expect(r.verdict, `khung trickle #${i}`).toBe("ok");
      b = r.budget;
    }

    for (let i = 40; i < CALL_SIGNAL_FRAMES_PER_WINDOW; i += 1) {
      const r = chargeFrame(b, T0 + i);
      expect(r.verdict).toBe("ok");
      b = r.budget;
    }
    expect(chargeFrame(b, T0 + 500).verdict).toBe("drop");
  });

  it("vượt bội số CỨNG → ngắt (khung thứ hard+1, không phải hard)", () => {
    // Ranh giới đo tường minh: "vượt" nghĩa là khung THỨ hard+1. Đo bằng biến `last` sau vòng lặp sẽ
    // không phân biệt được `>` với `>=` — và một off-by-one ở đây là ngắt kết nối SỚM một khung của
    // người dùng thật.
    let b = newFrameBudget(T0);
    const hard = CALL_SIGNAL_FRAMES_PER_WINDOW * CALL_SIGNAL_HARD_MULTIPLIER;
    let atHard: string = "";
    for (let i = 0; i < hard; i += 1) {
      const r = chargeFrame(b, T0 + 1);
      b = r.budget;
      atHard = r.verdict;
    }
    expect(atHard, `khung thứ ${hard} vẫn chỉ bỏ`).toBe("drop");
    expect(chargeFrame(b, T0 + 1).verdict).toBe("disconnect");
  });

  it("cửa sổ mới đặt lại bộ đếm", () => {
    let b = newFrameBudget(T0);
    for (let i = 0; i <= CALL_SIGNAL_FRAMES_PER_WINDOW; i += 1) b = chargeFrame(b, T0).budget;
    expect(chargeFrame(b, T0).verdict).toBe("drop");
    expect(chargeFrame(b, T0 + CALL_SIGNAL_FRAME_WINDOW_MS + 1).verdict).toBe("ok");
  });
});
