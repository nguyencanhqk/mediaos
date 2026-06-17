import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { KpiResultDto } from "@mediaos/contracts";
import { KpiHistory } from "./kpi-history";

const SUBJECT_USER = "11111111-1111-1111-1111-111111111111";
const SUBJECT_TEAM = "22222222-2222-2222-2222-222222222222";

function makeResult(overrides: Partial<KpiResultDto> = {}): KpiResultDto {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    companyId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    definitionId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    subjectUserId: SUBJECT_USER,
    subjectTeamId: null,
    periodStart: "2026-05-01T00:00:00.000Z",
    periodEnd: "2026-06-01T00:00:00.000Z",
    components: {
      tasksDone: 100,
      onTimeRate: 100,
      evaluationScore: 80,
      defectScore: 100,
      firstPassApprovalRate: 75,
    },
    totalScore: 80,
    confirmedBy: null,
    confirmedAt: null,
    computedBy: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    createdAt: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("KpiHistory — lịch sử KPI (mask: render đúng field server trả)", () => {
  it("hiển thị điểm tổng + trạng thái Tham khảo cho bản chưa xác nhận", () => {
    render(<KpiHistory results={[makeResult()]} />);
    expect(screen.getByText("80")).toBeInTheDocument();
    expect(screen.getByText("Tham khảo")).toBeInTheDocument();
  });

  it("bản đã xác nhận → trạng thái Đã xác nhận", () => {
    render(
      <KpiHistory
        results={[
          makeResult({
            confirmedBy: "dddddddd-dddd-dddd-dddd-dddddddddddd",
            confirmedAt: "2026-06-13T00:00:00.000Z",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Đã xác nhận")).toBeInTheDocument();
  });

  it("hiện tên chủ thể khi có subjectNames map; nếu không thì chỉ nhãn loại", () => {
    const { rerender } = render(
      <KpiHistory
        results={[makeResult()]}
        subjectNames={{ [SUBJECT_USER]: "Nguyễn Văn A" }}
      />,
    );
    expect(screen.getByText("Nguyễn Văn A")).toBeInTheDocument();

    rerender(<KpiHistory results={[makeResult()]} />);
    expect(screen.queryByText("Nguyễn Văn A")).not.toBeInTheDocument();
    // Vẫn có nhãn loại chủ thể (Nhân viên).
    expect(screen.getAllByText("Nhân viên").length).toBeGreaterThan(0);
  });

  it("kết quả của team → nhãn Nhóm", () => {
    render(
      <KpiHistory
        results={[makeResult({ subjectUserId: null, subjectTeamId: SUBJECT_TEAM })]}
      />,
    );
    expect(screen.getAllByText("Nhóm").length).toBeGreaterThan(0);
  });

  it("rỗng → empty state lịch sử KPI", () => {
    render(<KpiHistory results={[]} />);
    expect(screen.getByText(/chưa có kết quả kpi/i)).toBeInTheDocument();
  });

  it("lỗi tải → empty state lỗi (không render bảng)", () => {
    render(<KpiHistory results={[]} isError />);
    expect(screen.getByText(/không tải được lịch sử kpi/i)).toBeInTheDocument();
  });
});
