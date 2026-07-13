import type { BreakGlassGrantDto } from "@mediaos/contracts";
import { useTranslation } from "react-i18next";
import { SecretField } from "@/components/platform-accounts/secret-field";

interface BreakGlassGrantTableProps {
  grants: BreakGlassGrantDto[];
  /**
   * Reveal the secret for one account via its active grant; resolves the plaintext ONCE (or null on
   * cancel). Wired to break-glass reveal API by the parent. SecretField keeps the plaintext ephemeral.
   */
  onRequestReveal: (accountId: string) => Promise<string | null>;
}

/** A grant authorizes reveal only while it is 'active' AND not past its TTL (server re-checks via now()). */
function isRevealable(grant: BreakGlassGrantDto): boolean {
  return grant.status === "active" && new Date(grant.expiresAt).getTime() > Date.now();
}

function statusClass(status: BreakGlassGrantDto["status"]): string {
  if (status === "active") return "text-success";
  if (status === "revoked") return "text-muted-foreground line-through";
  return "text-warning";
}

/**
 * BreakGlassGrantTable (🔒 G6-2 PR-B ROUND 2) — lists the caller's own emergency-access grants with SoD
 * progress + a Reveal control gated to ACTIVE grants only. The plaintext lives ONLY inside SecretField's
 * local state (no query cache / store / storage), masked by default, auto-hidden, cleared on blur/unmount.
 * The server still enforces both gates (permission + active grant) on every reveal — this gating is UI hint.
 */
export function BreakGlassGrantTable({ grants, onRequestReveal }: BreakGlassGrantTableProps) {
  const { t } = useTranslation("break-glass");
  const dateFmt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">{t("table.colAccount")}</th>
            <th className="px-4 py-2 font-medium">{t("table.colReason")}</th>
            <th className="px-4 py-2 font-medium">{t("table.colStatus")}</th>
            <th className="px-4 py-2 font-medium">{t("table.colApprovals")}</th>
            <th className="px-4 py-2 font-medium">{t("table.colExpires")}</th>
            <th className="px-4 py-2 font-medium">{t("table.colSecret")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {grants.map((grant) => (
            <tr key={grant.id} className="align-top" data-testid="break-glass-grant-row">
              <td className="px-4 py-3 font-mono text-xs">{grant.platformAccountId}</td>
              <td className="px-4 py-3">{grant.reason}</td>
              <td className="px-4 py-3">
                <span className={statusClass(grant.status)}>{t(`status.${grant.status}`)}</span>
              </td>
              <td className="px-4 py-3">
                {grant.approvalCount}/{grant.requiredApprovals}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {dateFmt.format(new Date(grant.expiresAt))}
              </td>
              <td className="px-4 py-3">
                {isRevealable(grant) ? (
                  <SecretField
                    label={t("table.secretLabel")}
                    onRequestReveal={() => onRequestReveal(grant.platformAccountId)}
                  />
                ) : (
                  <span data-testid="reveal-unavailable" className="text-xs text-muted-foreground">
                    {t("table.revealUnavailable")}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
