import { Building2, FileClock, Database, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Module operator sắp triển khai — mỗi mục là 1 lane AC tương lai (placeholder scaffold).
 *  Nhãn lấy qua i18n `nav:modules.<key>` (FE §5: không hard-code chuỗi). */
const MODULES = [
  { key: "companies", icon: Building2, lane: "AC-1 / AC-2" },
  { key: "audit", icon: FileClock, lane: "AC-8" },
  { key: "flags", icon: SlidersHorizontal, lane: "AC-2 / AC-7" },
  { key: "dbOps", icon: Database, lane: "AC-9" },
] as const;

/** Trang chủ operator plane (scaffold AC-0a). Các module sẽ gắn vào ở lane sau. */
export function OperatorHomePage() {
  const { t } = useTranslation("nav");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("overview")}</h1>
        <p className="text-sm text-muted-foreground">{t("operator")}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {MODULES.map(({ key, icon: Icon, lane }) => (
          <Card key={key}>
            <CardHeader className="flex-row items-center gap-3 space-y-0">
              <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
              <div className="flex-1">
                <CardTitle className="text-base">{t(`modules.${key}`)}</CardTitle>
                <CardDescription>{lane}</CardDescription>
              </div>
              <Badge variant="secondary">{t("comingSoon")}</Badge>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
