import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { breakGlassApi } from "@/lib/break-glass-api";
import { BreakGlassGrantTable } from "@/components/break-glass/break-glass-grant-table";

/**
 * BreakGlassPage (🔒 G6-2 PR-B ROUND 2) — "My break-glass grants" self-service screen.
 *
 * Lists the caller's own emergency-access grants and exposes a Reveal control on ACTIVE grants only. The
 * plaintext is revealed JIT through SecretField (ephemeral; never enters the query cache / store). The list
 * endpoint is permission-gated server-side (request-break-glass) — a user lacking it gets the error state.
 */
export function BreakGlassPage() {
  const { t } = useTranslation("break-glass");

  const grantsQuery = useQuery({
    queryKey: ["break-glass", "my-grants"],
    queryFn: () => breakGlassApi.listMyGrants(),
  });

  // Reveal is NOT cached: call the API fresh each time and hand the plaintext straight to SecretField.
  const requestReveal = async (accountId: string): Promise<string | null> => {
    const { secret } = await breakGlassApi.reveal(accountId);
    return secret;
  };

  const grants = grantsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDesc")}</p>
      </div>

      {grantsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">{t("common:loading")}</p>
      )}
      {grantsQuery.isError && (
        <p className="text-sm text-destructive">
          {t("loadError")}{" "}
          {grantsQuery.error instanceof Error ? grantsQuery.error.message : ""}
        </p>
      )}
      {!grantsQuery.isLoading && !grantsQuery.isError && grants.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}

      {!grantsQuery.isError && grants.length > 0 && (
        <BreakGlassGrantTable grants={grants} onRequestReveal={requestReveal} />
      )}
    </div>
  );
}
