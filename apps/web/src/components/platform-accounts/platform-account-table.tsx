import type { SafePlatformAccountDto } from "@mediaos/contracts";
import { KeyRound } from "lucide-react";
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
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Tài khoản</th>
            <th className="px-4 py-2 font-medium">Nền tảng</th>
            <th className="px-4 py-2 font-medium">Định danh</th>
            <th className="px-4 py-2 font-medium">Bảo mật</th>
            <th className="px-4 py-2 font-medium">Trạng thái</th>
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
                      label={`secret của ${label}`}
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
                      aria-label={`Đổi secret của ${label}`}
                    >
                      <KeyRound className="size-4" />
                      Đổi secret
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
