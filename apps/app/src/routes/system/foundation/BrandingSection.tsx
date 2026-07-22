import { useTranslation } from "react-i18next";
import { ImageIcon, Trash2, Upload } from "lucide-react";
import type { BrandingAsset, BrandingKind } from "@mediaos/contracts";
import { brandingAcceptAttr, mapApiErrorToUi } from "@mediaos/web-core";
import { Button, Card, CardContent } from "@mediaos/ui";
import { useCompanyBranding } from "./use-company-branding";

/**
 * S5-BRAND-FE-1 — khối "Thương hiệu" trong /system/company (SYSTEM-SCREEN-COMPANY).
 *
 * Hiển thị logo + favicon hiện tại (preview từ `url`, placeholder khi null) + nút tải lên/thay/gỡ. Nút CHỈ
 * hiện khi `update:foundation-company` (useCan — KHÔNG hard-code role); server vẫn là chốt cuối.
 * Pre-check MIME/size phía client chỉ để báo sớm — server re-validate (415/413).
 *
 * States: loading · error · empty (chưa đặt) · view. Lỗi hiển thị bằng `mapApiErrorToUi` để 403/422/500
 * ra đúng thông điệp thay vì message thô.
 */
export function BrandingSection() {
  const { t } = useTranslation("system");
  const {
    canManage,
    query,
    upload,
    remove,
    pendingKind,
    inputRefOf,
    openPicker,
    onFileSelected,
    validationError,
  } = useCompanyBranding();

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">{t("branding.loading")}</p>
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <Card>
        <CardContent className="pt-4">
          <p role="alert" className="text-sm text-destructive">
            {mapApiErrorToUi(query.error).message}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>
            {t("branding.retry")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const mutationError = upload.isError
    ? mapApiErrorToUi(upload.error).message
    : remove.isError
      ? mapApiErrorToUi(remove.error).message
      : null;

  return (
    <Card>
      <CardContent className="space-y-6 pt-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("branding.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("branding.description")}</p>
        </div>

        {(["logo", "favicon"] as const).map((kind) => (
          <BrandingRow
            key={kind}
            kind={kind}
            asset={query.data?.[kind] ?? null}
            canManage={canManage}
            busy={pendingKind === kind}
            anyBusy={pendingKind !== null}
            inputRef={inputRefOf(kind)}
            onPick={() => openPicker(kind)}
            onFile={onFileSelected(kind)}
            onRemove={() => remove.mutate(kind)}
            validationMessage={
              validationError?.kind === kind
                ? t(`branding.error.${validationError.error}`, {
                    kinds: t(`branding.kind.${kind}`),
                  })
                : null
            }
          />
        ))}

        {mutationError && (
          <p role="alert" className="text-sm text-destructive">
            {mutationError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface BrandingRowProps {
  kind: BrandingKind;
  asset: BrandingAsset | null;
  canManage: boolean;
  busy: boolean;
  anyBusy: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: () => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  validationMessage: string | null;
}

/** Một dòng tài sản (logo HOẶC favicon): preview + nút. Tách ra để 2 kind không lặp markup. */
function BrandingRow({
  kind,
  asset,
  canManage,
  busy,
  anyBusy,
  inputRef,
  onPick,
  onFile,
  onRemove,
  validationMessage,
}: BrandingRowProps) {
  const { t } = useTranslation("system");
  const label = t(`branding.kind.${kind}`);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0 sm:flex-row sm:items-center">
      {/* Preview: nền checker-ish để logo nền trong suốt vẫn nhìn được ở cả 2 theme. */}
      <div
        className={
          "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted " +
          (kind === "logo" ? "h-16 w-32" : "h-16 w-16")
        }
      >
        {asset ? (
          <img
            src={asset.url}
            alt={t("branding.previewAlt", { kind: label })}
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <ImageIcon className="h-6 w-6 text-muted-foreground" aria-hidden />
        )}
      </div>

      <div className="flex-1 space-y-2">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{t(`branding.hint.${kind}`)}</p>
          {!asset && <p className="text-xs text-muted-foreground">{t("branding.empty")}</p>}
        </div>

        {canManage && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={onPick} disabled={anyBusy}>
                <Upload className="mr-2 h-4 w-4" />
                {busy
                  ? t("branding.uploading")
                  : asset
                    ? t("branding.change")
                    : t("branding.upload")}
              </Button>
              {asset && (
                <Button variant="ghost" size="sm" onClick={onRemove} disabled={anyBusy}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("branding.remove")}
                </Button>
              )}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept={brandingAcceptAttr(kind)}
              className="hidden"
              onChange={onFile}
              data-testid={`branding-input-${kind}`}
            />

            {validationMessage && (
              <p role="alert" className="text-sm text-destructive">
                {validationMessage}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
