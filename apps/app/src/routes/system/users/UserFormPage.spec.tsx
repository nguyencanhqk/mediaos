/**
 * [RED-trước · deny-path] UserFormPage — S2-FE-AUTH-3.
 * Gate create: create:user (AUTH.USER.CREATE); edit: update:user (AUTH.USER.UPDATE).
 * States: forbidden · validation · submit success/error · edit pre-fill + dirty-guard.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, ApiError } from "@mediaos/web-core";
import { authUsersApi } from "@mediaos/web-core";
import type { AuthUserDetailDto } from "@mediaos/contracts";
import { UserFormPage } from "./UserFormPage";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    authUsersApi: {
      getUser: vi.fn(),
      createUser: vi.fn(),
      updateUser: vi.fn(),
    },
  };
});

// Dirty-form guard pulls TanStack router state (no RouterProvider in this unit test) → stub to no-op.
vi.mock("@/hooks/use-dirty-form-guard", () => ({
  useDirtyFormGuard: () => {},
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// Placeholder-only value (changeme + digits) — satisfies the create-schema password strength rule
// (upper/lower/digit, min length) for form-submit assertions. NEVER a real credential (BẤT BIẾN #3).
const TEST_PASSWORD_INPUT = "Changeme123";

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function setCapabilities(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: {
      id: "u1",
      email: "test@demo.local",
      fullName: "Test User",
      status: "Active",
      companyId: "co-001",
    },
  });
}

function clearCapabilities() {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
}

// getUser (S2-AUTH-BE-12) trả detail schema (superset + twoFactor) — form chỉ đọc fullName/email.
const DETAIL: AuthUserDetailDto = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "existing@demo.local",
  fullName: "Existing User",
  status: "active",
  lockedAt: null,
  lockedReason: null,
  lastLoginAt: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  twoFactor: { enabled: false, requiredByRole: false, requiredByUser: false },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("UserFormPage", () => {
  beforeEach(() => {
    clearCapabilities();
    vi.clearAllMocks();
  });

  // ── DENY-PATH: create without create:user ──────────────────────────────────
  it("renders forbidden state when user lacks create:user", () => {
    setCapabilities({});
    renderWithQuery(<UserFormPage />);
    expect(screen.getByText(/không có quyền tạo hoặc chỉnh sửa/i)).toBeInTheDocument();
    expect(authUsersApi.createUser).not.toHaveBeenCalled();
  });

  // ── ALLOW: create form renders ─────────────────────────────────────────────
  it("renders the create form with create:user", () => {
    setCapabilities({ "create:user": true });
    renderWithQuery(<UserFormPage />);
    expect(document.querySelector("#email")).toBeInTheDocument();
    expect(document.querySelector("#password")).toBeInTheDocument();
  });

  // ── VALIDATION: empty required fields block submit ─────────────────────────
  it("shows validation errors and does not call the API on empty submit", async () => {
    setCapabilities({ "create:user": true });
    renderWithQuery(<UserFormPage />);
    fireEvent.click(screen.getByRole("button", { name: /tạo người dùng/i }));
    await waitFor(() => expect(screen.getByText("Vui lòng nhập email.")).toBeInTheDocument());
    expect(screen.getByText("Vui lòng nhập họ tên.")).toBeInTheDocument();
    expect(authUsersApi.createUser).not.toHaveBeenCalled();
  });

  // ── ALLOW: successful create → API called + onSuccess ───────────────────────
  it("submits a valid create and calls onSuccess with the new id", async () => {
    setCapabilities({ "create:user": true });
    vi.mocked(authUsersApi.createUser).mockResolvedValue({ ...DETAIL, id: "new-user-id" });
    const onSuccess = vi.fn();
    renderWithQuery(<UserFormPage onSuccess={onSuccess} />);

    fireEvent.change(document.querySelector("#email")!, { target: { value: "b@demo.local" } });
    fireEvent.change(document.querySelector("#fullName")!, { target: { value: "Trần Văn B" } });
    fireEvent.change(document.querySelector("#password")!, {
      target: { value: TEST_PASSWORD_INPUT },
    });
    fireEvent.click(screen.getByRole("button", { name: /tạo người dùng/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith("new-user-id"));
    expect(authUsersApi.createUser).toHaveBeenCalledWith({
      email: "b@demo.local",
      fullName: "Trần Văn B",
      password: TEST_PASSWORD_INPUT,
    });
  });

  // ── ERROR: surfaced API error shows a friendly alert ───────────────────────
  it("shows a conflict error when create fails with 409", async () => {
    setCapabilities({ "create:user": true });
    vi.mocked(authUsersApi.createUser).mockRejectedValue(new ApiError(409, "AUTH-ERR-DUP", "dup"));
    renderWithQuery(<UserFormPage onSuccess={vi.fn()} />);

    fireEvent.change(document.querySelector("#email")!, { target: { value: "c@demo.local" } });
    fireEvent.change(document.querySelector("#fullName")!, { target: { value: "C" } });
    fireEvent.change(document.querySelector("#password")!, {
      target: { value: TEST_PASSWORD_INPUT },
    });
    fireEvent.click(screen.getByRole("button", { name: /tạo người dùng/i }));

    await waitFor(() => expect(screen.getByText(/đã tồn tại/i)).toBeInTheDocument());
  });

  // ── DENY-PATH: edit without update:user ────────────────────────────────────
  it("renders forbidden state when user lacks update:user (edit mode)", () => {
    setCapabilities({});
    renderWithQuery(<UserFormPage userId={DETAIL.id} />);
    expect(screen.getByText(/không có quyền tạo hoặc chỉnh sửa/i)).toBeInTheDocument();
    expect(authUsersApi.getUser).not.toHaveBeenCalled();
  });

  // ── ALLOW: edit pre-fills + PATCHes fullName only (email immutable) ─────────
  it("pre-fills the edit form and PATCHes fullName only", async () => {
    setCapabilities({ "update:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(DETAIL);
    vi.mocked(authUsersApi.updateUser).mockResolvedValue({ ...DETAIL, fullName: "New Name" });
    const onSuccess = vi.fn();
    renderWithQuery(<UserFormPage userId={DETAIL.id} onSuccess={onSuccess} />);

    await waitFor(() =>
      expect((document.querySelector("#fullName") as HTMLInputElement)?.value).toBe(
        "Existing User",
      ),
    );
    // Email is immutable — rendered disabled.
    expect((document.querySelector("#email") as HTMLInputElement)?.disabled).toBe(true);

    fireEvent.change(document.querySelector("#fullName")!, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: /lưu thay đổi/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(DETAIL.id));
    expect(authUsersApi.updateUser).toHaveBeenCalledWith(DETAIL.id, { fullName: "New Name" });
  });

  // ── EDIT: save disabled until the form is dirty ─────────────────────────────
  it("keeps the save button disabled until the edit form is dirty", async () => {
    setCapabilities({ "update:user": true });
    vi.mocked(authUsersApi.getUser).mockResolvedValue(DETAIL);
    renderWithQuery(<UserFormPage userId={DETAIL.id} />);

    await waitFor(() =>
      expect((document.querySelector("#fullName") as HTMLInputElement)?.value).toBe(
        "Existing User",
      ),
    );
    expect(screen.getByRole("button", { name: /lưu thay đổi/i })).toBeDisabled();
  });
});
