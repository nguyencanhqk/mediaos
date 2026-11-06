/**
 * S20-CHAT-MSGTOTASK-1 (US-CHAT-NV-10) — hộp «Tạo việc» từ một tin, mở chồng trên phòng chat.
 *
 * Mỗi `describe` một nhóm `done_when`: điền sẵn · lưu (chưa gọi API trước Lưu / thành công / lỗi) · chỉ chép
 * văn bản + tuỳ chọn gửi link · KPI #6 (đếm thao tác). Chỉ thao tác ô văn bản & select đã có option (tránh
 * race option nạp qua effect).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { ApiError, authApi, taskCoreApi, useAuthStore } from "@mediaos/web-core";
import { Toaster } from "@mediaos/ui";
import i18n from "@/i18n";
import { MessageToTaskDialog, type MessageToTaskDialogProps } from "./MessageToTaskDialog";

const openTask = vi.fn();
vi.mock("@/routes/tasks/task-drawer-nav", () => ({ useTaskDrawer: () => ({ openTask }) }));
vi.mock("@/hooks/use-dirty-form-guard", () => ({ useDirtyFormGuard: () => {} }));
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    taskCoreApi: { createTask: vi.fn(), updateTask: vi.fn() },
    taskProjectApi: { listProjects: vi.fn().mockResolvedValue([]) },
    authApi: { ...actual.authApi, me: vi.fn() },
    hrApi: {
      listDepartments: vi.fn().mockResolvedValue([]),
      listEmployees: vi.fn().mockResolvedValue({
        items: [{ id: "emp-002", fullName: "Trần Thị B" }],
        meta: {},
      }),
    },
  };
});

const ME_EMP = "emp-me-001";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const MSG_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ROOM = {
  id: ROOM_ID,
  roomType: "project",
  refId: PROJECT_ID,
  name: "Dự án Alpha",
} as const;
const DIRECT_ROOM = { id: ROOM_ID, roomType: "direct", refId: null, name: null } as const;
const BODY = "Gửi báo cáo tuần trước thứ Sáu\nNhớ kèm số liệu tháng 10";
// Giống-secret ghép chuỗi (CLAUDE.md §5) — URL ký giả lập của tệp đính kèm.
const SIGNED_URL = ["https://r2.example/chat/obj-9?X-Amz-Signature", "deadbeef"].join("=");

function meResponse() {
  return {
    id: "u1",
    companyId: "co-001",
    email: "nv@demo.local",
    fullName: "Lê Văn Tôi",
    status: "Active",
    capabilities: {},
    mustSetupTwoFactor: false,
    employee: {
      id: ME_EMP,
      employeeCode: null,
      fullName: "Lê Văn Tôi",
      departmentId: null,
      directManagerId: null,
      employmentStatus: "active",
    },
  } as never;
}

function renderDialog(props: Partial<MessageToTaskDialogProps> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const onSendTaskLink = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MessageToTaskDialog
          room={PROJECT_ROOM}
          message={{ id: MSG_ID, body: BODY, createdAt: "2026-11-06T03:05:00.000Z" }}
          senderName="Nguyễn Văn A"
          onClose={onClose}
          onSendTaskLink={onSendTaskLink}
          {...props}
        />
        <Toaster />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onClose, onSendTaskLink };
}

const field = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`không thấy ô #${id}`);
  return el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
};
const saveButton = () => screen.getByRole("button", { name: "Tạo" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authApi.me).mockResolvedValue(meResponse());
  vi.mocked(taskCoreApi.createTask).mockResolvedValue({
    id: TASK_ID,
    projectId: PROJECT_ID,
  } as never);
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: { "create:task": true, "read:employee": true },
    user: {
      id: "u1",
      email: "nv@demo.local",
      fullName: "Lê Văn Tôi",
      status: "Active",
      companyId: "co-001",
    },
  });
});

describe("điền sẵn từ tin", () => {
  it("phòng dự án: tiêu đề = dòng đầu, mô tả = văn bản + dòng nguồn + link ?msg=, dự án = refId, người thực hiện = tôi", async () => {
    renderDialog();
    expect(field("task-title")).toHaveValue("Gửi báo cáo tuần trước thứ Sáu");
    const description = (field("task-description") as HTMLTextAreaElement).value;
    expect(description.startsWith(BODY)).toBe(true);
    expect(description).toMatch(/Từ tin nhắn của Nguyễn Văn A lúc \d{2}\/11 \d{2}:05/);
    expect(description).toContain(`/chat/${ROOM_ID}?msg=${MSG_ID}`);
    expect(field("task-project")).toHaveValue(PROJECT_ID);
    await waitFor(() => expect(field("task-assignee")).toHaveValue(ME_EMP));
    expect(screen.queryByTestId("message-to-task-visibility-warning")).not.toBeInTheDocument();
  });

  it("dòng đầu dài ⇒ tiêu đề cắt còn 120 ký tự", () => {
    renderDialog({
      message: { id: MSG_ID, body: "a".repeat(300), createdAt: "2026-11-06T03:05:00.000Z" },
    });
    expect((field("task-title") as HTMLInputElement).value).toHaveLength(120);
  });

  it("tin chỉ có tệp ⇒ tiêu đề trống, bấm Lưu báo bắt buộc nhập, không gọi API", async () => {
    renderDialog({ message: { id: MSG_ID, body: null, createdAt: "2026-11-06T03:05:00.000Z" } });
    expect(field("task-title")).toHaveValue("");
    fireEvent.click(saveButton());
    expect(await screen.findByText("Tiêu đề là bắt buộc")).toBeInTheDocument();
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();
  });

  it("phòng direct ⇒ dự án trống + cảnh báo hiển thị nội dung, người thực hiện vẫn là tôi", async () => {
    renderDialog({ room: DIRECT_ROOM });
    expect(field("task-project")).toHaveValue("");
    expect(screen.getByTestId("message-to-task-visibility-warning")).toHaveTextContent(
      "Nội dung tin sẽ hiển thị cho những ai xem được việc này",
    );
    await waitFor(() => expect(field("task-assignee")).toHaveValue(ME_EMP));
  });
});

describe("lưu", () => {
  it("chưa gọi API nào tới khi bấm Lưu; lưu xong đóng hộp + toast «Đã tạo việc · Mở» mở drawer việc", async () => {
    const { onClose, onSendTaskLink } = renderDialog();
    await waitFor(() => expect(field("task-assignee")).toHaveValue(ME_EMP));
    expect(taskCoreApi.createTask).not.toHaveBeenCalled();

    fireEvent.click(saveButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCoreApi.createTask).mock.calls[0]?.[0]).toMatchObject({
      title: "Gửi báo cáo tuần trước thứ Sáu",
      projectId: PROJECT_ID,
      assigneeEmployeeId: ME_EMP,
    });
    expect(await screen.findByText("Đã tạo việc")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở" }));
    expect(openTask).toHaveBeenCalledWith(TASK_ID);
    // Mặc định TẮT ⇒ không gửi gì vào phòng.
    expect(onSendTaskLink).not.toHaveBeenCalled();
  });

  it("lưu lỗi (403) ⇒ không đóng, giữ dữ liệu, lỗi theo submitErrorKey", async () => {
    vi.mocked(taskCoreApi.createTask).mockRejectedValue(
      new ApiError(403, "FORBIDDEN", "không có quyền"),
    );
    const { onClose } = renderDialog();
    fireEvent.change(field("task-title"), { target: { value: "Tiêu đề đã sửa" } });
    fireEvent.click(saveButton());
    expect(
      await screen.findByText(i18n.t("tasks:tasks.form.errors.forbidden")),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(field("task-title")).toHaveValue("Tiêu đề đã sửa");
    expect((field("task-description") as HTMLTextAreaElement).value.startsWith(BODY)).toBe(true);
    expect(screen.queryByText("Đã tạo việc")).not.toBeInTheDocument();
  });

  it("lưu lỗi mạng ⇒ banner lỗi chung, hộp vẫn mở", async () => {
    vi.mocked(taskCoreApi.createTask).mockRejectedValue(new TypeError("Failed to fetch"));
    const { onClose } = renderDialog();
    fireEvent.click(saveButton());
    expect(await screen.findByText(i18n.t("tasks:tasks.form.errors.generic"))).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("chỉ chép văn bản · gửi link vào phòng", () => {
  it("mô tả không mang URL ký / objectKey / tên tệp — chỉ văn bản của tin", () => {
    // Prop `message` chỉ nhận id/body/createdAt; truyền thừa đính kèm để chứng minh không bị đọc.
    const withFile = {
      id: MSG_ID,
      body: "Xem tệp này",
      createdAt: "2026-11-06T03:05:00.000Z",
      attachments: [{ id: "f1", name: "bao-cao-q3.pdf", url: SIGNED_URL, objectKey: "chat/obj-9" }],
    };
    renderDialog({ message: withFile });
    const description = (field("task-description") as HTMLTextAreaElement).value;
    expect(description).not.toContain("bao-cao-q3.pdf");
    expect(description).not.toContain("X-Amz-Signature");
    expect(description).not.toContain("chat/obj-9");
  });

  it("bật «Gửi link việc vào phòng» ⇒ sau khi tạo gửi ĐÚNG URL /tasks/<id>", async () => {
    const { onSendTaskLink } = renderDialog();
    const checkbox = screen.getByRole("checkbox", { name: "Gửi link việc vào phòng" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(saveButton());
    await waitFor(() => expect(onSendTaskLink).toHaveBeenCalledTimes(1));
    expect(onSendTaskLink).toHaveBeenCalledWith(`${window.location.origin}/tasks/${TASK_ID}`);
  });

  it("caller không cho gửi (phòng lưu trữ) ⇒ không có tuỳ chọn", () => {
    renderDialog({ onSendTaskLink: undefined });
    expect(
      screen.queryByRole("checkbox", { name: "Gửi link việc vào phòng" }),
    ).not.toBeInTheDocument();
  });
});

describe("KPI #6 — đếm thao tác từ hộp đã mở tới Lưu (⋯ + «Tạo việc» = 2 thao tác, xem MessageActions.spec)", () => {
  const MENU_STEPS = 2;

  it("NV tự nhận: chỉ bấm Lưu ⇒ 2 + 1 = 3 thao tác (≤ 5)", async () => {
    let steps = MENU_STEPS;
    renderDialog();
    await waitFor(() => expect(field("task-assignee")).toHaveValue(ME_EMP));
    fireEvent.click(saveButton());
    steps += 1;
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(steps).toBe(3);
    expect(steps).toBeLessThanOrEqual(5);
  });

  it("QL giao người khác: đổi người thực hiện + Lưu ⇒ 2 + 2 = 4 thao tác (≤ 7)", async () => {
    let steps = MENU_STEPS;
    renderDialog();
    await screen.findByRole("option", { name: "Trần Thị B" });
    await waitFor(() => expect(field("task-assignee")).toHaveValue(ME_EMP));
    fireEvent.change(field("task-assignee"), { target: { value: "emp-002" } });
    steps += 1;
    fireEvent.click(saveButton());
    steps += 1;
    await waitFor(() => expect(taskCoreApi.createTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(taskCoreApi.createTask).mock.calls[0]?.[0]).toMatchObject({
      assigneeEmployeeId: "emp-002",
    });
    expect(steps).toBe(4);
    expect(steps).toBeLessThanOrEqual(7);
  });
});
