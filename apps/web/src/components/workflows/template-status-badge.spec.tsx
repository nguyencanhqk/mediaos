import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TemplateStatusBadge } from "./template-status-badge";

describe("TemplateStatusBadge", () => {
  it("renders the draft label", () => {
    render(<TemplateStatusBadge status="draft" />);
    expect(screen.getByText("Nháp")).toBeInTheDocument();
  });

  it("renders the published label", () => {
    render(<TemplateStatusBadge status="published" />);
    expect(screen.getByText("Đã xuất bản")).toBeInTheDocument();
  });

  it("renders the version suffix when provided", () => {
    render(<TemplateStatusBadge status="draft" version={3} />);
    expect(screen.getByText("· v3")).toBeInTheDocument();
  });
});
