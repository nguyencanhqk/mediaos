import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/i18n";
import { OrgStructurePage } from "./org-structure";
import { useAuthStore } from "@mediaos/web-core";

/**
 * CS-3 — OrgStructurePage (console jsdom tests).
 *
 * Tất cả API call đều mock qua vi.stubGlobal("fetch", ...).
 * Không cần DB — console FE tests là jsdom mocked api.
 */

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";
const ISO = "2026-06-01T00:00:00.000Z";

const UNIT: import("@mediaos/contracts").OrgUnitDto = {
  id: UUID,
  companyId: UUID,
  parentId: null,
  name: "Phòng Kế toán",
  type: "department",
  code: "KT",
  status: "active",
  createdAt: ISO,
  updatedAt: ISO,
};

const TREE_NODE: import("@mediaos/contracts").OrgTreeNode = {
  id: UUID,
  name: "Phòng Kế toán",
  type: "department",
  code: "KT",
  status: "active",
  headUserName: null,
  children: [],
};

const TEAM: import("@mediaos/contracts").TeamDto = {
  id: UUID2,
  companyId: UUID,
  orgUnitId: null,
  name: "Nhóm A1",
  code: "A1",
  type: "production_team",
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

    if (method === "GET" && url.includes("/org/units/tree")) {
      return Promise.resolve(jsonOk([TREE_NODE]));
    }
    if (method === "GET" && url.includes("/org/units")) {
      return Promise.resolve(jsonOk([UNIT]));
    }
    if (method === "GET" && url.includes("/org/teams")) {
      return Promise.resolve(jsonOk([TEAM]));
    }
    if (method === "GET" && url.includes("/org/employees")) {
      return Promise.resolve(jsonOk([]));
    }
    // mutations
    if (method === "POST" && url.includes("/org/units")) {
      return Promise.resolve(jsonOk({ ...UNIT, id: "new-id" }));
    }
    if (method === "PATCH" && url.includes("/org/units/")) {
      return Promise.resolve(jsonOk({ ...UNIT, status: "inactive" }));
    }
    if (method === "DELETE" && url.includes("/org/units/")) {
      return Promise.resolve(jsonOk(undefined, 204));
    }
    if (method === "POST" && url.includes("/org/teams")) {
      return Promise.resolve(jsonOk({ ...TEAM, id: "new-team" }));
    }
    return Promise.resolve(jsonOk([]));
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  setupDefaultFetch();
  setCaps({
    "create:org_unit": true,
    "update:org_unit": true,
    "delete:org_unit": true,
    "create:team": true,
    "update:team": true,
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
  return render(<OrgStructurePage />, { wrapper });
}

function callsTo(method: string, fragment: string): FetchCall[] {
  return (fetchMock.mock.calls as FetchCall[]).filter(([url, init]) => {
    const m = (init?.method ?? "GET").toUpperCase();
    return m === method.toUpperCase() && String(url).includes(fragment);
  });
}

describe("CS-3 OrgStructurePage — Đơn vị tổ chức", () => {
  it("hiển thị tiêu đề Cơ cấu tổ chức", async () => {
    renderPage();
    expect(screen.getByText("Cơ cấu tổ chức")).toBeInTheDocument();
  });

  it("renders org tree node (Phòng Kế toán)", async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Phòng Kế toán").length).toBeGreaterThan(0));
  });

  it("nút Thêm đơn vị hiện khi có create:org_unit", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("button", { name: "Thêm đơn vị" })).toBeInTheDocument());
  });

  it("KHÔNG hiện Thêm đơn vị khi thiếu create:org_unit", async () => {
    setCaps({});
    renderPage();
    await waitFor(() => expect(screen.getAllByText("Phòng Kế toán").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Thêm đơn vị" })).not.toBeInTheDocument();
  });

  it("toggle status PATCH /org/units/:id", async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Đang bật" }).length).toBeGreaterThan(0),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Đang bật" })[0]);
    await waitFor(() => expect(callsTo("PATCH", "/org/units/").length).toBe(1));
    const [, patchInit] = callsTo("PATCH", "/org/units/")[0];
    expect(JSON.parse(String(patchInit?.body))).toMatchObject({ status: "inactive" });
  });

  it("lỗi fetch org units → role=alert", async () => {
    fetchMock = vi.fn((input: string) => {
      const url = String(input);
      if (url.includes("/org/units/tree")) return Promise.resolve(jsonErr());
      if (url.includes("/org/units")) return Promise.resolve(jsonErr());
      return Promise.resolve(jsonOk([]));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("CS-3 OrgStructurePage — Teams tab", () => {
  it("chuyển tab Teams → hiển thị tên nhóm", async () => {
    renderPage();
    const teamsTab = screen.getByRole("button", { name: "Nhóm / Team" });
    fireEvent.click(teamsTab);
    await waitFor(() => expect(screen.getByText("Nhóm A1")).toBeInTheDocument());
  });

  it("Teams tab — nút Thêm nhóm hiện khi có create:team", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Nhóm / Team" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Thêm nhóm" })).toBeInTheDocument(),
    );
  });

  it("Teams tab — KHÔNG hiện Thêm nhóm khi thiếu quyền", async () => {
    setCaps({ "create:org_unit": true, "update:org_unit": true });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Nhóm / Team" }));
    await waitFor(() => expect(screen.getByText("Nhóm A1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Thêm nhóm" })).not.toBeInTheDocument();
  });

  it("teams loading → bảng hiển thị team rows", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Nhóm / Team" }));
    await waitFor(() => expect(screen.getByText("Nhóm A1")).toBeInTheDocument());
    expect(callsTo("GET", "/org/teams").length).toBeGreaterThan(0);
  });
});

describe("CS-3 OrgStructurePage — deny permission (create:org_unit absent)", () => {
  it("không có bất kỳ quyền nào → không có nút CRUD", async () => {
    setCaps({});
    renderPage();
    await waitFor(() =>
      expect(screen.getAllByText("Phòng Kế toán").length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("button", { name: "Thêm đơn vị" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sửa" })).not.toBeInTheDocument();
  });
});
