import type { SafePlatformAccountDto } from "@mediaos/contracts";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PermissionGate } from "@/components/permission-gate";
import { Button } from "@/components/ui/button";
import { SecretField } from "./secret-field";
import {
  platformAccountStatusColor,
  platformAccountStatusLabel,
  securityLevelLabel,
} from "./constants";

interface PlatformAccountTableProps {
  accounts: SafePlatformAccountDto[];
  /** Map platformId → tên hiển thị (từ catalog platforms). */
  platformName: (platformId: string) => string;
  /** Mở step-up + reveal cho 1 account; resolve plaintext (hoặc null nếu huỷ). */
  onRequestReveal: (accountId: string, accountLabel?: string) => Promise<string | null>;
  /** Mở form đổi secret (rotate) cho 1 account. */
  onEditSecret: (account: SafePlatformAccountDto) => void;
}

export function PlatformAccountTable({
  accounts,
  platformName,
  onRequestReveal,
  onEditSecret,
}: PlatformAccountTableProps) {
  const { t } = useTranslation("settings");
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">{t("platformAccounts.table.colAccount")}</th>
            <th className="px-4 py-2 font-medium">{t("platformAccounts.table.colPlatform")}</th>
            <th className="px-4 py-2 font-medium">{t("platformAccounts.table.colIdentifier")}</th>
            <th className="px-4 py-2 font-medium">{t("platformAccounts.table.colSecurity")}</th>
            <th className="px-4 py-2 font-medium">{t("common:status")}</th>
            <th className="px-4 py-2 font-medium">Secret</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {accounts.map((account) => {
            const label = account.accountName ?? account.accountIdentifier ?? account.id;
            return (
              <tr key={account.id} className="align-top">
                <td className="px-4 py-3">
                  <div className="font-medium">{account.accountName ?? "—"}</div>
                  {account.accountEmail && (
                    <div className="text-xs text-muted-foreground">{account.accountEmail}</div>
                  )}
                </td>
                <td className="px-4 py-3">{platformName(account.platformId)}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {account.accountIdentifier ?? "—"}
                </td>
                <td className="px-4 py-3">{securityLevelLabel(account.securityLevel)}</td>
                <td className="px-4 py-3">
                  <span className={platformAccountStatusColor(account.status)}>
                    {platformAccountStatusLabel(account.status)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <PermissionGate
                    action="reveal-secret"
                    resourceType="platform-account"
                    fallback={
                      <code className="rounded bg-muted px-2 py-1 font-mono text-xs tracking-widest text-muted-foreground">
                        ••••••••••
                      </code>
                    }
                  >
                    <SecretField
                      label={t("platformAccounts.table.secretLabel", { label })}
                      onRequestReveal={() => onRequestReveal(account.id, label)}
                    />
                  </PermissionGate>
                </td>
                <td className="px-4 py-3 text-right">
                  <PermissionGate action="edit-platform-account" resourceType="platform-account">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEditSecret(account)}
                      aria-label={t("platformAccounts.table.editSecretAriaLabel", { label })}
                    >
                      <KeyRound className="size-4" />
                      {t("platformAccounts.table.editSecretButton")}
                    </Button>
                  </PermissionGate>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
