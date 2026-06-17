import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateCompanyDialog } from "./create-company-dialog";

interface MockRes {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
}

function stubFetch(res: MockRes) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => res.text ?? JSON.stringify(res.body ?? ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { onClose, ...render(<CreateCompanyDialog open onClose={onClose} />, { wrapper }) };
}

const company = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Funtime Media",
  slug: "funtime-media",
  status: "active",
  timezone: "Asia/Ho_Chi_Minh",
  currency: "VND",
  language: "vi",
  createdAt: "2026-06-17T00:00:00.000Z",
  deletedAt: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("CreateCompanyDialog", () => {
  it("hiển thị form với tiêu đề tạo công ty", () => {
    stubFetch({ ok: true, status: 200, body: { company, provision: null } });
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Tạo công ty mới" })).toBeInTheDocument();
  });

  it("báo lỗi validate khi slug sai định dạng (không gọi API)", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { company, provision: null } });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Tên công ty"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Định danh (slug)"), { target: { value: "Bad Slug!" } });
    fireEvent.submit(screen.getByLabelText("Tên công ty").closest("form")!);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submit hợp lệ gọi API POST và đóng dialog", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { company, provision: null } });
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText("Tên công ty"), { target: { value: "Funtime Media" } });
    fireEvent.change(screen.getByLabelText("Định danh (slug)"), {
      target: { value: "funtime-media" },
    });
    fireEvent.submit(screen.getByLabelText("Tên công ty").closest("form")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("hiển thị lỗi slug trùng khi API trả 409", async () => {
    stubFetch({
      ok: false,
      status: 409,
      text: JSON.stringify({ error: { code: "CONFLICT", message: "exists" } }),
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText("Tên công ty"), { target: { value: "Funtime" } });
    fireEvent.change(screen.getByLabelText("Định danh (slug)"), {
      target: { value: "funtime-media" },
    });
    fireEvent.submit(screen.getByLabelText("Tên công ty").closest("form")!);
    await waitFor(() =>
      expect(screen.getByText("Đã tồn tại công ty với định danh này.")).toBeInTheDocument(),
    );
  });
});
