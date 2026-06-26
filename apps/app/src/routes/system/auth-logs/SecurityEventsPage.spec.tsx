/**
 * SecurityEventsPage — S2-AUTH-BE-5 · L3-FE-VIEWER (FIX-3: real-flow gating).
 *
 * Gate: cặp ENGINE THỰC ('view','audit-log') từ contract `AUTH_AUDIT_LOG` (seed mig 0340,
 *   is_sensitive=true, grant company-admin) — PIN theo cặp seed, KHÔNG literal magic-string,
 *   KHÔNG mã FE "AUTH.AUDIT_LOG.VIEW" (bài học drift S1-FND-MODULE).
 *
 * FIX-3 — gỡ green-fake: allow-path KHÔNG còn inject thẳng capabilities qua setState/setCaps.
 *   Thay vào đó nạp phiên qua ĐÚNG entrypoint mà /auth/me dùng: `useAuthStore.setUser(me, me.capabilities)`
 *   (xem packages/web-core/src/lib/session.ts → doBootstrap). Payload /auth/me được validate bằng
 *   `meResponseSchema` để bám contract thật. FIX-1 đã surface cap nhạy cảm 'view:audit-log' vào
 *   /auth/me.capabilities (allowlist) ⇒ trạng thái allow giờ ĐẾN ĐƯỢC end-to-end trong production.
 *
 * States: loading · error · empty · forbidden · list render · filter→refetch.
 * Discriminate: cùng page, cùng đường hydrate — chỉ KHÁC cap trong payload /auth/me ⇒ allow≠deny.
 * Bảo mật: DTO không chứa payload/secret → client không thể render; KHÔNG token vào storage.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthStore, apiFetch } from "@mediaos/web-core";
import {
  AUTH_AUDIT_LOG,
  meResponseSchema,
  type SecurityEventListItem,
  type MeResponse,
} from "@mediaos/contracts";
import { SecurityEventsPage } from "./SecurityEventsPage";

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, apiFetch: vi.fn() };
});

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const { default: systemVi } = await import("@/i18n/locales/vi/system");
  const commonVi = {
    status: "Trạng thái",
    priority: "Ưu tiên",
    pagination: { prev: "Trang trước", next: "Trang sau" },
    actions: { retry: "Thử lại" },
  };
  const bundles: Record<string, Record<string, unknown>> = {
    system: systemVi as unknown as Record<string, unknown>,
    common: commonVi,
  };
  function resolve(ns: string, key: string): string {
    const bundle = bundles[ns] ?? {};
    return (
      (key.split(".").reduce<unknown>((acc, k) => {
        if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
        return undefined;
      }, bundle) as string) ?? key
    );
  }
  return {
    ...actual,
    useTranslation: (ns: string | string[] = "common") => {
      const namespace = Array.isArray(ns) ? ns[0] : ns;
      return {
        t: (key: string, opts?: Record<string, unknown>) => {
          const nsKey = key.includes(":") ? key : `${namespace}:${key}`;
          const [resolvedNs, resolvedKey] = nsKey.split(":");
          let result = resolve(resolvedNs, resolvedKey);
          if (opts && typeof result === "string") {
            result = result.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(opts[k] ?? ""));
          }
          return result;
        },
        i18n: { language: "vi", changeLanguage: vi.fn() },
        ready: true,
      };
    },
    I18nextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
  };
});

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MOCK_ROWS: SecurityEventListItem[] = [
  {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    user: {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      email: "user@demo.local",
      display_name: "Nhân Viên",
    },
    event_type: "PASSWORD_CHANGED",
    severity: "high",
    actor: {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      email: "admin@demo.local",
      display_name: "Super Admin",
    },
    ip_address: "10.0.0.9",
    user_agent: "Mozilla/5.0",
    created_at: "2026-06-25T12:00:00.000Z",
  },
];

// Cặp engine canonical từ contract (KHÔNG literal magic-string) → key capabilities "view:audit-log".
const VIEW_AUDIT_LOG_CAP = `${AUTH_AUDIT_LOG.VIEW.action}:${AUTH_AUDIT_LOG.VIEW.resource}`;
// Một cap KHÁC, không phải audit-log — chứng minh deny vì THIẾU đúng cặp, không phải store rỗng.
const NON_AUDIT_CAP = "read:employee";

/**
 * Dựng payload /auth/me HỢP LỆ (validate bằng contract `meResponseSchema`) — bảo đảm test bám
 * đúng shape response thật, không drift. `capabilities` là phần FIX-1 nạp (gồm cap nhạy cảm allowlisted).
 */
function makeMe(capabilities: Record<string, boolean>): MeResponse {
  return meResponseSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    email: "admin@demo.local",
    fullName: "Super Admin",
    status: "active",
    capabilities,
    mustSetupTwoFactor: false,
  });
}

/**
 * Nạp phiên qua ĐÚNG entrypoint /auth/me dùng (session.ts doBootstrap):
 *   useAuthStore.getState().setUser(me, me.capabilities)
 * → useCan đọc capabilities y như production. KHÔNG dùng tắt setState/setCaps.
 */
function hydrateFromMe(me: MeResponse) {
  useAuthStore.getState().setUser(me, me.capabilities);
}

/** Nạp phiên ĐỦ quyền xem sự kiện bảo mật qua đường thật. */
function hydrateWithAuditView() {
  hydrateFromMe(makeMe({ [VIEW_AUDIT_LOG_CAP]: true }));
}

/** Reset phiên qua action thật `logout()` (không setState thô). */
function resetSession() {
  useAuthStore.getState().logout();
}

describe("SecurityEventsPage", () => {
  beforeEach(() => {
    resetSession();
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  // ── DENY-PATH (RED-trước) ─────────────────────────────────────────────────
  it("renders forbidden and does NOT call API when /auth/me has no view:audit-log cap", () => {
    hydrateFromMe(makeMe({})); // phiên hợp lệ nhưng KHÔNG có cặp view:audit-log
    renderWithQuery(<SecurityEventsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("renders forbidden when /auth/me grants a non-audit cap but not view:audit-log", () => {
    hydrateFromMe(makeMe({ [NON_AUDIT_CAP]: true }));
    renderWithQuery(<SecurityEventsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── ALLOW-PATH (qua hydrate THẬT từ /auth/me) ──────────────────────────────
  it("renders security-event list when /auth/me hydrates view:audit-log capability", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText("PASSWORD_CHANGED")).toBeInTheDocument());
    expect(screen.getByText("Nhân Viên")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringContaining("/auth/security-events"),
      expect.anything(),
    );
  });

  // ── DISCRIMINATE allow≠deny — cùng page, cùng đường hydrate, CHỈ khác cap ───
  it("discriminates allow vs deny purely from the hydrated /auth/me capability", async () => {
    // ALLOW: /auth/me chứa view:audit-log → render list + gọi API.
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    const allow = renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText("PASSWORD_CHANGED")).toBeInTheDocument());
    expect(vi.mocked(apiFetch).mock.calls.length).toBeGreaterThan(0);
    expect(screen.queryByText(/không có quyền truy cập/i)).not.toBeInTheDocument();
    allow.unmount();

    // DENY: cùng component, chỉ payload /auth/me KHÁC (rớt cap) → forbidden + KHÔNG gọi API.
    vi.mocked(apiFetch).mockClear();
    hydrateFromMe(makeMe({}));
    renderWithQuery(<SecurityEventsPage />);
    expect(screen.getByText(/không có quyền truy cập/i)).toBeInTheDocument();
    expect(screen.queryByText("PASSWORD_CHANGED")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ── LOADING ─────────────────────────────────────────────────────────────────
  it("shows table skeleton while fetching", () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockReturnValue(new Promise(() => {}));
    renderWithQuery(<SecurityEventsPage />);
    expect(document.querySelector("table")).toBeInTheDocument();
  });

  // ── ERROR ─────────────────────────────────────────────────────────────────
  it("shows error state when API fails", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockRejectedValue(new Error("network"));
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() =>
      expect(screen.getByText(/không thể tải sự kiện bảo mật/i)).toBeInTheDocument(),
    );
  });

  // ── EMPTY ─────────────────────────────────────────────────────────────────
  it("shows empty state when no rows returned", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue([]);
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText(/không có sự kiện bảo mật/i)).toBeInTheDocument());
  });

  // ── FILTER → refetch với param severity ─────────────────────────────────────
  it("re-queries with severity filter when applied", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText("PASSWORD_CHANGED")).toBeInTheDocument());

    const severitySelect = screen.getByRole("combobox");
    fireEvent.change(severitySelect, { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: /^lọc$/i }));

    await waitFor(() => {
      const urls = vi.mocked(apiFetch).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes("severity=high"))).toBe(true);
    });
  });

  // ── BẢO MẬT: không token vào storage ────────────────────────────────────────
  it("does not leak any token into client storage", async () => {
    hydrateWithAuditView();
    vi.mocked(apiFetch).mockResolvedValue(MOCK_ROWS);
    renderWithQuery(<SecurityEventsPage />);
    await waitFor(() => expect(screen.getByText("PASSWORD_CHANGED")).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
