/**
 * S17-CHAT-UX2-QA-1 — `CreateRoomDialog` (CHAT-SCREEN-003): mở nhắn riêng · tạo nhóm.
 *
 * File này lấp một khoảng trống thật: trước QA-1, `CreateRoomDialog.tsx` là file DUY NHẤT của cụm
 * `components/chat` ở **0% toàn phần** — không spec nào chạm. Nghĩa là màn "tạo cuộc trò chuyện",
 * cửa vào của cả module, chưa từng được canh một luật nào.
 *
 * Ba luật đáng tiền nhất:
 *  (a) **Nhân viên `userId === null` không gửi được xuống server.** `hrEmployeeListItemSchema` cho
 *      phép `userId` null (nhân viên chưa liên kết tài khoản). Không có `userId` thì không có ai để
 *      nhắn. Nếu hàng đó KHÔNG bị khoá, client gửi `peerUserId: null` và người dùng nhận 422 khó
 *      hiểu ở màn danh bạ. Ca này đo CẢ BA vế của cách khoá: khoá hàng · nêu lý do · không tích.
 *  (b) **Chọn trùng không nhân đôi `memberUserIds`.** Gửi id lặp là để server tự dọn — mà server
 *      không hứa dọn.
 *  (c) **`description` rỗng thì KHÔNG có trong body**, không gửi chuỗi rỗng: `""` và "không khai" là
 *      hai ý nghĩa khác nhau ở DTO.
 *
 * `EmployeeMultiPickerDialog` được thay bằng test-double và ca gọi thẳng các prop của nó: danh bạ đã
 * có spec riêng, thứ WO này cần canh là **hợp đồng giữa hai bên** (khoá hàng nào · gửi gì đi).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto, HrEmployeeListItem } from "@mediaos/contracts";

const openDirect = vi.fn();
const createRoom = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    chatApi: {
      ...actual.chatApi,
      openDirect: (...a: unknown[]) => openDirect(...a),
      createRoom: (...a: unknown[]) => createRoom(...a),
    },
  };
});

/** Prop của lượt render picker gần nhất — ca gọi thẳng vào đây thay vì dựng lại danh bạ. */
type PickerProps = {
  title: string;
  selectionMode: "single" | "multi";
  isRowDisabled: (e: HrEmployeeListItem) => boolean;
  disabledBadge: string | ((e: HrEmployeeListItem) => string);
  disabledRowChecked?: (e: HrEmployeeListItem) => boolean;
  onAddOne: (e: HrEmployeeListItem) => Promise<unknown>;
  onBatchSettled: () => unknown;
  onClose: () => void;
};

let picker: PickerProps | null = null;

vi.mock("@/components/EmployeeMultiPickerDialog", () => ({
  EmployeeMultiPickerDialog: (props: PickerProps) => {
    picker = props;
    return <div data-testid="employee-picker">{props.title}</div>;
  },
}));

import { CreateRoomDialog } from "./CreateRoomDialog";

const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AN_ID = "11111111-1111-4111-8111-111111111111";
const BINH_ID = "22222222-2222-4222-8222-222222222222";

function employee(over: Partial<HrEmployeeListItem> = {}): HrEmployeeListItem {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    userId: AN_ID,
    employeeCode: "NV001",
    fullName: "Nguyễn Văn An",
    email: "an@test.local",
    orgUnitId: null,
    orgUnitName: null,
    positionId: null,
    positionName: null,
    workType: null,
    employmentType: null,
    status: "active",
    avatarUrl: null,
    startDate: null,
    officialDate: null,
    workLocation: null,
    gender: null,
    dateOfBirth: null,
    phone: null,
    contractType: null,
    baseSalary: null,
    identityNumber: null,
    identityIssueDate: null,
    identityIssuePlace: null,
    ...over,
  };
}

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: ROOM_ID,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Dự án Alpha",
    roomCode: "CHAT-ALPHA",
    description: null,
    lastMessageAt: null,
    lastMessageSeq: 0,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...over,
  } as ChatRoomDto;
}

function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <CreateRoomDialog onClose={onClose} onCreated={onCreated} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onClose, onCreated };
}

/** Chuyển sang tab "Tạo nhóm" rồi mở danh bạ. */
function openGroupPicker(): void {
  fireEvent.click(screen.getByRole("tab", { name: "Tạo nhóm" }));
  fireEvent.click(screen.getByRole("button", { name: "Chọn thành viên" }));
}

/** Thêm một người qua danh bạ (đường thật của picker: onAddOne rồi onBatchSettled). */
async function addViaPicker(e: HrEmployeeListItem): Promise<void> {
  await act(async () => {
    await picker!.onAddOne(e);
  });
}

beforeEach(() => {
  picker = null;
  openDirect.mockReset().mockResolvedValue(room({ roomType: "direct", name: null }));
  createRoom.mockReset().mockResolvedValue(room());
  cleanup();
});

describe("CreateRoomDialog — khung", () => {
  it("mở ở tab Nhắn riêng, chưa hiện nút tạo nhóm và chưa mở danh bạ", () => {
    renderDialog();

    expect(screen.getByText("Chọn một người để bắt đầu nhắn riêng.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tạo nhóm" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("employee-picker")).not.toBeInTheDocument();
  });

  it("nút Huỷ gọi onClose", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("danh bạ đóng lại sau khi xong một đợt thêm", async () => {
    renderDialog();
    openGroupPicker();
    expect(screen.getByTestId("employee-picker")).toBeInTheDocument();

    await act(async () => {
      await picker!.onBatchSettled();
    });

    expect(screen.queryByTestId("employee-picker")).not.toBeInTheDocument();
  });
});

describe("CreateRoomDialog — nhắn riêng", () => {
  it("chọn một người ⇒ openDirect đúng peerUserId, onCreated nhận phòng + tên người", async () => {
    const { onCreated } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Chọn người nhắn riêng" }));
    expect(picker!.selectionMode).toBe("single");

    await addViaPicker(employee());

    expect(openDirect).toHaveBeenCalledWith({ peerUserId: AN_ID });
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROOM_ID }),
        "Nguyễn Văn An",
      ),
    );
  });

  it("nhân viên CHƯA liên kết tài khoản: hàng bị khoá · nêu lý do · không tích", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Chọn người nhắn riêng" }));
    const nolink = employee({ userId: null, fullName: "Trần Chưa Có" });

    expect(picker!.isRowDisabled(nolink)).toBe(true);
    expect((picker!.disabledBadge as (e: HrEmployeeListItem) => string)(nolink)).toBe(
      "Chưa liên kết tài khoản",
    );
    expect(picker!.disabledRowChecked!(nolink)).toBe(false);
    // Đối chứng dương: người có tài khoản KHÔNG bị khoá — thiếu vế này thì một bản vá
    // `isRowDisabled: () => true` vẫn xanh (memory deny-cases-vacuous-without-allow-case).
    expect(picker!.isRowDisabled(employee())).toBe(false);
    expect(picker!.disabledRowChecked!(employee())).toBe(true);
  });

  it("ép thêm người không có userId ⇒ REJECT tại client, KHÔNG gọi server", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Chọn người nhắn riêng" }));

    await expect(picker!.onAddOne(employee({ userId: null }))).rejects.toThrow("no-user");
    expect(openDirect).not.toHaveBeenCalled();
  });

  it("openDirect lỗi ⇒ hiện lỗi ở vùng role=alert, KHÔNG gọi onCreated", async () => {
    openDirect.mockRejectedValue(new Error("500"));
    const { onCreated } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Chọn người nhắn riêng" }));

    await act(async () => {
      await picker!.onAddOne(employee()).catch(() => undefined);
    });

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Không mở được cuộc trò chuyện riêng."),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });
});

describe("CreateRoomDialog — tạo nhóm", () => {
  it("nút Tạo nhóm khoá khi tên rỗng hoặc chỉ khoảng trắng, mở khi có tên thật", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("tab", { name: "Tạo nhóm" }));
    const createBtn = screen.getByRole("button", { name: "Tạo nhóm" });
    expect(createBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "   " } });
    expect(createBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "Dự án Alpha" } });
    expect(createBtn).toBeEnabled();
  });

  it("gửi tên đã trim, roomType group, memberUserIds theo thứ tự chọn; description rỗng thì KHÔNG khai", async () => {
    const { onCreated } = renderDialog();
    openGroupPicker();
    await addViaPicker(employee());
    await addViaPicker(employee({ id: "b", userId: BINH_ID, fullName: "Lê Bình" }));
    expect(screen.getByText("Đã chọn 2 người")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "  Dự án Alpha  " } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));

    await waitFor(() => expect(createRoom).toHaveBeenCalledTimes(1));
    expect(createRoom).toHaveBeenCalledWith({
      name: "Dự án Alpha",
      roomType: "group",
      memberUserIds: [AN_ID, BINH_ID],
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.anything(), "Dự án Alpha"));
  });

  it("có mô tả ⇒ gửi description đã trim", async () => {
    renderDialog();
    fireEvent.click(screen.getByRole("tab", { name: "Tạo nhóm" }));
    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "Nhóm A" } });
    fireEvent.change(screen.getByLabelText("Mô tả"), { target: { value: "  Nhóm thử  " } });

    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Nhóm thử", memberUserIds: [] }),
      ),
    );
  });

  it("chọn TRÙNG một người ⇒ memberUserIds không nhân đôi, và hàng đó bị khoá kèm badge", async () => {
    renderDialog();
    openGroupPicker();
    await addViaPicker(employee());
    await addViaPicker(employee());

    expect(screen.getByText("Đã chọn 1 người")).toBeInTheDocument();
    expect(picker!.isRowDisabled(employee())).toBe(true);
    expect((picker!.disabledBadge as (e: HrEmployeeListItem) => string)(employee())).toBe(
      "Đã ở trong phòng",
    );

    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "Nhóm A" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ memberUserIds: [AN_ID] })),
    );
  });

  it("phòng trả về không có tên ⇒ onCreated dùng tên vừa nhập", async () => {
    createRoom.mockResolvedValue(room({ name: null }));
    const { onCreated } = renderDialog();
    fireEvent.click(screen.getByRole("tab", { name: "Tạo nhóm" }));
    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: " Nhóm B " } });

    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.anything(), "Nhóm B"));
  });

  it("createRoom lỗi ⇒ hiện lỗi ở vùng role=alert, KHÔNG gọi onCreated", async () => {
    createRoom.mockRejectedValue(new Error("500"));
    const { onCreated } = renderDialog();
    fireEvent.click(screen.getByRole("tab", { name: "Tạo nhóm" }));
    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "Nhóm A" } });

    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Không tạo được nhóm."),
    );
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("danh bạ tab nhóm mở ở chế độ multi (chọn nhiều người một lượt)", () => {
    renderDialog();
    openGroupPicker();

    expect(picker!.selectionMode).toBe("multi");
    expect(picker!.title).toBe("Chọn thành viên");
  });
});
