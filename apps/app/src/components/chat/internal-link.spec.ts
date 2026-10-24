/**
 * S20-CHAT-INTERNALLINK-1 (US-X-11) — bộ phân loại link THUẦN. Bảng ca theo done_when 4: nội bộ · ngoài ·
 * khác origin · gạch chéo ngược · ngoài allowlist · scheme lạ · href tương đối.
 *
 * Mọi ca «KHÔNG nội bộ» đều có ca đối chứng nội bộ CÙNG dạng ở trên: một bộ phân loại luôn trả `null` sẽ
 * xanh hết các ca từ chối, nên nhóm «nội bộ» là thứ chứng minh phép từ chối có ý nghĩa.
 */
import { describe, expect, it } from "vitest";
import { classifyInternalLink } from "./internal-link";

const O = "https://app.mediaos.test";
const TASK = "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const ROOM = "2e3f4051-6b7c-4d8e-9f0a-1b2c3d4e5f60";
const MSG = "3f405162-7c8d-4e9f-8a1b-2c3d4e5f6071";
const GOAL = "40516273-8d9e-4f0a-9b2c-3d4e5f607182";

describe("classifyInternalLink — đích NỘI BỘ (cùng origin + khớp allowlist)", () => {
  it("`/tasks/<uuid>` ⇒ drawer việc", () => {
    expect(classifyInternalLink(`${O}/tasks/${TASK}`, O)).toEqual({ kind: "task", taskId: TASK });
    expect(classifyInternalLink(`${O}/tasks/${TASK}/`, O)).toEqual({ kind: "task", taskId: TASK });
  });

  it("UUID viết hoa vẫn nhận (id giữ nguyên chữ người gửi gõ)", () => {
    const upper = TASK.toUpperCase();
    expect(classifyInternalLink(`${O}/tasks/${upper}`, O)).toEqual({ kind: "task", taskId: upper });
  });

  it("`/chat/<uuid>` ⇒ phòng; `?msg=` chỉ giữ khi là UUID", () => {
    expect(classifyInternalLink(`${O}/chat/${ROOM}?msg=${MSG}`, O)).toEqual({
      kind: "chat-room",
      roomId: ROOM,
      messageId: MSG,
    });
    expect(classifyInternalLink(`${O}/chat/${ROOM}?msg=khong-phai-uuid`, O)).toEqual({
      kind: "chat-room",
      roomId: ROOM,
      messageId: null,
    });
  });

  it.each([
    [`${O}/goals/${GOAL}`, `/goals/${GOAL}`],
    [`${O}/tasks/projects/${GOAL}`, `/tasks/projects/${GOAL}`],
    [`${O}/notifications`, "/notifications"],
    [`${O}/notifications?source=CHAT`, "/notifications?source=CHAT"],
    [`${O}/notifications/${GOAL}`, `/notifications/${GOAL}`],
    // Mảnh `#` không đi theo: router không dùng nó, và đích vẫn là đúng trang đã khớp allowlist.
    [`${O}/goals/${GOAL}#binh-luan`, `/goals/${GOAL}`],
  ])("%s ⇒ điều hướng router tới %s", (href, expected) => {
    expect(classifyInternalLink(href, O)).toEqual({ kind: "route", href: expected });
  });
});

describe("classifyInternalLink — KHÔNG nội bộ", () => {
  it.each([
    ["link ngoài", `https://example.com/tasks/${TASK}`],
    ["khác scheme (http vs https)", `http://app.mediaos.test/tasks/${TASK}`],
    ["khác cổng", `https://app.mediaos.test:8443/tasks/${TASK}`],
    ["tên miền chỉ có cùng tiền tố", `https://app.mediaos.test.example.com/tasks/${TASK}`],
    ["tên miền con", `https://x.app.mediaos.test/tasks/${TASK}`],
  ])("khác origin — %s", (_label, href) => {
    expect(classifyInternalLink(href, O)).toBeNull();
  });

  it.each([
    ["`\\` giữa đường", `${O}/tasks\\${TASK}`],
    ["`\\` ngay sau host", `${O}\\tasks/${TASK}`],
    ["`%5C` viết hoa", `${O}/tasks/%5C${TASK}`],
    ["`%5c` viết thường", `${O}/tasks/%5c${TASK}`],
    ["`\\` trong tham số", `${O}/chat/${ROOM}?msg=\\${MSG}`],
  ])("gạch chéo ngược — %s", (_label, href) => {
    expect(classifyInternalLink(href, O)).toBeNull();
  });

  it.each([
    ["`//` đầu đường dẫn", `${O}//example.com/tasks/${TASK}`],
    ["trang không trong allowlist", `${O}/admin/users`],
    ["`/tasks/my-tasks` (không phải id việc)", `${O}/tasks/my-tasks`],
    ["id không phải UUID", `${O}/tasks/123`],
    ["đuôi thừa sau id", `${O}/tasks/${TASK}/edit`],
    ["`/goals/new`", `${O}/goals/new`],
    ["`/chat` trần", `${O}/chat`],
    ["gốc ứng dụng", `${O}/`],
  ])("ngoài allowlist — %s", (_label, href) => {
    expect(classifyInternalLink(href, O)).toBeNull();
  });

  it.each([
    ["href tương đối", `/tasks/${TASK}`],
    ["không parse được", "không phải url"],
    ["chuỗi rỗng", ""],
    ["javascript:", "javascript:alert(1)"],
    ["scheme khác http(s) cùng host", `ftp://app.mediaos.test/tasks/${TASK}`],
  ])("không phải URL http(s) tuyệt đối — %s", (_label, href) => {
    expect(classifyInternalLink(href, O)).toBeNull();
  });

  it("URL có phần người dùng trước host ⇒ không nội bộ (dạng hay dùng để giả tên miền)", () => {
    const withUser = O.replace("://", "://nguoi-dung@");
    expect(classifyInternalLink(`${withUser}/tasks/${TASK}`, O)).toBeNull();
  });

  it("origin trang là `null` (khung sandbox) ⇒ không link nào là nội bộ", () => {
    expect(classifyInternalLink(`${O}/tasks/${TASK}`, "null")).toBeNull();
  });
});
