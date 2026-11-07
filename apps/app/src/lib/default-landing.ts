/**
 * S20-DASH-TODAY-1 (US-X-08, biến thể B) — «Trang mở đầu» (`defaultLanding` của `/me/preferences`).
 *
 * Giá trị do người dùng/server lưu là CHUỖI TỰ DO (≤120 ký tự) ⇒ KHÔNG BAO GIỜ đưa thẳng vào điều hướng.
 * Quy tắc DƯƠNG: so khớp CHÍNH XÁC với allowlist; trúng thì trả về HẰNG của ta (không phải chuỗi đầu
 * vào), trượt (`/evil`, URL tuyệt đối, `//host`, `/\host`, có query/hash, khác hoa-thường, thừa
 * khoảng trắng/dấu `/` cuối…) ⇒ `/home`. Không startsWith, không regex lỏng.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { meApi, meKeys } from "@mediaos/web-core";

export const DEFAULT_LANDING_FALLBACK = "/home";

/** Trần thời gian giữ Home chưa vẽ khi lượt tải preferences đầu còn treo (chống nháy, không chặn lâu). */
export const DEFAULT_LANDING_HOLD_MAX_MS = 1500;

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

type Navigate = ReturnType<typeof useNavigate>;

/**
 * Mỗi mục allowlist → lời gọi điều hướng. `/home` + `/tasks/my-tasks` được router gõ kiểu (đổi tên route ⇒
 * lỗi biên dịch). `/dashboard` + `/me` sinh động từ ROUTE_REGISTRY nên KHÔNG có trong kiểu đường dẫn của
 * router ⇒ chỉ ép kiểu đúng HAI literal đó (không còn ép chung union về "/").
 */
const DEFAULT_LANDING_GO: Record<DefaultLandingPath, (navigate: Navigate) => Promise<void>> = {
  "/home": (navigate) => navigate({ to: "/home", replace: true }),
  "/dashboard": (navigate) => navigate({ to: "/dashboard" as "/", replace: true }),
  "/me": (navigate) => navigate({ to: "/me" as "/", replace: true }),
  "/tasks/my-tasks": (navigate) => navigate({ to: "/tasks/my-tasks", replace: true }),
};

/** Chuỗi lưu → đích an toàn (luôn thuộc allowlist, luôn cùng origin). */
export function resolveDefaultLanding(raw: unknown): DefaultLandingPath {
  if (typeof raw !== "string") return DEFAULT_LANDING_FALLBACK;
  const hit = DEFAULT_LANDING_OPTIONS.find((path) => path === raw);
  return hit ?? DEFAULT_LANDING_FALLBACK;
}

/**
 * Gắn ở route vào-app (`/`): sau khi `GET /me/preferences` về, chuyển (replace) MỘT lần tới đích đã chọn.
 * Lỗi/đang retry sau lỗi/quá trần DEFAULT_LANDING_HOLD_MAX_MS/chưa đặt/`/home` ⇒ vẽ Home ngay (fail-soft).
 * Trả `true` khi còn đang quyết định/đang chuyển ⇒ caller KHÔNG nên vẽ Home (tránh nháy trang rồi mới nhảy).
 * Các link «Về trang chủ» trong app trỏ `/home` (không qua `/`) nên không bị kéo lại trang đã bị chặn.
 */
export function useApplyDefaultLanding(): boolean {
  const navigate = useNavigate();
  const applied = useRef(false);
  const [timedOut, setTimedOut] = useState(false);
  const { data, isPending, failureCount } = useQuery({
    queryKey: meKeys.preferences(),
    queryFn: meApi.getPreferences,
    staleTime: 60_000,
  });
  // Lỗi (kể cả đang retry sau lỗi) hoặc quá trần ⇒ nhả Home ngay, không điều hướng muộn gây nháy.
  const released = timedOut || failureCount > 0;
  useEffect(() => {
    if (!isPending || released) return;
    const id = setTimeout(() => setTimedOut(true), DEFAULT_LANDING_HOLD_MAX_MS);
    return () => clearTimeout(id);
  }, [isPending, released]);
  const target = !released && data ? resolveDefaultLanding(data.defaultLanding) : null;
  useEffect(() => {
    if (applied.current || target === null) return;
    applied.current = true;
    if (target !== DEFAULT_LANDING_FALLBACK) void DEFAULT_LANDING_GO[target](navigate);
  }, [target, navigate]);
  if (released) return false;
  return isPending || (target !== null && target !== DEFAULT_LANDING_FALLBACK);
}
