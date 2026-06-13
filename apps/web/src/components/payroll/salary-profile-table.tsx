import type { SalaryProfileListItemDto } from "@mediaos/contracts";
import {
  MASKED_SALARY_HINT,
  PAY_CYCLE_LABELS,
  SALARY_STATUS_LABELS,
  SALARY_TYPE_LABELS,
  formatBaseSalary,
  isSalaryRevealed,
} from "./salary-constants";

interface SalaryProfileTableProps {
  rows: SalaryProfileListItemDto[];
}

/**
 * Salary profile list. MASK-BY-DEFAULT: salary numbers come from the server already
 * masked (baseSalary=null when the caller lacks view-salary-profile). This component
 * NEVER decides permission — it only renders what the server sent. When masked it shows
 * a placeholder + "Không có quyền" instead of a number.
 */
export function SalaryProfileTable({ rows }: SalaryProfileTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Chưa có hồ sơ lương.</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-left text-muted-foreground">
          <th className="py-2 font-medium">Nhân sự</th>
          <th className="py-2 font-medium">Loại</th>
          <th className="py-2 font-medium">Chu kỳ</th>
          <th className="py-2 font-medium">Hiệu lực</th>
          <th className="py-2 font-medium">Lương cơ bản</th>
          <th className="py-2 font-medium">Trạng thái</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const revealed = isSalaryRevealed(row.baseSalary);
          return (
            <tr key={row.id} className="border-b border-border/50">
              <td className="py-2 font-mono text-xs">{row.userId}</td>
              <td className="py-2">{SALARY_TYPE_LABELS[row.salaryType]}</td>
              <td className="py-2">{PAY_CYCLE_LABELS[row.payCycle]}</td>
              <td className="py-2">{row.effectiveDate}</td>
              <td className="py-2">
                {revealed ? (
                  <span className="font-medium">{formatBaseSalary(row.baseSalary)}</span>
                ) : (
                  <span className="text-muted-foreground" title={MASKED_SALARY_HINT}>
                    {formatBaseSalary(row.baseSalary)}{" "}
                    <span className="text-xs">({MASKED_SALARY_HINT})</span>
                  </span>
                )}
              </td>
              <td className="py-2">{SALARY_STATUS_LABELS[row.status]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
