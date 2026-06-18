import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PriorityDto } from "@mediaos/contracts";
import { PriorityIcon } from "@/components/priority-icon";
import { PRIORITY_ORDER } from "@/lib/priority";

describe("PriorityIcon", () => {
  test("renders an icon with a stable testid for all 5 priorities", () => {
    // Arrange + Act
    const { container } = render(
      <>
        {PRIORITY_ORDER.map((p) => (
          <PriorityIcon key={p} priority={p} />
        ))}
      </>,
    );

    // Assert — 5 mức ưu tiên đều render, mỗi mức có data-testid riêng + 1 svg icon.
    expect(PRIORITY_ORDER).toHaveLength(5);
    for (const p of PRIORITY_ORDER) {
      const node = screen.getByTestId(`priority-icon-${p}`);
      expect(node).toBeInTheDocument();
    }
    expect(container.querySelectorAll("svg")).toHaveLength(5);
  });

  test("shows the localized vi label when showLabel is true", () => {
    // Arrange + Act
    render(<PriorityIcon priority={"urgent" satisfies PriorityDto} showLabel />);

    // Assert — nhãn vi từ catalog projects.json.
    expect(screen.getByText("Khẩn cấp")).toBeInTheDocument();
  });
});
