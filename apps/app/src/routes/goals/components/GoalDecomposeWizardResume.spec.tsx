/**
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-08) — vòng «Tạo mẫu mới» → trang mẫu → quay lại wizard, đo qua
 * ROUTER THẬT (`createMemoryHistory`): `returnTo` đi qua tuần tự hoá search của TanStack mà vẫn nguyên
 * văn, lọt `validateSearch` của /goals/templates, và trang chi tiết mở lại wizard rồi gỡ cờ khỏi URL.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useNavigate,
} from "@tanstack/react-router";
import { validateTaskTemplateListSearch } from "../template-return-to";
import {
  decomposeReturnPath,
  isDecomposeResume,
  useDecomposeWizardOpen,
} from "./GoalDecomposeWizardResume";

function DetailStub() {
  const [open, setOpen] = useDecomposeWizardOpen();
  const navigate = useNavigate();
  return (
    <div>
      <p data-testid="wizard-state">{open ? "open" : "closed"}</p>
      <button type="button" onClick={() => setOpen(false)}>
        đóng
      </button>
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/goals/templates" as "/",
            search: { returnTo: decomposeReturnPath("g-1") } as never,
          })
        }
      >
        tạo mẫu
      </button>
    </div>
  );
}

function mountAt(href: string) {
  const rootRoute = createRootRoute();
  const templatesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/goals/templates",
    validateSearch: validateTaskTemplateListSearch,
    component: function TemplatesStub() {
      const search = templatesRoute.useSearch();
      const navigate = useNavigate();
      return (
        <div>
          <p data-testid="return-to">{search.returnTo ?? "(none)"}</p>
          <button
            type="button"
            onClick={() => search.returnTo && void navigate({ href: search.returnTo })}
          >
            lưu xong
          </button>
        </div>
      );
    },
  });
  const detailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/goals/$goalId",
    validateSearch: (raw: Record<string, unknown>) => (raw.tab ? { tab: String(raw.tab) } : {}),
    component: DetailStub,
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

describe("GoalDecomposeWizardResume", () => {
  it("decomposeReturnPath ⇒ chi tiết mục tiêu + cờ resume", () => {
    expect(decomposeReturnPath("g-1")).toBe("/goals/g-1?decompose=resume");
    expect(isDecomposeResume({ decompose: "resume" })).toBe(true);
    expect(isDecomposeResume({ decompose: "1" })).toBe(false);
    expect(isDecomposeResume(null)).toBe(false);
  });

  it("không có cờ ⇒ wizard đóng, URL không đổi", async () => {
    const history = mountAt("/goals/g-1?tab=children");
    expect(await screen.findByTestId("wizard-state")).toHaveTextContent("closed");
    expect(history.location.search).toBe("?tab=children");
  });

  it("?decompose=resume ⇒ wizard mở, cờ bị gỡ bằng replace (giữ khoá khác)", async () => {
    const history = mountAt("/goals/g-1?tab=children&decompose=resume");
    expect(await screen.findByTestId("wizard-state")).toHaveTextContent("open");
    await waitFor(() => expect(history.location.search).toBe("?tab=children"));
    expect(history.length).toBe(1);
    expect(screen.getByTestId("wizard-state")).toHaveTextContent("open");

    fireEvent.click(screen.getByText("đóng"));
    expect(screen.getByTestId("wizard-state")).toHaveTextContent("closed");
  });

  it("vòng đầy đủ: tạo mẫu → returnTo nguyên văn → lưu xong quay lại ⇒ wizard mở lại", async () => {
    const history = mountAt("/goals/g-1");
    fireEvent.click(await screen.findByText("tạo mẫu"));

    expect(await screen.findByTestId("return-to")).toHaveTextContent("/goals/g-1?decompose=resume");
    expect(history.location.pathname).toBe("/goals/templates");

    fireEvent.click(screen.getByText("lưu xong"));
    expect(await screen.findByTestId("wizard-state")).toHaveTextContent("open");
    await waitFor(() => expect(history.location.search).toBe(""));
    expect(history.location.pathname).toBe("/goals/g-1");
  });

  it("returnTo ngoài ứng dụng trên URL ⇒ bị validateSearch bỏ", async () => {
    mountAt(`/goals/templates?returnTo=${encodeURIComponent("//example.org")}`);
    expect(await screen.findByTestId("return-to")).toHaveTextContent("(none)");
  });
});
