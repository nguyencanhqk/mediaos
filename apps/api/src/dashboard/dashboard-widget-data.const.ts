/**
 * S4-DASH-BE-2 — hằng số cho lớp widget DATA + CACHE (TTL nhóm §9.2, min-refresh, tra slug→entry).
 *
 * KHÔNG lặp lại catalog: DASH_WIDGET_CATALOG (dataSourceKey=slug, widgetCode, moduleCode) và
 * DASH_WIDGET_GATE_PAIR (cặp engine gate) là NGUỒN DUY NHẤT (dashboard-widget-catalog.const.ts). File này
 * chỉ THÊM tham số vận hành cache (TTL/min-interval) + helper tra cứu theo slug.
 */
import {
  DASH_WIDGET_CATALOG,
  DASH_WIDGET_GATE_PAIR,
  type DashModuleCode,
  type DashWidgetEntry,
  type EnginePair,
} from "./dashboard-widget-catalog.const";

/**
 * TTL cache (giây) theo NHÓM module nguồn — API-08 §9.2 / BACKEND-10. Ngắn để dữ liệu tươi; đủ lâu để chặn
 * đập source liên tục. ATT 30s · TASK 60s · LEAVE 120s · NOTI 10s · HR 900s(15m). Module khác (AUTH/DASH/
 * SYSTEM) hiếm dùng ở 7 widget in-sprint → default 60s.
 */
export const DASH_WIDGET_TTL_SECONDS: Readonly<Record<DashModuleCode, number>> = {
  ATT: 30,
  TASK: 60,
  LEAVE: 120,
  NOTI: 10,
  HR: 900,
  AUTH: 60,
  DASH: 60,
  SYSTEM: 60,
} as const;

/**
 * Min-interval REGENERATE khi ?refresh=true, per (user, widget). Trong khoảng này, refresh=true VẪN phục vụ
 * cache (chống cache-busting đập source). 10s = cận trên nhóm NOTI (nhóm TTL ngắn nhất) — refresh không bao giờ
 * ép regen dày hơn nhịp tươi tự nhiên của widget nhanh nhất.
 */
export const DASH_WIDGET_MIN_REFRESH_MS = 10_000;

/** Số dòng tối đa 1 widget List/Alert trả về (bound payload; widget dashboard là "liếc nhanh" không phân trang). */
export const DASH_WIDGET_LIST_CAP = 5;

/**
 * S4-DASH-BE-2-FIX-1 (root-cause BUG2) — trạng thái CHUNG-CUỘC (terminal) của `task_status` HIỆN ĐẠI
 * (mig 0478, TitleCase Todo/In Progress/In Review/Done/Cancelled — nguồn: TaskCoreService.getMyTasks,
 * packages/contracts taskCoreStatusSchema). TASK_ALERTS loại-trừ task đã Done/Cancelled khỏi "cần chú ý"
 * dù overdue/due-soon. TRƯỚC ĐÂY handler dùng set lowercase legacy ('completed'/'approved'/'cancelled')
 * — KHÔNG BAO GIỜ khớp giá trị TitleCase thật ⇒ alert không bao giờ loại-trừ Done/Cancelled (bug).
 * Đặt ở đây (const dùng chung) để test dùng chung, tránh trôi 2 nơi định nghĩa.
 */
export const TASK_TERMINAL_STATUSES: ReadonlySet<string> = new Set(["Done", "Cancelled"]);

/** TTL (giây) cho 1 entry theo module nguồn của nó. */
export function ttlSecondsFor(entry: DashWidgetEntry): number {
  return DASH_WIDGET_TTL_SECONDS[entry.moduleCode] ?? 60;
}

/** Tra widget entry theo slug (dataSourceKey). undefined ⇒ slug ngoài catalog (caller → 404). */
export function widgetEntryBySlug(slug: string): DashWidgetEntry | undefined {
  return DASH_WIDGET_CATALOG.find((w) => w.dataSourceKey === slug);
}

/** Cặp engine gate của widget (theo widgetCode). undefined ⇒ thiếu map (fail-closed ở handler). */
export function gatePairFor(widgetCode: string): EnginePair | undefined {
  return DASH_WIDGET_GATE_PAIR[widgetCode];
}
