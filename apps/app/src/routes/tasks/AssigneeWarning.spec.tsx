import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { Toaster, toast } from "@mediaos/ui";
import type { TFunction } from "i18next";
import {
  formatAssigneeWarning,
  useAssigneeWarningToast,
  type AssigneeWarningNotice,
} from "./AssigneeWarning";

/**
 * S20-TASK-ASSIGNWARN-1 (US-TASK-QL-91) — cảnh báo «người được giao nghỉ phép / không phải thành
 * viên dự án» đi qua hệ thông báo chung (S20-FE-TOAST-1). Khoá: câu chữ theo từng mã, hạn nghỉ chỉ
 * hiện khi server trả, rỗng ⇒ im lặng, vùng `aria-live`, «Đổi người» với tới được bằng bàn phím và chỉ
 * có khi phía gọi cho phép đổi người.
 */

function Harness({
  notices,
  withToaster = true,
}: {
  notices: readonly AssigneeWarningNotice[];
  withToaster?: boolean;
}) {
  const notify = useAssigneeWarningToast();
  return (
    <>
      {notices.map((notice, index) => (
        <button key={index} type="button" onClick={() => notify(notice)}>
          {`notify-${index}`}
        </button>
      ))}
      {withToaster ? <Toaster /> : null}
    </>
  );
}

const ON_LEAVE = { kind: "onLeave", until: null } as const;
const NOT_MEMBER = { kind: "notMember", until: null } as const;

function notifyWith(notice: AssigneeWarningNotice) {
  render(<Harness notices={[notice]} />);
  fireEvent.click(screen.getByText("notify-0"));
  return screen.getByRole("status");
}

describe("useAssigneeWarningToast", () => {
  afterEach(() => toast.clear());

  it("nghỉ phép, server KHÔNG trả hạn ⇒ câu không kèm ngày, nằm trong vùng aria-live polite", () => {
    const live = notifyWith({ taskId: "t1", warnings: [ON_LEAVE], assigneeName: "Trần Thị B" });

    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Trần Thị B nghỉ phép vào ngày hạn của việc");
    expect(live).not.toHaveTextContent("nghỉ đến");
  });

  it("nghỉ phép, server trả hạn ⇒ kèm «(nghỉ đến dd/MM)»", () => {
    const live = notifyWith({
      taskId: "t1",
      warnings: [{ kind: "onLeave", until: "2026-10-30" }],
      assigneeName: "Trần Thị B",
    });

    expect(live).toHaveTextContent("Trần Thị B nghỉ phép vào ngày hạn của việc (nghỉ đến 30/10)");
  });

  it("không phải thành viên dự án ⇒ câu tương ứng", () => {
    const live = notifyWith({ taskId: "t1", warnings: [NOT_MEMBER], assigneeName: "Trần Thị B" });

    expect(live).toHaveTextContent("Trần Thị B không phải thành viên dự án");
    expect(live).not.toHaveTextContent("nghỉ phép");
  });

  it("cả hai mã ⇒ MỘT thông báo gộp hai ý, tên người chỉ nêu một lần", () => {
    const live = notifyWith({
      taskId: "t1",
      warnings: [ON_LEAVE, NOT_MEMBER],
      assigneeName: "Trần Thị B",
    });

    expect(within(live).getAllByText(/Trần Thị B/)).toHaveLength(1);
    expect(live).toHaveTextContent(
      "Trần Thị B nghỉ phép vào ngày hạn của việc · không phải thành viên dự án",
    );
  });

  // Câu tiếp theo KHÔNG được dựng bằng khoá có {{name}} với name rỗng rồi trim — cách đó chỉ đúng khi
  // MỌI bản dịch mở đầu bằng {{name}}. Khoá `t` giả ghi lại khoá + tham số để khoá chặt điều đó.
  it("câu thứ hai dùng khoá riêng KHÔNG có chủ ngữ (không phụ thuộc vị trí {{name}} trong bản dịch)", () => {
    const calls: Array<{ key: string; options: Record<string, unknown> | undefined }> = [];
    const fakeT = ((key: string, options?: Record<string, unknown>) => {
      calls.push({ key, options });
      return `[${key}]`;
    }) as unknown as TFunction<"tasks">;

    const message = formatAssigneeWarning(
      fakeT,
      [{ kind: "onLeave", until: "2026-10-30" }, NOT_MEMBER],
      "Trần Thị B",
    );

    expect(message).toBe("[assigneeWarning.onLeaveUntil] · [assigneeWarning.continued.notMember]");
    expect(calls.some((call) => call.options?.name === "")).toBe(false);

    const reversed = formatAssigneeWarning(
      fakeT,
      [NOT_MEMBER, { kind: "onLeave", until: "2026-10-30" }],
      "Trần Thị B",
    );
    expect(reversed).toBe("[assigneeWarning.notMember] · [assigneeWarning.continued.onLeaveUntil]");
  });

  it("thứ tự ngược (không thành viên trước) ⇒ câu thật vẫn liền mạch, tên nêu một lần", () => {
    const live = notifyWith({
      taskId: "t1",
      warnings: [NOT_MEMBER, { kind: "onLeave", until: "2026-10-30" }],
      assigneeName: "Trần Thị B",
    });

    expect(within(live).getAllByText(/Trần Thị B/)).toHaveLength(1);
    expect(live).toHaveTextContent(
      "Trần Thị B không phải thành viên dự án · nghỉ phép vào ngày hạn của việc (nghỉ đến 30/10)",
    );
  });

  it("vắng tên người nhận ⇒ dùng nhãn chung, không in «null»/«undefined»", () => {
    const live = notifyWith({ taskId: "t1", warnings: [NOT_MEMBER], assigneeName: null });

    expect(live).toHaveTextContent("Người được giao không phải thành viên dự án");
    expect(live).not.toHaveTextContent(/null|undefined/);
  });

  it("warnings rỗng ⇒ KHÔNG có thông báo", () => {
    const live = notifyWith({ taskId: "t1", warnings: [], assigneeName: "Trần Thị B" });

    expect(live).toBeEmptyDOMElement();
  });

  it("«Đổi người» với tới bằng bàn phím (F8) và gọi đúng hành động rồi đóng thông báo", () => {
    const onChangeAssignee = vi.fn();
    const live = notifyWith({
      taskId: "t1",
      warnings: [ON_LEAVE],
      assigneeName: "Trần Thị B",
      onChangeAssignee,
    });

    const action = within(live).getByRole("button", { name: "Đổi người" });
    act(() => {
      fireEvent.keyDown(document, { key: "F8" });
    });
    expect(action).toHaveFocus();

    fireEvent.click(action);
    expect(onChangeAssignee).toHaveBeenCalledTimes(1);
    expect(live).toBeEmptyDOMElement();
  });

  it("phía gọi KHÔNG cho đổi người (thiếu quyền giao) ⇒ cảnh báo không có «Đổi người»", () => {
    const live = notifyWith({ taskId: "t1", warnings: [ON_LEAVE], assigneeName: "Trần Thị B" });

    expect(live).toHaveTextContent("nghỉ phép");
    expect(within(live).queryByRole("button", { name: "Đổi người" })).not.toBeInTheDocument();
  });

  it("giao lại (kể cả lần sau không cảnh báo) ⇒ cảnh báo CŨ của cùng việc tự đóng, không đọng tên cũ", () => {
    render(
      <Harness
        notices={[
          { taskId: "t1", warnings: [ON_LEAVE], assigneeName: "Trần Thị B" },
          { taskId: "t1", warnings: [], assigneeName: "Nguyễn Văn C" },
        ]}
      />,
    );
    const live = screen.getByRole("status");

    fireEvent.click(screen.getByText("notify-0"));
    expect(live).toHaveTextContent("Trần Thị B");

    fireEvent.click(screen.getByText("notify-1"));
    expect(live).toBeEmptyDOMElement();
  });

  it("ô giao việc rời màn ⇒ cảnh báo của nó tự đóng (không để lại «Đổi người» không mở được gì)", () => {
    render(<Toaster />);
    const field = render(
      <Harness
        withToaster={false}
        notices={[{ taskId: "t1", warnings: [ON_LEAVE], assigneeName: "Trần Thị B" }]}
      />,
    );
    const live = screen.getByRole("status");
    fireEvent.click(screen.getByText("notify-0"));
    expect(live).toHaveTextContent("Trần Thị B");

    field.unmount();
    expect(live).toBeEmptyDOMElement();
  });
});
