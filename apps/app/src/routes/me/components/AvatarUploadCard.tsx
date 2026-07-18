import { useTranslation } from "react-i18next";
import { Camera, Trash2 } from "lucide-react";
import { Avatar, Button, Card, CardContent } from "@mediaos/ui";
import { AVATAR_ACCEPT_ATTR, useMeAvatar } from "../use-me-avatar";

interface AvatarUploadCardProps {
  /** Tên hiển thị — sinh initials khi chưa có ảnh (Avatar fallback). */
  name?: string | null;
}

/**
 * S5-ME-FE-4 — card "Ảnh đại diện" own-scope (S5-ME-BE-4). Dùng ở /hr/me/profile (MyProfilePage). Hiển thị ảnh
 * hiện tại (GET /me/avatar, fail-soft → initials), nút Đổi ảnh (upload 4-pha) + Gỡ ảnh. Nút CHỈ hiện khi
 * canManage (update:avatar) — server vẫn là chốt cuối. Loading/error/empty đều xử lý. Scaffolding chọn file
 * dùng chung qua useMeAvatar (DRY với MeBannerAvatar).
 */
export function AvatarUploadCard({ name }: AvatarUploadCardProps) {
  const { t } = useTranslation("me");
  const {
    canManage,
    upload,
    remove,
    currentUrl,
    inputRef,
    openPicker,
    onFileSelected,
    validationError,
  } = useMeAvatar();

  const busy = upload.isPending || remove.isPending;

  const validationMessage =
    validationError === "type"
      ? t("avatar.error.type")
      : validationError === "size"
        ? t("avatar.error.size")
        : null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-4 sm:flex-row sm:items-center">
        <Avatar
          name={name}
          src={currentUrl}
          size="lg"
          className="h-20 w-20 text-2xl"
          aria-label={t("avatar.alt")}
        />

        <div className="flex-1 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t("avatar.title")}</h3>
            <p className="text-xs text-muted-foreground">{t("avatar.description")}</p>
          </div>

          {canManage && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={openPicker} disabled={busy}>
                  <Camera className="mr-2 h-4 w-4" />
                  {upload.isPending ? t("avatar.uploading") : t("avatar.change")}
                </Button>
                {currentUrl && (
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate()} disabled={busy}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {remove.isPending ? t("avatar.removing") : t("avatar.remove")}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t("avatar.hint")}</p>

              <input
                ref={inputRef}
                type="file"
                accept={AVATAR_ACCEPT_ATTR}
                className="hidden"
                onChange={onFileSelected}
              />

              {validationMessage && (
                <p role="alert" className="text-sm text-destructive">
                  {validationMessage}
                </p>
              )}
              {upload.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t("avatar.error.upload")}
                </p>
              )}
              {remove.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {t("avatar.error.remove")}
                </p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
