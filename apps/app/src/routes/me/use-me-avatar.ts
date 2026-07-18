import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { meApi, meKeys, useCan } from "@mediaos/web-core";

/**
 * S5-ME-FE-4 — hook dùng chung cho AvatarUploadCard (/hr/me/profile) và MeBannerAvatar (/me). Bọc getAvatar
 * (own-scope, fail-soft null) + upload/remove mutation + client-side validation + scaffolding chọn file
 * (inputRef/openPicker/onFileSelected/validationError) — gộp Ở ĐÂY để 2 consumer KHÔNG lặp ~25 dòng.
 *
 * Owner resolve 100% từ token ở BE — client KHÔNG gửi user_id/employee_id (chống IDOR). Masking/own-scope là
 * việc SERVER. `canManage` (update:avatar) chỉ gate HIỂN THỊ nút — server vẫn là chốt cuối (403 nếu thiếu quyền).
 */

// Allowlist client PHẢI là tập con allowlist server (setting-defaults: image/png|jpeg|webp) — tránh chọn xong
// mới 415. Server re-validate + re-detect: đây chỉ là pre-check cho UX (thông điệp sớm).
export const ACCEPTED_AVATAR_MIME = ["image/png", "image/jpeg", "image/webp"] as const;
export const AVATAR_ACCEPT_ATTR = ACCEPTED_AVATAR_MIME.join(",");
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB

export type AvatarValidationError = "type" | "size";

/** Pre-check phía client (server vẫn là chốt). null = hợp lệ. */
export function validateAvatarFile(file: File): AvatarValidationError | null {
  if (!(ACCEPTED_AVATAR_MIME as readonly string[]).includes(file.type)) return "type";
  if (file.size > MAX_AVATAR_BYTES) return "size";
  return null;
}

export function useMeAvatar() {
  const queryClient = useQueryClient();
  const canManage = useCan("update", "avatar");

  const query = useQuery({
    queryKey: meKeys.avatar(),
    queryFn: () => meApi.getAvatar(),
    // downloadUrl ephemeral: server presign TTL mặc định 300s (S3_PRESIGN_TTL_SEC). staleTime 60s << TTL ⇒
    // query stale + refetch URL tươi trước khi hết hạn. (Nếu operator hạ TTL < ~60s thì cần chỉnh con số này.)
    staleTime: 60_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: meKeys.avatar() });

  const upload = useMutation({
    mutationFn: (file: File) => meApi.uploadAvatar(file),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => meApi.removeAvatar(),
    onSuccess: invalidate,
  });

  // ── Scaffolding chọn file (dùng chung card + banner) ──
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<AvatarValidationError | null>(null);

  const openPicker = () => {
    setValidationError(null);
    upload.reset(); // xoá message lỗi upload lần trước để không lởn vởn khi mở lại
    inputRef.current?.click();
  };

  const onFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset để chọn LẠI cùng 1 file vẫn kích onChange
    if (!file) return;
    const err = validateAvatarFile(file);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    upload.mutate(file);
  };

  return {
    canManage,
    query,
    upload,
    remove,
    currentUrl: query.data?.downloadUrl ?? null,
    inputRef,
    openPicker,
    onFileSelected,
    validationError,
  };
}
