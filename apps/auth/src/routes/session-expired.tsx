import { useTranslation } from "react-i18next";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { getAuthRedirectUrl } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { AuthShell } from "@/components/AuthShell";

/**
 * /session-expired (UI-AUTH-SCREEN-004, SPEC-02 §14.4). Trang tĩnh: phiên đã hết hạn (refresh-fail) →
 * CTA đăng nhập lại. `redirectToAuth()` của web-core (nhánh refresh-fail) điều hướng thẳng về
 * `/login?redirect=<đích>` — trang này phục vụ khi người dùng ĐẾN ĐÂY trực tiếp (vd link cũ, tab
 * khôi phục bfcache) và cần một điểm hạ cánh rõ ràng thay vì `/login` trần không có ngữ cảnh.
 */
export function SessionExpiredPage() {
  const { t } = useTranslation("auth");

  const goToLogin = () => {
    // getAuthRedirectUrl() trỏ về CHÍNH apps/auth (`/login?redirect=<location hiện tại>`) — dùng URL gốc
    // của trình duyệt (KHÔNG lồng lại /session-expired vào redirect) để tránh vòng lặp điều hướng.
    window.location.assign(getAuthRedirectUrl());
  };

  return (
    <AuthShell heading={t("sessionExpired.heading")}>
      <div className="space-y-6 text-center">
        <ShieldAlert className="mx-auto size-10 text-amber-500" aria-hidden />
        <p className="text-sm text-muted-foreground">{t("sessionExpired.description")}</p>
        <Button className="w-full" onClick={goToLogin}>
          {t("sessionExpired.cta")}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </AuthShell>
  );
}
