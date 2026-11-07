/**
 * S20-DASH-TODAY-1 (US-X-08, biến thể B) — «Trang mở đầu» (`defaultLanding` của `/me/preferences`).
 *
 * Giá trị do người dùng/server lưu là CHUỖI TỰ DO (≤120 ký tự) ⇒ KHÔNG BAO GIỜ đưa thẳng vào điều hướng.
 * Quy tắc DƯƠNG: so khớp CHÍNH XÁC với allowlist; trúng thì trả về HẰNG của ta (không phải chuỗi đầu
 * vào), trượt (`/evil`, URL tuyệt đối, `//host`, `/\host`, có query/hash, khác hoa-thường, thừa
 * khoảng trắng/dấu `/` cuối…) ⇒ `/home`. Không startsWith, không regex lỏng.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { meApi, meKeys } from "@mediaos/web-core";

export const DEFAULT_LANDING_FALLBACK = "/home";

/** Các trang được chọn làm «Trang mở đầu» (thứ tự = thứ tự hiện ở /me). */
export const DEFAULT_LANDING_OPTIONS = ["/home", "/dashboard", "/me", "/tasks/my-tasks"] as const;
export type DefaultLandingPath = (typeof DEFAULT_LANDING_OPTIONS)[number];

/** Nhãn i18n (ns `me`) của từng lựa chọn. */
export const DEFAULT_LANDING_LABEL_KEY: Record<DefaultLandingPath, string> = {
  "/home": "appearancePage.landing.home",
  "/dashboard": "appearancePage.landing.dashboard",
  "/me": "appearancePage.landing.me",
  "/tasks/my-tasks": "appearancePage.landing.myTasks",
};

/** Chuỗi lưu → đích an toàn (luôn thuộc allowlist, luôn cùng origin). */
export function resolveDefaultLanding(raw: unknown): DefaultLandingPath {
  if (typeof raw !== "string") return DEFAULT_LANDING_FALLBACK;
  const hit = DEFAULT_LANDING_OPTIONS.find((path) => path === raw);
  return hit ?? DEFAULT_LANDING_FALLBACK;
}

/**
 * Gắn ở route vào-app (`/`): sau khi `GET /me/preferences` về, chuyển (replace) MỘT lần tới đích đã chọn.
 * Lỗi/chưa đặt/`/home` ⇒ ở nguyên (fail-soft, không chặn cổng ứng dụng).
 */
export function useApplyDefaultLanding(): void {
  const navigate = useNavigate();
  const applied = useRef(false);
  const { data } = useQuery({
    queryKey: meKeys.preferences(),
    queryFn: meApi.getPreferences,
    staleTime: 60_000,
  });
  const target = data ? resolveDefaultLanding(data.defaultLanding) : null;
  useEffect(() => {
    if (applied.current || target === null) return;
    applied.current = true;
    if (target !== DEFAULT_LANDING_FALLBACK) void navigate({ to: target as "/", replace: true }); // target ∈ allowlist (hằng của ta)
  }, [target, navigate]);
}
