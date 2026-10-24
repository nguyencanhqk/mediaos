/**
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-08) — vỏ route /goals/templates trên ROUTER THẬT: chỉ chuyển cho
 * trang `returnTo` đã lọc, và `onReturn` điều hướng SPA tới đúng đường dẫn nội bộ đó. Trang được
 * thay bằng stub (hành vi của trang phủ ở TaskTemplateListPage.spec).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

vi.mock("./TaskTemplateListPage", () => ({
  TaskTemplateListPage: ({
    returnTo,
    onReturn,
  }: {
    returnTo?: string;
    onReturn?: (to: string) => void;
  }) => (
    <div>
      <p data-testid="page-return-to">{returnTo ?? "(none)"}</p>
      <button type="button" onClick={() => returnTo && onReturn?.(returnTo)}>
        quay lại
      </button>
    </div>
  ),
}));

import { validateTaskTemplateListSearch } from "./template-return-to";
import { TemplatesRoute } from "./TaskTemplateListPageRoute";

function mountAt(href: string) {
  const rootRoute = createRootRoute();
  const templatesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/goals/templates",
    validateSearch: validateTaskTemplateListSearch,
    component: TemplatesRoute,
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/goals/$goalId",
    component: () => <p data-testid="detail-stub">chi tiết</p>,
  });
  const history = createMemoryHistory({ initialEntries: [href] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([templatesRoute, detailRoute]),
    history,
  });
  render(<RouterProvider router={router} />);
  return history;
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

describe("TemplatesRoute (/goals/templates)", () => {
  it("returnTo nội bộ ⇒ trang nhận nguyên văn; quay lại ⇒ điều hướng SPA tới đó", async () => {
    const target = "/goals/g-1?decompose=resume";
    const history = mountAt(`/goals/templates?returnTo=${encodeURIComponent(target)}`);
    expect(await screen.findByTestId("page-return-to")).toHaveTextContent(target);

    fireEvent.click(screen.getByText("quay lại"));
    expect(await screen.findByTestId("detail-stub")).toBeInTheDocument();
    expect(history.location.pathname).toBe("/goals/g-1");
    expect(history.location.search).toBe("?decompose=resume");
  });

  it.each([["//example.org"], ["https://example.org"], ["/%5Cexample.org"]])(
    "returnTo %s ⇒ trang không nhận returnTo",
    async (raw) => {
      mountAt(`/goals/templates?returnTo=${encodeURIComponent(raw)}`);
      expect(await screen.findByTestId("page-return-to")).toHaveTextContent("(none)");
    },
  );

  it("không có returnTo ⇒ trang không nhận returnTo", async () => {
    mountAt("/goals/templates");
    expect(await screen.findByTestId("page-return-to")).toHaveTextContent("(none)");
  });
});
