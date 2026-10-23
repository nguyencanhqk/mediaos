/**
 * S17-CHAT-UX2-QA-1 → **S20-CHAT-NEWROOM-1** — `CreateRoomDialog` (CHAT-SCREEN-003): nhắn riêng · tạo nhóm.
 *
 * S20 bỏ dialog chọn người thứ hai: ô tìm NHÚNG thẳng trong dialog, tab «Nhóm» có dải chip «Gần đây» lấy
 * từ người đối thoại của các DM đã nạp sẵn ở `chat.store`, và tên nhóm tự gợi ý khi chưa gõ
 * (US-CHAT-NV-12 · NV-91).
 *
 * Luật đáng tiền giữ lại từ QA-1:
 *  (a) **Nhân viên `userId === null` không gửi được xuống server** — hàng bị khoá kèm lý do.
 *  (b) **Chọn trùng không nhân đôi `memberUserIds`.**
 *  (c) **`description` rỗng thì KHÔNG có trong body.**
 * Luật mới của S20:
 *  (d) «Gần đây» KHÔNG gọi API nào — chỉ đọc store; ô tìm chỉ gọi `GET /hr/employees` (đúng endpoint danh
 *      bạ cũ, server lọc theo scope), không có đường «tìm hộ» nào khác.
 *  (e) Xoá trắng tên ⇒ lỗi tại ô, KHÔNG gửi request; chưa gõ ⇒ tên gợi ý thoả `min(1)`.
 *  (f) Server từ chối ⇒ dialog GIỮ lựa chọn và nói rõ ai không thêm được.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import i18n from "@/i18n";
import type { ChatRoomDto, HrEmployeeListItem } from "@mediaos/contracts";

const openDirect = vi.fn();
const createRoom = vi.fn();
const listEmployees = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    chatApi: {
      ...actual.chatApi,
      openDirect: (...a: unknown[]) => openDirect(...a),
      createRoom: (...a: unknown[]) => createRoom(...a),
    },
    hrApi: {
      ...actual.hrApi,
      listEmployees: (...a: unknown[]) => listEmployees(...a),
    },
  };
});

import { ApiError } from "@mediaos/web-core";
import { useChatStore } from "@/stores/chat.store";
import { CreateRoomDialog } from "./CreateRoomDialog";

const ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "99999999-9999-4999-8999-999999999999";
const LAN = "11111111-1111-4111-8111-111111111111";
const MINH = "22222222-2222-4222-8222-222222222222";
const HA = "33333333-3333-4333-8333-333333333333";
const TU = "44444444-4444-4444-8444-444444444444";
const AN = "55555555-5555-4555-8555-555555555555";

function employee(over: Partial<HrEmployeeListItem> = {}): HrEmployeeListItem {
  return {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    userId: AN,
    employeeCode: "NV001",
    fullName: "Nguyễn Văn An",
    email: "an@test.local",
    orgUnitId: null,
    orgUnitName: "Phòng Kế toán",
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

function page(items: HrEmployeeListItem[]) {
  return {
    items,
    meta: {
      page: 1,
      pageSize: 8,
      total: items.length,
      totalPages: 1,
      hasNext: false,
      hasPrev: false,
    },
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

/** Một DM đã nạp sẵn ở store — nguồn DUY NHẤT của «Gần đây». Mốc tin cuối giảm dần = thứ tự danh sách. */
function dm(userId: string, name: string, minutesAgo: number, isActive = true): ChatRoomDto {
  return room({
    id: `d${userId.slice(1)}`,
    roomType: "direct",
    name: null,
    roomCode: `CHAT-D-${name}`,
    lastMessageAt: new Date(Date.UTC(2026, 9, 1, 12, 0) - minutesAgo * 60_000).toISOString(),
    peer: { userId, name, avatarUrl: null, isActive },
  });
}

function seedFourDms(): void {
  useChatStore
    .getState()
    .syncRoomList(
      [
        dm(LAN, "Trần Thị Lan", 1),
        dm(MINH, "Lê Văn Minh", 2),
        dm(HA, "Phạm Thu Hà", 3),
        dm(TU, "Đỗ Anh Tú", 4),
      ],
      false,
    );
}

function renderDialog(props: Partial<Parameters<typeof CreateRoomDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <CreateRoomDialog onClose={onClose} onCreated={onCreated} {...props} />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onClose, onCreated };
}

function goGroup(): void {
  fireEvent.click(screen.getByRole("tab", { name: "Tạo nhóm" }));
}

function typeSearch(text: string): void {
  fireEvent.change(screen.getByRole("searchbox", { name: "Tìm người" }), {
    target: { value: text },
  });
}

/** Nút của MỘT kết quả tìm — khoanh trong danh sách kết quả (chip «Gần đây» và «Bỏ …» cũng mang tên người). */
async function result(name: RegExp): Promise<HTMLElement> {
  const list = await screen.findByRole("list", { name: "Kết quả tìm người" });
  return within(list).getByRole("button", { name });
}

function clickCreate(): void {
  fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm" }));
}

beforeEach(() => {
  cleanup();
  openDirect.mockReset().mockResolvedValue(room({ roomType: "direct", name: null }));
  createRoom.mockReset().mockResolvedValue(room());
  listEmployees.mockReset().mockResolvedValue(page([employee()]));
  useChatStore.getState().resetChatStore();
  useChatStore.getState().setMyUserId(ME);
});

describe("CreateRoomDialog — khung", () => {
  it("mở ở tab Nhắn riêng với ô tìm NHÚNG (không có dialog thứ hai), chưa gọi danh bạ khi chưa gõ", () => {
    renderDialog();

    expect(screen.getByRole("searchbox", { name: "Tìm người" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Tạo nhóm" })).not.toBeInTheDocument();
    expect(listEmployees).not.toHaveBeenCalled();
  });

  it("nút Huỷ gọi onClose", () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Huỷ" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CreateRoomDialog — nhắn riêng", () => {
  it("gõ tên → chọn ⇒ openDirect đúng peerUserId, onCreated nhận phòng + tên người", async () => {
    const { onCreated } = renderDialog();
    typeSearch("An");

    fireEvent.click(await result(/Nguyễn Văn An/));

    // `mutate` gọi `mutationFn` sau vài microtask (TanStack Query v5) ⇒ chờ, không khẳng định đồng bộ.
    await waitFor(() => expect(openDirect).toHaveBeenCalledWith({ peerUserId: AN }));
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(
        expect.objectContaining({ id: ROOM_ID }),
        "Nguyễn Văn An",
      ),
    );
    // Ô tìm gọi ĐÚNG endpoint danh bạ với từ khoá, không có đường «tìm hộ» nào khác.
    expect(listEmployees).toHaveBeenCalledWith(expect.objectContaining({ search: "An" }));
  });

  it("nhân viên CHƯA liên kết tài khoản ⇒ hàng khoá · nêu lý do · bấm KHÔNG gọi server", async () => {
    listEmployees.mockResolvedValue(page([employee({ userId: null, fullName: "Hồ Văn Khách" })]));
    renderDialog();
    typeSearch("Khách");

    const row = await result(/Hồ Văn Khách/);
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent("Chưa liên kết tài khoản");
    fireEvent.click(row);
    expect(openDirect).not.toHaveBeenCalled();
  });

  it("openDirect lỗi ⇒ dialog còn, lỗi nêu tên người, KHÔNG gọi onCreated", async () => {
    openDirect.mockRejectedValue(new ApiError(422, "CHAT-ERR-003", "CHAT-ERR-003"));
    const { onCreated } = renderDialog();
    typeSearch("An");

    fireEvent.click(await result(/Nguyễn Văn An/));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Nguyễn Văn An"));
    expect(onCreated).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("danh bạ chỉ trả về CHÍNH MÌNH (scope Own) ⇒ «Không tìm thấy trong danh bạ bạn được xem»", async () => {
    listEmployees.mockResolvedValue(page([employee({ userId: ME, fullName: "Tôi Đây" })]));
    renderDialog();
    typeSearch("Bình");

    expect(
      await screen.findByText("Không tìm thấy trong danh bạ bạn được xem."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tôi Đây/ })).not.toBeInTheDocument();
    // Trang /chat (không phải drawer) ⇒ không kèm gợi ý của drawer.
    expect(screen.queryByText(/Nhắn riêng từ một phòng chung/i)).not.toBeInTheDocument();
  });
});

describe("CreateRoomDialog — nhóm: «Gần đây» + tên gợi ý (US-CHAT-NV-12)", () => {
  it("có DM với 4 người ⇒ cả 4 ở «Gần đây»; chạm để thêm/bỏ — KHÔNG gọi API nào", () => {
    seedFourDms();
    renderDialog();
    goGroup();

    const recent = screen.getByRole("group", { name: "Gần đây" });
    for (const name of ["Trần Thị Lan", "Lê Văn Minh", "Phạm Thu Hà", "Đỗ Anh Tú"]) {
      expect(recent).toHaveTextContent(name);
    }
    const lan = screen.getByTestId(`chat-create-recent-${LAN}`);
    fireEvent.click(lan);
    expect(lan).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(lan);
    expect(lan).toHaveAttribute("aria-pressed", "false");
    expect(listEmployees).not.toHaveBeenCalled();
  });

  it("chọn 4 chip, chưa gõ tên ⇒ tạo với tên gợi ý «Lan, Minh, Hà +1», thành viên theo thứ tự chọn", async () => {
    seedFourDms();
    const { onCreated } = renderDialog();
    goGroup();
    for (const id of [LAN, MINH, HA, TU])
      fireEvent.click(screen.getByTestId(`chat-create-recent-${id}`));

    expect(screen.getByLabelText("Tên nhóm")).toHaveValue("Lan, Minh, Hà +1");
    clickCreate();

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith({
        name: "Lan, Minh, Hà +1",
        roomType: "group",
        memberUserIds: [LAN, MINH, HA, TU],
      }),
    );
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
  });

  it("xoá trắng tên ⇒ lỗi «Cần tên nhóm» tại ô, bấm Tạo KHÔNG gửi request", () => {
    seedFourDms();
    renderDialog();
    goGroup();
    fireEvent.click(screen.getByTestId(`chat-create-recent-${LAN}`));

    const nameInput = screen.getByLabelText("Tên nhóm");
    fireEvent.change(nameInput, { target: { value: "   " } });

    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Cần tên nhóm")).toBeInTheDocument();
    clickCreate();
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("gõ tên riêng ⇒ gửi tên đã trim; description rỗng KHÔNG khai, có mô tả thì trim", async () => {
    seedFourDms();
    renderDialog();
    goGroup();
    fireEvent.click(screen.getByTestId(`chat-create-recent-${MINH}`));
    fireEvent.change(screen.getByLabelText("Tên nhóm"), { target: { value: "  Kế toán Q4  " } });
    fireEvent.change(screen.getByLabelText("Mô tả"), { target: { value: "  chốt sổ  " } });
    clickCreate();

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith({
        name: "Kế toán Q4",
        roomType: "group",
        description: "chốt sổ",
        memberUserIds: [MINH],
      }),
    );
  });

  it("chưa có DM nào ⇒ «Gần đây» ẩn, ô tìm vẫn dùng được và thêm người vào nhóm", async () => {
    renderDialog();
    goGroup();

    expect(screen.queryByRole("group", { name: "Gần đây" })).not.toBeInTheDocument();
    typeSearch("An");
    fireEvent.click(await result(/Nguyễn Văn An/));
    expect(screen.getByLabelText("Tên nhóm")).toHaveValue("An");
    clickCreate();

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ memberUserIds: [AN] })),
    );
  });

  it("chọn TRÙNG (chip rồi ô tìm) ⇒ memberUserIds không nhân đôi", async () => {
    useChatStore.getState().syncRoomList([dm(AN, "Nguyễn Văn An", 1)], false);
    renderDialog();
    goGroup();
    fireEvent.click(screen.getByTestId(`chat-create-recent-${AN}`));
    typeSearch("An");
    const row = await result(/Nguyễn Văn An/);
    expect(row).toHaveAttribute("aria-pressed", "true");
    clickCreate();

    await waitFor(() =>
      expect(createRoom).toHaveBeenCalledWith(expect.objectContaining({ memberUserIds: [AN] })),
    );
  });

  it("người đối thoại `isActive=false` ⇒ chip khoá kèm lý do, chạm không chọn", () => {
    useChatStore
      .getState()
      .syncRoomList([dm(LAN, "Trần Thị Lan", 1), dm(MINH, "Lê Văn Minh", 2, false)], false);
    renderDialog();
    goGroup();

    const minh = screen.getByTestId(`chat-create-recent-${MINH}`);
    expect(minh).toBeDisabled();
    expect(minh).toHaveTextContent("Ngừng hoạt động");
    fireEvent.click(minh);
    expect(minh).toHaveAttribute("aria-pressed", "false");
  });

  it("server từ chối ⇒ dialog GIỮ lựa chọn và nói rõ ai không thêm được; KHÔNG gọi onCreated", async () => {
    seedFourDms();
    createRoom.mockRejectedValue(new ApiError(422, "CHAT-ERR-003", "CHAT-ERR-003"));
    const { onCreated } = renderDialog();
    goGroup();
    fireEvent.click(screen.getByTestId(`chat-create-recent-${HA}`));
    clickCreate();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Phạm Thu Hà"));
    expect(screen.getByTestId(`chat-create-recent-${HA}`)).toHaveAttribute("aria-pressed", "true");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("phòng trả về không có tên ⇒ onCreated dùng tên đã gửi", async () => {
    seedFourDms();
    createRoom.mockResolvedValue(room({ name: null }));
    const { onCreated } = renderDialog();
    goGroup();
    fireEvent.click(screen.getByTestId(`chat-create-recent-${LAN}`));
    clickCreate();

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: ROOM_ID }), "Lan"),
    );
  });

  it("mở với preset nhóm + người đối thoại (lối «Thêm người» của DM) ⇒ đã chọn sẵn", () => {
    seedFourDms();
    renderDialog({
      initialTab: "group",
      initialMembers: [{ userId: LAN, fullName: "Trần Thị Lan" }],
    });

    expect(screen.getByRole("tab", { name: "Tạo nhóm" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId(`chat-create-recent-${LAN}`)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Tên nhóm")).toHaveValue("Lan");
  });
});

describe("CreateRoomDialog — biến thể drawer", () => {
  it("không có kết quả ⇒ kèm gợi ý «Nhắn riêng từ một phòng chung»", async () => {
    listEmployees.mockResolvedValue(page([]));
    renderDialog({ variant: "drawer" });
    typeSearch("Bình");

    expect(
      await screen.findByText("Không tìm thấy trong danh bạ bạn được xem."),
    ).toBeInTheDocument();
    expect(screen.getByText(/Nhắn riêng từ một phòng chung/i)).toBeInTheDocument();
  });
});
