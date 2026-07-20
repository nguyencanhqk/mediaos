import type { ReactNode } from "react";
import { Card, cn } from "@mediaos/ui";

/**
 * PanelBody — vỏ ngoài dùng chung của 5 panel màn chi tiết task (việc con · checklist · bình luận ·
 * tệp · hoạt động).
 *
 * S5-TASK-LAYOUT-1: các panel này giờ nằm TRONG tab. Nếu mỗi panel vẫn tự bọc `Card` thì thành thẻ
 * lồng thẻ (hai lớp viền + hai lớp đệm), và tiêu đề của panel lặp lại đúng chữ trên nhãn tab. Chế độ
 * `embedded` bỏ vỏ Card và để panel tự giấu tiêu đề — tab đã nói nó là gì.
 *
 * Mount ĐỘC LẬP (ngoài tab) vẫn giữ nguyên vỏ Card như cũ: `embedded` mặc định false.
 */
export function PanelBody({
  embedded = false,
  className,
  children,
  ...rest
}: {
  embedded?: boolean;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  if (embedded) {
    return (
      <div className={cn("space-y-3", className)} {...rest}>
        {children}
      </div>
    );
  }
  return (
    <Card className={cn("space-y-3 p-4", className)} {...rest}>
      {children}
    </Card>
  );
}
