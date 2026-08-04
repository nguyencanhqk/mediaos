/**
 * S7-CHAT-FE-5 🔒 — CHAT-SCREEN-008 (nhật ký đọc-vượt).
 *
 * Ngoài cổng quyền, file này đóng đinh hai điều dễ trôi nhất:
 *   · 5 giá trị `resultStatus` hiện ĐÚNG loại (gộp `Failure`/`Error` vào `Denied` = audit nói sai việc);
 *   · **bộ lọc đi lên SERVER** (`S7-CHAT-BE-9`) — đổi ô lọc phải sinh một lời gọi CHAT-API-019 MỚI kèm
 *     tham số, và nhãn phạm vi phải nói đúng điều đó.
 *
 * ⚠️ Ca `[crown] nhãn phạm vi…` trước đây PIN hành vi cũ ("chỉ áp trên các dòng đã tải"). Nó không bị xoá
 * mà bị ĐẢO: giữ nguyên nhãn cũ sau khi server lọc thật là nói sai với người dùng theo chiều ngược lại
 * (họ tưởng còn bằng chứng chưa được xét). Ca thay thế nằm ngay dưới.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import type { ChatOversightAuditEntryDto } from "@mediaos/contracts";
import { useAuthStore } from "@mediaos/web-core";
import { ChatOversightAuditPage } from "./chat-oversight-audit-page";

const listAudit = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...mod,
    chatOversightApi: {
      searchRooms: vi.fn(),
      getRoom: vi.fn(),
      listMessages: vi.fn(),
      listAudit: (...args: unknown[]) => listAudit(...args),
    },
  };
});

const ACTOR_A = "22222222-2222-4222-8222-222222222222";
const ACTOR_B = "99999999-9999-4999-8999-999999999999";

const entry = (over: Partial<ChatOversightAuditEntryDto>): ChatOversightAuditEntryDto => ({
  id: "77777777-7777-4777-8777-777777777777",
  actorUserId: ACTOR_A,
  actorName: "Nguyễn Văn A",
  roomId: "11111111-1111-4111-8111-111111111111",
  roomCode: "ROOM-001",
  roomName: "Phòng Kỹ thuật",
  resultStatus: "Success",
  endpoint: "018b",
  criteria: null,
  createdAt: "2026-08-04T03:00:00.000Z",
  ...over,
});

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ChatOversightAuditPage />, { wrapper });
}

beforeEach(() => {
  listAudit.mockReset().mockResolvedValue({ data: [entry({})], nextCursor: null });
});

/**
 * Truy vấn TRONG BẢNG. Tên người thực hiện xuất hiện ở HAI nơi — ô `<option>` của bộ lọc và ô dữ liệu —
 * nên `screen.getByText` là mơ hồ, và tệ hơn: sau khi lọc, `queryByText` vẫn khớp cái `<option>` còn lại
 * ⇒ ca "lọc thu hẹp danh sách" sẽ XANH GIẢ nếu không thu phạm vi về bảng.
 */
const inTable = () => within(screen.getByRole("table"));

async function waitForRow(text: string) {
  await waitFor(() => expect(inTable().getByText(text)).toBeInTheDocument());
}

describe("CHAT-SCREEN-008 — cổng quyền", () => {
  it("[crown-deny-path] caps `*:*` → không thấy nhật ký, KHÔNG gọi 019", () => {
    // 019 vẫn đi qua ChatOversightAuditGuard ⇒ gọi khi thiếu quyền để lại một dòng `Denied` mang tên
    // người dùng. Cổng FE đóng TRƯỚC khi query chạy nên không có dòng nhiễu nào được sinh ra.
    setCaps({ "*:*": true });
    renderPage();

    expect(screen.getByText("Bạn không có quyền dùng chức năng này")).toBeInTheDocument();
    expect(listAudit).not.toHaveBeenCalled();
  });
});

describe("CHAT-SCREEN-008 — nội dung nhật ký", () => {
  beforeEach(() => setCaps({ "view:chat-oversight": true }));

  it("hiện ai · phòng nào · lúc nào · kết quả", async () => {
    renderPage();
    await waitForRow("Nguyễn Văn A");
    expect(inTable().getByText("Phòng Kỹ thuật")).toBeInTheDocument();
    expect(inTable().getByText("Thành công")).toBeInTheDocument();
    expect(inTable().getByText("Mở phòng")).toBeInTheDocument();
  });

  it("5 `resultStatus` hiện ĐÚNG loại — không gộp Failure/Error thành Denied", async () => {
    listAudit.mockResolvedValue({
      data: [
        entry({ id: "1", resultStatus: "Success" }),
        entry({ id: "2", resultStatus: "Denied" }),
        entry({ id: "3", resultStatus: "Failure" }),
        entry({ id: "4", resultStatus: "Error" }),
        entry({ id: "5", resultStatus: "Unknown" }),
      ],
      nextCursor: null,
    });
    renderPage();

    for (const label of ["Thành công", "Bị từ chối", "Thất bại", "Lỗi", "Không rõ"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });

  it("dòng 018a KHÔNG có phòng đích ⇒ cột phòng là '—', không phải lỗi", async () => {
    listAudit.mockResolvedValue({
      data: [
        entry({
          roomId: null,
          roomCode: null,
          roomName: null,
          endpoint: "018a",
          criteria: { q: "ky" },
        }),
      ],
      nextCursor: null,
    });
    renderPage();

    expect(await screen.findByText("Tra cứu phòng")).toBeInTheDocument();
    expect(screen.getByText("q: ky")).toBeInTheDocument();
  });

  it("[crown] nhãn phạm vi nói bộ lọc áp ở SERVER — KHÔNG còn câu 'chỉ áp trên các dòng đã tải'", async () => {
    renderPage();
    await waitForRow("Nguyễn Văn A");
    expect(screen.getByRole("status")).toHaveTextContent(/toàn bộ nhật ký ở máy chủ/i);
    expect(screen.getByRole("status")).not.toHaveTextContent(/chỉ áp trên các dòng đã tải/i);
  });

  it("[crown] lọc theo người gửi tham số LÊN SERVER, không lọc trên các dòng đã tải", async () => {
    listAudit.mockResolvedValue({
      data: [entry({ id: "1" }), entry({ id: "2", actorUserId: ACTOR_B, actorName: "Trần Thị B" })],
      nextCursor: null,
    });
    renderPage();
    await waitForRow("Nguyễn Văn A");
    // Lần gọi đầu KHÔNG mang tham số lọc nào.
    expect(listAudit.mock.calls[0][0]).not.toHaveProperty("actorUserId");

    // Server giờ chỉ trả dòng của B — đúng như một endpoint có lọc sẽ làm.
    listAudit.mockResolvedValue({
      data: [entry({ id: "2", actorUserId: ACTOR_B, actorName: "Trần Thị B" })],
      nextCursor: null,
    });
    fireEvent.change(screen.getByLabelText("Người thực hiện"), { target: { value: ACTOR_B } });

    await waitFor(() =>
      expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: ACTOR_B })),
    );
    await waitFor(() => expect(inTable().queryByText("Nguyễn Văn A")).not.toBeInTheDocument());
    expect(inTable().getByText("Trần Thị B")).toBeInTheDocument();

    // Ô chọn vẫn giữ CẢ HAI người dù trang hiện tại chỉ còn B — nếu không, người dùng không quay lại A được.
    const options = within(screen.getByLabelText("Người thực hiện")).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toContain(ACTOR_A);
  });

  it("[crown] `from`/`to` gửi dạng NGÀY — client KHÔNG tự quy đổi sang mốc UTC", async () => {
    renderPage();
    await waitForRow("Nguyễn Văn A");

    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-08-04" } });

    await waitFor(() =>
      expect(listAudit).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-08-01", to: "2026-08-04" }),
      ),
    );
    // Ô trống KHÔNG được gửi lên: `""` trượt `.uuid()` ở server ⇒ 400, không phải "bỏ lọc".
    for (const call of listAudit.mock.calls) {
      expect(Object.values(call[0] as Record<string, unknown>)).not.toContain("");
    }
  });

  it("khoảng ngày NGƯỢC ⇒ nói đúng nguyên nhân + KHÔNG gọi API (không để thành banner 'không tải được')", async () => {
    renderPage();
    await waitForRow("Nguyễn Văn A");

    // Đặt `from` trước: một mình nó HỢP LỆ nên vẫn phải gọi API. Chốt số lời gọi SAU bước này để bước
    // sau đo đúng "ô ngược thì KHÔNG gọi thêm", không lẫn với lời gọi hợp lệ ở giữa.
    fireEvent.change(screen.getByLabelText("Từ ngày"), { target: { value: "2026-08-05" } });
    await waitFor(() =>
      expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ from: "2026-08-05" })),
    );
    const callsBefore = listAudit.mock.calls.length;

    fireEvent.change(screen.getByLabelText("Đến ngày"), { target: { value: "2026-08-04" } });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/khoảng ngày bị ngược/i);
    // Chọn ngược hai ô là thao tác người dùng bình thường — không được đọc như hệ thống hỏng.
    expect(alert).not.toHaveTextContent(/không tải được/i);
    expect(listAudit.mock.calls.length).toBe(callsBefore);

    // ⚠️ VÀ bảng biến mất hẳn. Hai lối hỏng mà ca này chặn, cả hai đều nói dối theo kiểu khác nhau:
    //   · `isLoading={audit.isPending}` ⇒ query `enabled:false` chưa có data thì `isPending` TRUE còn
    //     `isFetching` FALSE ⇒ 5 hàng skeleton quay VĨNH VIỄN = "hệ thống treo";
    //   · render bảng rỗng ⇒ empty-state "Chưa có lần đọc-vượt nào" = trả lời một câu hỏi server CHƯA
    //     HỀ được hỏi.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText(/chưa có lần đọc-vượt nào/i)).not.toBeInTheDocument();
  });

  it("còn trang chưa tải ⇒ nói ra + có nút Tải thêm (nextCursor là nguồn duy nhất, không suy từ độ dài)", async () => {
    listAudit.mockResolvedValue({ data: [entry({})], nextCursor: "opaque" });
    renderPage();
    await waitForRow("Nguyễn Văn A");

    expect(screen.getByRole("status")).toHaveTextContent(/còn dòng cũ hơn chưa tải/i);
    expect(screen.getByRole("button", { name: /Tải thêm/ })).toBeInTheDocument();
  });
});
