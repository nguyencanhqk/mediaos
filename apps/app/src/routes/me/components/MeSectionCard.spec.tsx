// @vitest-environment jsdom
/**
 * MeSectionCard tests (S5-ME-FE-1, SPEC-09 §13) — shell trạng thái dùng chung cho mọi section Tổng quan ME.
 * Phủ: loading skeleton · ok có dữ liệu (children) · ok rỗng (isEmpty) · error · forbidden · module_disabled ·
 * unlinked_employee · footer chỉ hiện khi status='ok' có dữ liệu.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { Clock } from "lucide-react";
import i18n from "@/i18n";
import { MeSectionCard } from "./MeSectionCard";

function renderCard(
  props: Partial<React.ComponentProps<typeof MeSectionCard<{ count: number }>>> = {},
) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MeSectionCard<{ count: number }>
        title="Section test"
        icon={Clock}
        isPageLoading={false}
        section={{ status: "ok", data: { count: 3 } }}
        emptyTitle="Trống"
        {...props}
      >
        {(data) => <p data-testid="section-body">count={data.count}</p>}
      </MeSectionCard>
    </I18nextProvider>,
  );
}

describe("MeSectionCard", () => {
  it("isPageLoading=true → hiện skeleton, KHÔNG render children", () => {
    renderCard({ isPageLoading: true });
    expect(screen.queryByTestId("section-body")).not.toBeInTheDocument();
  });

  it("section=undefined (chưa có kết quả) → hiện skeleton", () => {
    renderCard({ section: undefined });
    expect(screen.queryByTestId("section-body")).not.toBeInTheDocument();
  });

  it("status='ok' có dữ liệu → render children(data)", () => {
    renderCard({ section: { status: "ok", data: { count: 5 } } });
    expect(screen.getByTestId("section-body")).toHaveTextContent("count=5");
  });

  it("status='ok' + isEmpty(data)=true → hiện emptyTitle, KHÔNG render children", () => {
    renderCard({
      section: { status: "ok", data: { count: 0 } },
      isEmpty: (d) => d.count === 0,
      emptyTitle: "Chưa có dữ liệu",
    });
    expect(screen.getByText("Chưa có dữ liệu")).toBeInTheDocument();
    expect(screen.queryByTestId("section-body")).not.toBeInTheDocument();
  });

  it("status='ok' + data=null → hiện emptyTitle (KHÔNG cần isEmpty)", () => {
    renderCard({
      section: { status: "ok", data: null },
      emptyTitle: "Không có dữ liệu",
    });
    expect(screen.getByText("Không có dữ liệu")).toBeInTheDocument();
  });

  it("status='error' → hiện thông điệp lỗi", () => {
    renderCard({ section: { status: "error", data: null } });
    expect(screen.getByText(/không tải được dữ liệu/i)).toBeInTheDocument();
  });

  it("status='forbidden' → hiện thông điệp thiếu quyền", () => {
    renderCard({ section: { status: "forbidden", data: null } });
    expect(screen.getByText(/không có quyền xem mục này/i)).toBeInTheDocument();
  });

  it("status='module_disabled' → hiện thông điệp module chưa bật", () => {
    renderCard({ section: { status: "module_disabled", data: null } });
    expect(screen.getByText(/chưa được bật/i)).toBeInTheDocument();
  });

  it("status='unlinked_employee' → hiện thông điệp cần liên kết hồ sơ", () => {
    renderCard({ section: { status: "unlinked_employee", data: null } });
    expect(screen.getByText(/liên kết hồ sơ nhân viên/i)).toBeInTheDocument();
  });

  it("footer CHỈ hiện khi status='ok' có dữ liệu", () => {
    const { rerender } = renderCard({
      section: { status: "ok", data: { count: 1 } },
      footer: <p data-testid="footer">footer</p>,
    });
    expect(screen.getByTestId("footer")).toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <MeSectionCard<{ count: number }>
          title="Section test"
          icon={Clock}
          isPageLoading={false}
          section={{ status: "forbidden", data: null }}
          emptyTitle="Trống"
          footer={<p data-testid="footer">footer</p>}
        >
          {(data) => <p data-testid="section-body">count={data.count}</p>}
        </MeSectionCard>
      </I18nextProvider>,
    );
    expect(screen.queryByTestId("footer")).not.toBeInTheDocument();
  });
});
