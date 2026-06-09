import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DepartmentsPage } from "./departments";

// React Flow needs a measured DOM jsdom does not provide — stub the canvas.
vi.mock("@xyflow/react", () => ({
  ReactFlow: () => <div data-testid="react-flow" />,
  Background: () => null,
  Controls: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

const UUID = "11111111-1111-1111-1111-111111111111";
const ISO = "2026-06-01T00:00:00.000Z";

const DEPT = {
  id: UUID,
  companyId: UUID,
  parentId: null,
  name: "Phòng Kế toán",
  type: "department",
  status: "active",
  createdAt: ISO,
  updatedAt: ISO,
};

type FetchCall = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/org/units/tree")) return Promise.resolve(jsonResponse([]));
    if (method === "PATCH" && url.includes("/org/units/")) {
      return Promise.resolve(jsonResponse({ ...DEPT, status: "inactive" }));
    }
    if (url.includes("/org/departments")) return Promise.resolve(jsonResponse([DEPT]));
    if (url.includes("/org/employees")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse([]));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DepartmentsPage />
    </QueryClientProvider>,
  );
}

function callsTo(method: string, fragment: string): FetchCall[] {
  return (fetchMock.mock.calls as FetchCall[]).filter(([url, init]) => {
    const m = init?.method ?? "GET";
    return m === method && String(url).includes(fragment);
  });
}

describe("DepartmentsPage — toggle status", () => {
  it("PATCHes /org/units/:id then refetches the department list (invalidate)", async () => {
    renderPage();

    await screen.findByText("Phòng Kế toán");
    expect(callsTo("GET", "/org/departments")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Đang bật" }));

    // 1) the toggle hit the correct endpoint with the flipped status
    await waitFor(() => expect(callsTo("PATCH", "/org/units/").length).toBe(1));
    const [, patchInit] = callsTo("PATCH", "/org/units/")[0];
    expect(JSON.parse(String(patchInit?.body))).toEqual({ status: "inactive" });

    // 2) the list query was invalidated → a second GET fired
    await waitFor(() =>
      expect(callsTo("GET", "/org/departments").length).toBeGreaterThanOrEqual(2),
    );
  });
});
