/**
 * S7-CHAT-FE-2 — hàm thuần của trang chat.
 *
 * Nhóm `splitTextWithLinks` là nhóm QUAN TRỌNG NHẤT file này: nó là ranh giới giữa "nội dung người dùng
 * gõ" và "thứ trình duyệt thực thi". Mọi ca ở đó phải đọc được như một lời khẳng định bảo mật, không
 * phải như một bài kiểm tra regex.
 */
import { describe, expect, it } from "vitest";
import type { ChatMessageDto } from "@mediaos/contracts";
import {
  canRecallMessage,
  dayKeyOf,
  formatClock,
  formatDayLabel,
  formatFileSize,
  initialsOf,
  formatRelativeTime,
  roomDisplayName,
  splitTextWithLinks,
} from "./chat-format";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("splitTextWithLinks — ranh giới nội dung người dùng", () => {
  it("KHÔNG bao giờ trả đoạn `link` cho `javascript:` (allowlist http/https, không phải blocklist)", () => {
    const segments = splitTextWithLinks("bấm vào javascript:alert(1) đi");
    expect(segments.every((s) => s.kind === "text")).toBe(true);
    // Toàn bộ chuỗi vẫn còn nguyên — không nuốt mất chữ của người dùng.
    expect(segments.map((s) => s.value).join("")).toBe("bấm vào javascript:alert(1) đi");
  });

  it("KHÔNG linkify `data:` URI (vector nhúng HTML)", () => {
    const body = "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==";
    expect(splitTextWithLinks(body)).toEqual([{ kind: "text", value: body }]);
  });

  it("payload HTML giữ NGUYÊN dạng chữ — hàm không sinh thẻ nào", () => {
    const body = '<img src=x onerror="alert(1)">';
    const segments = splitTextWithLinks(body);
    expect(segments).toEqual([{ kind: "text", value: body }]);
  });

  it("http/https thành đoạn `link`; phần chữ quanh nó giữ nguyên", () => {
    expect(splitTextWithLinks("xem https://mediaos.vn/a nhé")).toEqual([
      { kind: "text", value: "xem " },
      { kind: "link", value: "https://mediaos.vn/a" },
      { kind: "text", value: " nhé" },
    ]);
  });

  it("dấu câu cuối câu KHÔNG bị nuốt vào href", () => {
    expect(splitTextWithLinks("tại https://mediaos.vn/bao-cao.")).toEqual([
      { kind: "text", value: "tại " },
      { kind: "link", value: "https://mediaos.vn/bao-cao" },
      { kind: "text", value: "." },
    ]);
  });

  it("nhiều liên kết trong một tin", () => {
    const segments = splitTextWithLinks("https://a.vn và https://b.vn");
    expect(segments.filter((s) => s.kind === "link").map((s) => s.value)).toEqual([
      "https://a.vn",
      "https://b.vn",
    ]);
  });

  it("chuỗi rỗng ⇒ mảng rỗng", () => {
    expect(splitTextWithLinks("")).toEqual([]);
  });
});

describe("roomDisplayName", () => {
  const fallback = (code: string) => `DM · ${code}`;

  it("phòng direct: lấy tên NGƯỜI CÒN LẠI, không phải mình", () => {
    const name = roomDisplayName(
      { name: null, roomType: "direct", roomCode: "CHAT-0009" },
      [
        { userId: ME, userName: "Tôi" },
        { userId: OTHER, userName: "Nguyễn Văn A" },
      ],
      ME,
      fallback,
    );
    expect(name).toBe("Nguyễn Văn A");
  });

  it("phòng direct CHƯA có members (danh sách phòng không kèm) ⇒ nhãn mã phòng, KHÔNG bịa tên", () => {
    expect(
      roomDisplayName(
        { name: null, roomType: "direct", roomCode: "CHAT-0009" },
        undefined,
        ME,
        fallback,
      ),
    ).toBe("DM · CHAT-0009");
  });

  it("phòng nhóm: dùng `name`; thiếu name ⇒ nhãn mã phòng", () => {
    expect(
      roomDisplayName({ name: "Dự án Alpha", roomType: "group", roomCode: "C1" }, [], ME, fallback),
    ).toBe("Dự án Alpha");
    expect(
      roomDisplayName({ name: null, roomType: "group", roomCode: "C1" }, [], ME, fallback),
    ).toBe("DM · C1");
  });

  // ── S17-CHAT-UX2-FE-1 — `room.peer` thay hẳn cache `resolvedNames` ────────────────────────────
  const PEER = {
    userId: OTHER,
    name: "Nguyễn Văn A",
    avatarUrl: null,
    isActive: true,
  };

  it("direct có `peer.name` mà KHÔNG có members ⇒ ra tên peer (DM có tên ở khung hình ĐẦU)", () => {
    expect(
      roomDisplayName(
        { name: null, roomType: "direct", roomCode: "CHAT-0009", peer: PEER },
        undefined,
        ME,
        fallback,
      ),
    ).toBe("Nguyễn Văn A");
  });

  /**
   * Thứ tự nguồn LÀ hợp đồng: `members` (phòng đang MỞ, nguồn tươi nhất) đứng TRƯỚC `peer`. Đảo lại là
   * đổi hành vi của `ConversationPanel` — một màn ngoài phạm vi WO — để tiện cho màn trong phạm vi.
   */
  it("có CẢ members lẫn peer ⇒ `members` THẮNG", () => {
    expect(
      roomDisplayName(
        { name: null, roomType: "direct", roomCode: "CHAT-0009", peer: PEER },
        [
          { userId: ME, userName: "Tôi" },
          { userId: OTHER, userName: "Tên từ roster" },
        ],
        ME,
        fallback,
      ),
    ).toBe("Tên từ roster");
  });

  it("`peer.name` null (không tra được `users`) ⇒ vẫn tụt về nhãn mã phòng, KHÔNG ra chuỗi rỗng", () => {
    expect(
      roomDisplayName(
        { name: null, roomType: "direct", roomCode: "CHAT-0009", peer: { ...PEER, name: null } },
        undefined,
        ME,
        fallback,
      ),
    ).toBe("DM · CHAT-0009");
  });

  it("phòng NHÓM KHÔNG bao giờ đọc `peer` (peer của phòng 200 người là vô nghĩa)", () => {
    expect(
      roomDisplayName(
        { name: null, roomType: "group", roomCode: "C1", peer: PEER },
        undefined,
        ME,
        fallback,
      ),
    ).toBe("DM · C1");
  });
});

/**
 * S17-CHAT-UX2-FE-1 — thời gian TƯƠNG ĐỐI của dòng phòng.
 *
 * `now` tiêm được nên KHÔNG cần dịch đồng hồ: fake timers làm vỡ `socket.io-client` ở các spec khác
 * cùng module (memory `fake-timers-break-socketio-client-emit`).
 */
describe("formatRelativeTime", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");

  it("khoảng cách ngày/tuần ra chữ Việt, KHÔNG kèm hậu tố «trước» (cột 320px)", () => {
    expect(formatRelativeTime("2026-08-08T12:00:00.000Z", now)).toBe("2 ngày");
    expect(formatRelativeTime("2026-08-03T12:00:00.000Z", now)).toBe("7 ngày");
    expect(formatRelativeTime("2026-08-10T11:55:00.000Z", now)).toBe("5 phút");
  });

  it("mốc KHÔNG hợp lệ ⇒ chuỗi rỗng, không phải «Invalid Date»", () => {
    expect(formatRelativeTime("khong-phai-ngay", now)).toBe("");
  });

  it("`now` thực sự được dùng — hai mốc `now` khác nhau cho hai kết quả khác nhau", () => {
    const iso = "2026-08-08T12:00:00.000Z";
    expect(formatRelativeTime(iso, now)).not.toBe(
      formatRelativeTime(iso, new Date("2026-09-08T12:00:00.000Z")),
    );
  });
});

describe("canRecallMessage (SPEC-15 §13.6) — chỉ để ẩn/hiện nút, cổng thật ở server", () => {
  const base: Pick<ChatMessageDto, "senderId" | "createdAt" | "recalledAt" | "messageType"> = {
    senderId: ME,
    createdAt: "2026-08-04T10:00:00.000Z",
    recalledAt: null,
    messageType: "text",
  };
  const now = new Date("2026-08-04T10:10:00.000Z"); // +10 phút

  it("người gửi TRONG cửa sổ 15 phút ⇒ được", () => {
    expect(
      canRecallMessage({ message: base, myUserId: ME, myRole: "member", roomType: "group", now }),
    ).toBe(true);
  });

  it("người gửi NGOÀI cửa sổ ⇒ không", () => {
    expect(
      canRecallMessage({
        message: base,
        myUserId: ME,
        myRole: "member",
        roomType: "group",
        now: new Date("2026-08-04T10:16:00.000Z"),
      }),
    ).toBe(false);
  });

  it("admin phòng NHÓM ⇒ được bất kỳ lúc nào, kể cả tin người khác", () => {
    expect(
      canRecallMessage({
        message: { ...base, senderId: OTHER },
        myUserId: ME,
        myRole: "admin",
        roomType: "group",
        now: new Date("2027-01-01T00:00:00.000Z"),
      }),
    ).toBe(true);
  });

  it("admin nhưng phòng DIRECT ⇒ không (vai trò admin chỉ có nghĩa trong phòng nhóm)", () => {
    expect(
      canRecallMessage({
        message: { ...base, senderId: OTHER },
        myUserId: ME,
        myRole: "admin",
        roomType: "direct",
        now,
      }),
    ).toBe(false);
  });

  it("tin ĐÃ thu hồi / tin hệ thống ⇒ không", () => {
    expect(
      canRecallMessage({
        message: { ...base, recalledAt: "2026-08-04T10:05:00.000Z" },
        myUserId: ME,
        myRole: "admin",
        roomType: "group",
        now,
      }),
    ).toBe(false);
    expect(
      canRecallMessage({
        message: { ...base, messageType: "system" },
        myUserId: ME,
        myRole: "admin",
        roomType: "group",
        now,
      }),
    ).toBe(false);
  });
});

describe("mốc thời gian + cỡ tệp", () => {
  it("formatClock trả HH:mm; mốc hỏng ⇒ chuỗi rỗng, KHÔNG 'Invalid Date'", () => {
    expect(formatClock("2026-08-04T09:05:00.000Z")).toMatch(/^\d{2}:\d{2}$/);
    expect(formatClock("không-phải-ngày")).toBe("");
  });

  it("dayKeyOf theo giờ ĐỊA PHƯƠNG — cùng ngày địa phương thì cùng khoá", () => {
    const local = new Date(2026, 7, 4, 23, 30);
    expect(dayKeyOf(local.toISOString())).toBe("2026-08-04");
  });

  it("formatDayLabel: hôm nay / hôm qua / dd/MM/yyyy", () => {
    const now = new Date(2026, 7, 4, 12, 0);
    const labels = { today: "Hôm nay", yesterday: "Hôm qua" };
    expect(formatDayLabel(new Date(2026, 7, 4, 8, 0).toISOString(), labels, now)).toBe("Hôm nay");
    expect(formatDayLabel(new Date(2026, 7, 3, 8, 0).toISOString(), labels, now)).toBe("Hôm qua");
    expect(formatDayLabel(new Date(2026, 6, 30, 8, 0).toISOString(), labels, now)).toBe(
      "30/07/2026",
    );
  });

  it("formatFileSize dùng 1024, 1 chữ số thập phân từ KB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.0 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatFileSize(-1)).toBe("");
  });

  it("initialsOf: rỗng/khoảng trắng ⇒ '?', không trả chuỗi rỗng làm ô trống", () => {
    expect(initialsOf("Nguyễn Văn An")).toBe("A");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf(null)).toBe("?");
  });
});
