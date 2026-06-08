import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReAuthModal } from "./reauth-modal";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const PLAINTEXT = "super-secret-pw";

afterEach(() => vi.restoreAllMocks());

function renderWithClient(ui: ReactNode): { client: QueryClient } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { client };
}

/** Bất kỳ entry nào trong query/mutation cache giữ plaintext = rò rỉ. */
function cacheHoldsSecret(client: QueryClient, secret: string): boolean {
  const inQueries = client
    .getQueryCache()
    .getAll()
    .some((q) => JSON.stringify(q.state.data ?? null).includes(secret));
  const inMutations = client
    .getMutationCache()
    .getAll()
    .some((m) => JSON.stringify(m.state.data ?? null).includes(secret));
  return inQueries || inMutations;
}

describe("ReAuthModal — visibility", () => {
  it("renders nothing when closed", () => {
    renderWithClient(
      <ReAuthModal
        open={false}
        accountId={ACCOUNT_ID}
        onClose={vi.fn()}
        onRevealed={vi.fn()}
        reveal={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText(/mật khẩu/i)).not.toBeInTheDocument();
  });

  it("renders a password field and submit button when open", () => {
    renderWithClient(
      <ReAuthModal
        open
        accountId={ACCOUNT_ID}
        onClose={vi.fn()}
        onRevealed={vi.fn()}
        reveal={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/mật khẩu/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /xác minh|hiện/i })).toBeInTheDocument();
  });
});

describe("ReAuthModal — reveal flow", () => {
  it("calls reveal(accountId, password) then hands the plaintext to onRevealed and closes", async () => {
    const reveal = vi.fn(async () => PLAINTEXT);
    const onRevealed = vi.fn();
    const onClose = vi.fn();
    renderWithClient(
      <ReAuthModal
        open
        accountId={ACCOUNT_ID}
        onClose={onClose}
        onRevealed={onRevealed}
        reveal={reveal}
      />,
    );

    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "my-password" } });
    fireEvent.click(screen.getByRole("button", { name: /xác minh|hiện/i }));

    await waitFor(() => expect(onRevealed).toHaveBeenCalledWith(PLAINTEXT));
    expect(reveal).toHaveBeenCalledWith(ACCOUNT_ID, "my-password", undefined);
    expect(onClose).toHaveBeenCalled();
    // Modal KHÔNG được render plaintext ra DOM của chính nó.
    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
  });

  it("does not submit with an empty password", () => {
    const reveal = vi.fn(async () => PLAINTEXT);
    renderWithClient(
      <ReAuthModal
        open
        accountId={ACCOUNT_ID}
        onClose={vi.fn()}
        onRevealed={vi.fn()}
        reveal={reveal}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /xác minh|hiện/i }));
    expect(reveal).not.toHaveBeenCalled();
  });

  it("shows an error and does NOT reveal when step-up fails", async () => {
    const reveal = vi.fn(async () => {
      throw new Error("Re-authentication failed.");
    });
    const onRevealed = vi.fn();
    const onClose = vi.fn();
    renderWithClient(
      <ReAuthModal
        open
        accountId={ACCOUNT_ID}
        onClose={onClose}
        onRevealed={onRevealed}
        reveal={reveal}
      />,
    );

    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /xác minh|hiện/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/thất bại|failed/i);
    expect(onRevealed).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ReAuthModal — no plaintext retention", () => {
  it("never stores the plaintext in the React Query cache", async () => {
    const reveal = vi.fn(async () => PLAINTEXT);
    const onRevealed = vi.fn();
    const { client } = renderWithClient(
      <ReAuthModal
        open
        accountId={ACCOUNT_ID}
        onClose={vi.fn()}
        onRevealed={onRevealed}
        reveal={reveal}
      />,
    );

    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /xác minh|hiện/i }));

    await waitFor(() => expect(onRevealed).toHaveBeenCalledWith(PLAINTEXT));
    expect(cacheHoldsSecret(client, PLAINTEXT)).toBe(false);
  });

  it("clears the typed password when the modal is reopened", async () => {
    const reveal = vi.fn(async () => PLAINTEXT);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      accountId: ACCOUNT_ID,
      onClose: vi.fn(),
      onRevealed: vi.fn(),
      reveal,
    };
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <ReAuthModal open {...props} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText(/mật khẩu/i), { target: { value: "remembered?" } });

    // Đóng rồi mở lại → ô mật khẩu phải rỗng (không giữ lại factor nhạy cảm).
    rerender(
      <QueryClientProvider client={client}>
        <ReAuthModal open={false} {...props} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={client}>
        <ReAuthModal open {...props} />
      </QueryClientProvider>,
    );

    const reopened = screen.getByLabelText(/mật khẩu/i) as HTMLInputElement;
    expect(reopened.value).toBe("");
  });
});
