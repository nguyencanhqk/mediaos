import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { useAuthStore } from "@mediaos/web-core";
import { InvitesPanel } from "./invites-panel";

function stubFetch(res: { ok: boolean; status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => JSON.stringify(res.body ?? ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

function renderPanel(kind: "approval" | "activation") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<InvitesPanel kind={kind} />, { wrapper });
}

const envelope = (data: unknown) => ({ success: true, data, error: null });

const makeInvite = (
  over: Partial<{ id: string; email: string; fullName: string; status: string }> = {},
) => ({
  id: over.id ?? "00000000-0000-0000-0000-000000000001",
  email: over.email ?? "newbie@company.com",
  fullName: over.fullName ?? "Người Mới",
  status: over.status ?? "accepted",
  expiresAt: "2026-09-18T00:00:00.000Z",
  acceptedAt: null,
  createdUserId: null,
  invitedBy: "00000000-0000-0000-0000-0000000000aa",
  createdAt: "2026-06-18T00:00:00.000Z",
  updatedAt: "2026-06-18T00:00:00.000Z",
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CS-10 InvitesPanel — permission gate", () => {
  it("KHÔNG có approve:user → noPermission", () => {
    setCaps({});
    renderPanel("approval");
    expect(screen.getByText("Không có quyền")).toBeInTheDocument();
  });
});

describe("CS-10 InvitesPanel — approval queue (Chờ duyệt)", () => {
  it("lọc status accepted → hiện tên + nút Duyệt/Từ chối", async () => {
    setCaps({ "approve:user": true });
    stubFetch({
      ok: true,
      status: 200,
      body: envelope({
        invites: [
          makeInvite({ fullName: "Chờ Duyệt", status: "accepted" }),
          makeInvite({
            id: "00000000-0000-0000-0000-000000000002",
            fullName: "Chờ Kích Hoạt",
            status: "pending",
          }),
        ],
      }),
    });
    renderPanel("approval");
    await waitFor(() => expect(screen.getByText("Chờ Duyệt")).toBeInTheDocument());
    // tab approval CHỈ hiện status accepted (pending bị lọc ra).
    expect(screen.queryByText("Chờ Kích Hoạt")).not.toBeInTheDocument();
    expect(screen.getByText("Duyệt")).toBeInTheDocument();
    expect(screen.getByText("Từ chối")).toBeInTheDocument();
  });

  it("nút Duyệt → POST /users/:id/approve", async () => {
    setCaps({ "approve:user": true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => envelope({ invites: [makeInvite()] }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => envelope(makeInvite({ status: "approved" })),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => envelope({ invites: [] }),
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel("approval");
    await waitFor(() => expect(screen.getByText("Người Mới")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Duyệt"));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/users/00000000-0000-0000-0000-000000000001/approve"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});

describe("CS-10 InvitesPanel — activation queue (Yêu cầu kích hoạt)", () => {
  it("lọc status pending → KHÔNG hiện nút Duyệt (chỉ Từ chối)", async () => {
    setCaps({ "approve:user": true });
    stubFetch({
      ok: true,
      status: 200,
      body: envelope({ invites: [makeInvite({ fullName: "Đợi Kích Hoạt", status: "pending" })] }),
    });
    renderPanel("activation");
    await waitFor(() => expect(screen.getByText("Đợi Kích Hoạt")).toBeInTheDocument());
    expect(screen.queryByText("Duyệt")).not.toBeInTheDocument();
    expect(screen.getByText("Từ chối")).toBeInTheDocument();
  });
});

describe("CS-10 InvitesPanel — invite (Mời)", () => {
  it("KHÔNG có invite:user → nút Mời ẩn", async () => {
    setCaps({ "approve:user": true });
    stubFetch({ ok: true, status: 200, body: envelope({ invites: [] }) });
    renderPanel("approval");
    await waitFor(() => expect(screen.queryByText("Mời người dùng")).not.toBeInTheDocument());
  });

  it("có invite:user → Mời mở dialog + gửi POST /users/invite", async () => {
    setCaps({ "approve:user": true, "invite:user": true });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => envelope({ invites: [] }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => envelope({ invite: makeInvite({ status: "pending" }), emailSent: true }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => envelope({ invites: [] }),
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    renderPanel("approval");
    await waitFor(() => expect(screen.getByText("Mời người dùng")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Mời người dùng"));

    await waitFor(() => expect(screen.getByPlaceholderText("nva@company.com")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Nguyễn Văn A"), {
      target: { value: "Tân Binh" },
    });
    fireEvent.change(screen.getByPlaceholderText("nva@company.com"), {
      target: { value: "tan@company.com" },
    });
    fireEvent.click(screen.getByText("Gửi lời mời"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/users/invite"),
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
