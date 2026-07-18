import { useTranslation } from "react-i18next";
import { Camera } from "lucide-react";
import { Avatar } from "@mediaos/ui";
import { AVATAR_ACCEPT_ATTR, useMeAvatar } from "../use-me-avatar";

interface MeBannerAvatarProps {
  /** Tên hiển thị — initials khi chưa có ảnh. */
  name?: string | null;
}

/**
 * S5-ME-FE-4 — avatar trên banner /me (MeIdentityBanner). Hiển thị ảnh thật (GET /me/avatar, fail-soft →
 * initials) + nút nhanh "Đổi ảnh" (overlay camera) khi canManage (update:avatar). Upload 4-pha qua useMeAvatar
 * (scaffolding chọn file dùng chung AvatarUploadCard). Lỗi hiển thị nhỏ dưới avatar (KHÔNG nuốt lỗi). Own-scope
 * do token — client KHÔNG gửi owner.
 */
export function MeBannerAvatar({ name }: MeBannerAvatarProps) {
  const { t } = useTranslation("me");
  const { canManage, upload, currentUrl, inputRef, openPicker, onFileSelected, validationError } =
    useMeAvatar();

  const errorMessage =
    validationError === "type"
      ? t("avatar.error.type")
      : validationError === "size"
        ? t("avatar.error.size")
        : upload.isError
          ? t("avatar.error.upload")
          : null;

  return (
    <div className="relative shrink-0">
      <Avatar
        name={name}
        src={currentUrl}
        size="lg"
        className={`h-16 w-16 text-xl ${upload.isPending ? "opacity-60" : ""}`}
        aria-label={t("avatar.alt")}
        aria-busy={upload.isPending}
      />

      {canManage && (
        <>
          <button
            type="button"
            onClick={openPicker}
            disabled={upload.isPending}
            aria-label={t("avatar.change")}
            title={t("avatar.change")}
            className="absolute -bottom-1 -right-1 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition hover:bg-muted disabled:opacity-60"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_ACCEPT_ATTR}
            className="hidden"
            onChange={onFileSelected}
          />
        </>
      )}

      {errorMessage && (
        <p
          role="alert"
          className="absolute left-1/2 top-full mt-1 w-40 -translate-x-1/2 rounded bg-destructive/10 px-1.5 py-0.5 text-center text-[11px] leading-tight text-destructive"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
