import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, configureToast, showApiErrorToast } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { RootLayout } from "./root-layout";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, Outlet: () => <div data-testid="outlet-content" /> };
});

describe("apps/auth RootLayout — thông báo nổi (S20-FE-TOAST-2)", () => {
  beforeEach(() => configureToast(toast));
  afterEach(() => {
    act(() => toast.clear());
    cleanup();
    configureToast(null);
  });

  it("Toaster mount ĐÚNG một lần cạnh trang con", () => {
    render(<RootLayout />);
    expect(screen.getByTestId("outlet-content")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="toaster"]')).toHaveLength(1);
  });

  it("showApiErrorToast ⇒ hiện trong vùng assertive, không rơi về console", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<RootLayout />);

    act(() =>
      showApiErrorToast(new ApiError({ message: "Máy chủ đang bận", kind: "SERVER", status: 500 })),
    );

    const region = screen.getByRole("region", { name: "Thông báo" });
    expect(within(region).getByRole("alert")).toHaveTextContent("Máy chủ đang bận");
    expect(consoleError).not.toHaveBeenCalledWith("[api]", "Máy chủ đang bận");
    consoleError.mockRestore();
  });
});
