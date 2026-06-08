import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecretField } from "./secret-field";

const PLAINTEXT = "super-secret-pw";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SecretField — masked by default", () => {
  it("renders the mask and NOT the plaintext before reveal", () => {
    render(<SecretField onRequestReveal={async () => PLAINTEXT} />);
    expect(screen.getByTestId("secret-masked")).toBeInTheDocument();
    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hiện/i })).toBeInTheDocument();
  });

  it("does NOT call onRequestReveal until the eye button is clicked", () => {
    const onRequestReveal = vi.fn(async () => PLAINTEXT);
    render(<SecretField onRequestReveal={onRequestReveal} />);
    expect(onRequestReveal).not.toHaveBeenCalled();
  });
});

describe("SecretField — reveal flow", () => {
  it("shows the plaintext after a successful reveal", async () => {
    render(<SecretField onRequestReveal={async () => PLAINTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /hiện/i }));
    expect(await screen.findByText(PLAINTEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ẩn/i })).toBeInTheDocument();
  });

  it("stays masked when reveal is cancelled (resolves null)", async () => {
    const onRequestReveal = vi.fn(async () => null);
    render(<SecretField onRequestReveal={onRequestReveal} />);
    fireEvent.click(screen.getByRole("button", { name: /hiện/i }));
    await waitFor(() => expect(onRequestReveal).toHaveBeenCalled());
    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
    expect(screen.getByTestId("secret-masked")).toBeInTheDocument();
  });

  it("surfaces an error and stays masked when reveal rejects", async () => {
    const onRequestReveal = vi.fn(async () => {
      throw new Error("Re-authentication failed.");
    });
    render(<SecretField onRequestReveal={onRequestReveal} />);
    fireEvent.click(screen.getByRole("button", { name: /hiện/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/thất bại|failed/i);
    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
  });
});

describe("SecretField — plaintext is ephemeral", () => {
  it("clears the plaintext when the hide button is clicked", async () => {
    render(<SecretField onRequestReveal={async () => PLAINTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /hiện/i }));
    expect(await screen.findByText(PLAINTEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ẩn/i }));
    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
    expect(screen.getByTestId("secret-masked")).toBeInTheDocument();
  });

  it("clears the plaintext when focus leaves the field (blur)", async () => {
    render(<SecretField onRequestReveal={async () => PLAINTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /hiện/i }));
    await screen.findByText(PLAINTEXT);

    // Focus leaves the whole field (relatedTarget = null) → plaintext must be dropped.
    fireEvent.blur(screen.getByTestId("secret-field"));
    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
    expect(screen.queryByTestId("secret-plaintext")).not.toBeInTheDocument();
    expect(screen.getByTestId("secret-masked")).toBeInTheDocument();
  });

  it("auto-hides the plaintext after autoHideMs", async () => {
    render(<SecretField onRequestReveal={async () => PLAINTEXT} autoHideMs={40} />);
    fireEvent.click(screen.getByRole("button", { name: /hiện/i }));
    expect(await screen.findByText(PLAINTEXT)).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument(), {
      timeout: 1000,
    });
  });

  it("removes the plaintext from the DOM on unmount", async () => {
    const { unmount } = render(<SecretField onRequestReveal={async () => PLAINTEXT} />);
    fireEvent.click(screen.getByRole("button", { name: /hiện/i }));
    expect(await screen.findByText(PLAINTEXT)).toBeInTheDocument();

    unmount();
    expect(screen.queryByText(PLAINTEXT)).not.toBeInTheDocument();
  });
});
