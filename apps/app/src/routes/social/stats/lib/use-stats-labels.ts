/**
 * S16-SOCIAL-FE-3B (L5) — hai nhãn dùng ở NHIỀU component của màn Thống kê tương tác, mỗi nhãn một nguồn:
 *  · nhãn một TUẦN «thứ Hai – Chủ nhật» — bảng «Theo tuần» và bảng thay thế của biểu đồ;
 *  · TÊN ĐƠN VỊ kèm hậu tố «(đã xoá)» — bảng «Theo đơn vị» và ô chọn đơn vị.
 */
import { useTranslation } from "react-i18next";
import { formatStatsDate, weekEndOf } from "./stats-range";

/** Nhãn của tuần bắt đầu ở `weekStart` (thứ Hai), tính bằng số học chuỗi. */
export function useWeekLabel(): (weekStart: string) => string {
  const { t } = useTranslation("social");
  return (weekStart) =>
    t("admin.stats.week.range", {
      from: formatStatsDate(weekStart),
      to: formatStatsDate(weekEndOf(weekStart) ?? weekStart),
    });
}

/** Tên hiển thị của một đơn vị: đơn vị đã xoá mang hậu tố «(đã xoá)». */
export function useUnitName(): (unit: { name: string; isDeleted: boolean }) => string {
  const { t } = useTranslation("social");
  return (unit) =>
    unit.isDeleted ? t("admin.stats.unit.deleted", { name: unit.name }) : unit.name;
}
