/**
 * MeIdentityBanner — banner chào theo tên + avatar (ME-SCREEN-001, SPEC-09 §10.1). `identity` LUÔN có
 * (account ok kể cả chưa liên kết employee — §12.2); khi `linkStatus='unlinked'` hiện thêm thông điệp liên
 * hệ HR (§12.2) thay vì phòng ban/chức vụ.
 */
import { useTranslation } from "react-i18next";
import { Avatar, Badge } from "@mediaos/ui";
import type { MeIdentity } from "@mediaos/contracts";

interface MeIdentityBannerProps {
  identity: MeIdentity;
}

export function MeIdentityBanner({ identity }: MeIdentityBannerProps) {
  const { t } = useTranslation("me");
  const { account, employee, linkStatus } = identity;
  const displayName = account.displayName ?? account.email;

  return (
    <div className="control-room-bg flex flex-wrap items-center gap-4 rounded-xl px-6 py-6">
      <Avatar name={displayName} size="lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-muted-foreground">{t("banner.greeting")}</p>
        <h1 className="brand-gradient-text font-display truncate text-xl font-bold tracking-tight sm:text-2xl">
          {displayName}
        </h1>
        {linkStatus === "linked" && employee ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {[employee.positionName, employee.departmentName, employee.employeeCode]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : (
          <div className="mt-2 space-y-0.5">
            <p className="text-sm font-medium text-warning">{t("banner.unlinkedTitle")}</p>
            <p className="text-xs text-muted-foreground">{t("banner.unlinkedDescription")}</p>
          </div>
        )}
        {account.roles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {account.roles.map((role) => (
              <Badge key={role.id} variant="brand">
                {role.name}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
