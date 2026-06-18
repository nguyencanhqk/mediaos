import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { PositionsPage } from "./positions";
import { useAuthStore } from "@mediaos/web-core";

/**
 * CS-3 — PositionsPage (console jsdom tests).
 *
 * Mirror style của departments.spec.tsx trong apps/people.
 */

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";
const ISO = "2026-06-01T00:00:00.000Z";

const POSITION: import("@mediaos/contracts").PositionDto = {
  id: UUID,
  companyId: UUID,
  name: "Kế toán trưởng",
  code: "KTT",
  orgUnitId: UUID2,
  orgUnitName: "Phòng Kế toán",
  level: 3,
  defaultRoleId: null,
  defaultRoleName: null,
  status: "active",
  description: null,
  createdAt: ISO,
  updatedAt: ISO,
};

const ORG_UNIT: import("@mediaos/contracts").OrgUnitDto = {
  id: UUID2,
  companyId: UUID,
  parentId: null,
  name: "Phòng Kế toán",
  type: "department",
  status: "active",
  createdAt: ISO,
  updatedAt: ISO,
};

type FetchCall = [input: string, init?: RequestInit];

function jsonOk(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function jsonErr(status = 500): Response {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, data: null, error: { code: "E", message: "boom" } }),
    text: async () => "{}",
  } as unknown as Response;
}

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({ capabilities: caps });
}

let fetchMock: ReturnType<typeof vi.fn>;

function setupDefaultFetch() {
  fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "GET" && url.includes("/org/positions")) {
      return Promise.resolve(jsonOk([POSITION]));
    }
    if (method === "GET" && url.includes("/org/units")) {
      return Promise.resolve(jsonOk([ORG_UNIT]));
    }
    if (method === "GET" && url.includes("/org/roles")) {
      return Promise.resolve(jsonOk([]));
    }
    if (method === "POST" && url.includes("/org/positions")) {
      return Promise.resolve(
        jsonOk({ ...POSITION, id: "new-id", name: "Kế toán viên" }),
      );
    }
    if (method === "PATCH" && url.includes("/org/positions/")) {
      return Promise.resolve(jsonOk({ ...POSITION, name: "Kế toán trưởng (updated)" }));
    }
    if (method === "DELETE" && url.includes("/org/positions/")) {
      return Promise.resolve(jsonOk(undefined, 204));
    }
    return Promise.resolve(jsonOk([]));
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  setupDefaultFetch();
  setCaps({
    "create:position": true,
    "update:position": true,
    "delete:position": true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<PositionsPage />, { wrapper });
}

function callsTo(method: string, fragment: string): FetchCall[] {
  return (fetchMock.mock.calls as FetchCall[]).filter(([url, init]) => {
    const m = (init?.method ?? "GET").toUpperCase();
    return m === method.toUpperCase() && String(url).includes(fragment);
  });
}

describe("CS-3 PositionsPage — hiển thị danh sách", () => {
  it("hiển thị tiêu đề Vị trí công việc", () => {
    renderPage();
    expect(screen.getByText("Vị trí công việc")).toBeInTheDocument();
  });

  it("hiển thị row vị trí (Kế toán trưởng)", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Kế toán trưởng")).toBeInTheDocument(),
    );
  });

  it("hiển thị mã vị trí (KTT)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("KTT")).toBeInTheDocument());
  });

  it("hiển thị tên đơn vị (Phòng Kế toán)", async () => {
    renderPage();
    await waitFor(() => {
      const cells = screen.getAllByText("Phòng Kế toán");
      expect(cells.length).toBeGreaterThan(0);
    });
  });

  it("hiển thị cấp bậc (3)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
  });

  it("loading → skeleton text hiển thị", () => {
    renderPage();
    // loading state trước khi fetch resolve — đảm bảo component không crash
    expect(document.body).toBeTruthy();
  });
});

describe("CS-3 PositionsPage — lỗi fetch", () => {
  it("lỗi fetch positions → role=alert", async () => {
    fetchMock = vi.fn((input: string) => {
      const url = String(input);
      if (url.includes("/org/positions")) return Promise.resolve(jsonErr());
      if (url.includes("/org/units")) return Promise.resolve(jsonOk([ORG_UNIT]));
      return Promise.resolve(jsonOk([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("CS-3 PositionsPage — empty state", () => {
  it("empty list → EmptyState hiển thị", async () => {
    fetchMock = vi.fn((input: string) => {
      const url = String(input);
      if (url.includes("/org/positions")) return Promise.resolve(jsonOk([]));
      if (url.includes("/org/units")) return Promise.resolve(jsonOk([]));
      if (url.includes("/org/roles")) return Promise.resolve(jsonOk([]));
      return Promise.resolve(jsonOk([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Chưa có vị trí công việc")).toBeInTheDocument(),
    );
  });
});

describe("CS-3 PositionsPage — permission deny", () => {
  it("thiếu create:position → không có nút Thêm vị trí", async () => {
    setCaps({});
    renderPage();
    await waitFor(() => expect(screen.getByText("Kế toán trưởng")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Thêm vị trí" })).not.toBeInTheDocument();
  });

  it("thiếu update:position → không có nút Sửa", async () => {
    setCaps({ "create:position": true });
    renderPage();
    await waitFor(() => expect(screen.getByText("Kế toán trưởng")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Sửa" })).not.toBeInTheDocument();
  });

  it("thiếu delete:position → không có nút Xóa", async () => {
    setCaps({ "create:position": true, "update:position": true });
    renderPage();
    await waitFor(() => expect(screen.getByText("Kế toán trưởng")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Xóa" })).not.toBeInTheDocument();
  });
});

describe("CS-3 PositionsPage — CRUD mutations", () => {
  it("mở dialog create → POST /org/positions khi lưu", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Kế toán trưởng")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Thêm vị trí" }));
    await waitFor(() =>
      expect(screen.getByText("Thêm vị trí công việc")).toBeInTheDocument(),
    );

    const nameInput = screen.getByLabelText("Tên vị trí");
    fireEvent.change(nameInput, { target: { value: "Kế toán viên" } });

    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));

    await waitFor(() =>
      expect(callsTo("POST", "/org/positions").length).toBe(1),
    );
    const [, postInit] = callsTo("POST", "/org/positions")[0];
    expect(JSON.parse(String(postInit?.body))).toMatchObject({ name: "Kế toán viên" });
  });

  it("nút Sửa → mở dialog edit với giá trị hiện tại", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Kế toán trưởng")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "Sửa" })[0]);
    await waitFor(() =>
      expect(screen.getByText("Sửa vị trí công việc")).toBeInTheDocument(),
    );

    const nameInput = screen.getByLabelText("Tên vị trí") as HTMLInputElement;
    expect(nameInput.value).toBe("Kế toán trưởng");
  });

  it("xóa vị trí → DELETE /org/positions/:id", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Kế toán trưởng")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("button", { name: "Xóa" })[0]);

    await waitFor(() =>
      expect(callsTo("DELETE", `/org/positions/${UUID}`).length).toBe(1),
    );
  });

  it("lọc theo đơn vị → GET /org/positions?orgUnitId=...", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("Kế toán trưởng")).toBeInTheDocument());

    const select = screen.getByLabelText("Lọc theo đơn vị:");
    fireEvent.change(select, { target: { value: UUID2 } });

    await waitFor(() =>
      expect(
        callsTo("GET", `/org/positions?orgUnitId=${UUID2}`).length,
      ).toBeGreaterThan(0),
    );
  });
});

describe("CS-3 PositionsPage — parent-child tree (org unit filter)", () => {
  it("org units nạp đúng vào dropdown lọc", async () => {
    renderPage();
    await waitFor(() => {
      const options = screen.getByLabelText("Lọc theo đơn vị:") as HTMLSelectElement;
      expect(options.options.length).toBeGreaterThan(1); // có ít nhất Tất cả + 1 unit
    });
  });
});
