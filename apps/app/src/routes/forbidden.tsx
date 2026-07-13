import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

interface ForbiddenPageProps {
  reason?: string;
}

/**
 * Trang 403 — hiển thị khi user trái quyền truy cập route.
 *
 * Nhận `reason` từ route guard (NO_PERMISSION / NO_SCOPE / USER_INACTIVE / …).
 * Nếu không có reason hoặc reason không khớp key i18n → hiển thị mô tả mặc định.
 */
export function ForbiddenPage({ reason }: ForbiddenPageProps) {
  const { t } = useTranslation("nav");

  const knownReasons = [
    "NO_PERMISSION",
    "NO_SCOPE",
    "USER_INACTIVE",
    "COMPANY_INACTIVE",
    "MODULE_DISABLED",
    "FEATURE_DISABLED",
  ] as const;

  type KnownReason = (typeof knownReasons)[number];

  const isKnown = (r: string | undefined): r is KnownReason =>
    knownReasons.includes(r as KnownReason);

  const reasonText = isKnown(reason) ? t(`forbidden.reason.${reason}`) : t("forbidden.description");

  // flex-1/min-h-full: trong ProtectedShell (đã khóa h-dvh) lấp đầy vùng nội dung
  // và căn giữa; render standalone (/403 không shell) thì rơi về chiều cao nội dung + py-16.
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <span className="text-6xl font-bold text-muted-foreground/30">403</span>
      <h1 className="text-xl font-semibold text-foreground">{t("forbidden.title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{reasonText}</p>
      <Link
        to="/"
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {t("forbidden.goHome")}
      </Link>
    </div>
  );
}
