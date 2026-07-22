import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BrandingKind } from "@mediaos/contracts";
import {
  brandingApi,
  foundationKeys,
  useCan,
  validateBrandingFile,
  type BrandingValidationError,
} from "@mediaos/web-core";
import { FOUNDATION_ENGINE_PAIRS } from "./constants";

/**
 * S5-BRAND-FE-1 — hook cho khối "Thương hiệu" ở /system/company (SYSTEM-SCREEN-COMPANY).
 *
 * Bọc GET /foundation/company/branding + upload/remove theo `kind` + pre-check MIME/size + scaffolding
 * chọn file. Mẫu `use-me-avatar.ts` (S5-ME-FE-4) nhưng có HAI kind (logo · favicon) nên state chọn-file
 * tách theo kind để hai ô không giẫm lên nhau (đang upload logo mà bấm favicon vẫn đúng).
 *
 * `canManage` (update:foundation-company) CHỈ gate HIỂN THỊ nút — server vẫn là chốt cuối (403).
 */
export function useCompanyBranding() {
  const queryClient = useQueryClient();
  const canManage = useCan(
    FOUNDATION_ENGINE_PAIRS.UPDATE_COMPANY.action,
    FOUNDATION_ENGINE_PAIRS.UPDATE_COMPANY.resourceType,
  );

  const query = useQuery({
    queryKey: foundationKeys.company.branding(),
    queryFn: () => brandingApi.getBranding(),
    // `url` khi source==='file' là presigned TTL ngắn (mặc định 300s). staleTime 60s << TTL ⇒ query stale
    // và refetch URL tươi trước khi hết hạn. Hạ TTL server xuống dưới ~60s thì phải chỉnh con số này.
    staleTime: 60_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: foundationKeys.company.branding() });

  const upload = useMutation({
    mutationFn: ({ kind, file }: { kind: BrandingKind; file: File }) =>
      brandingApi.uploadAsset(kind, file),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (kind: BrandingKind) => brandingApi.removeAsset(kind),
    onSuccess: invalidate,
  });

  // ── Scaffolding chọn file, TÁCH THEO KIND ──
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<{
    kind: BrandingKind;
    error: BrandingValidationError;
  } | null>(null);

  const inputRefOf = (kind: BrandingKind) => (kind === "logo" ? logoInputRef : faviconInputRef);

  const openPicker = (kind: BrandingKind) => {
    setValidationError(null);
    upload.reset(); // xoá lỗi lần trước để không lởn vởn khi mở lại
    remove.reset();
    inputRefOf(kind).current?.click();
  };

  const onFileSelected = (kind: BrandingKind) => (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset để chọn LẠI cùng 1 file vẫn kích onChange
    if (!file) return;
    const error = validateBrandingFile(kind, file);
    if (error) {
      setValidationError({ kind, error });
      return;
    }
    setValidationError(null);
    upload.mutate({ kind, file });
  };

  /** Kind đang có mutation chạy (để disable đúng ô, không khoá cả hai). */
  const pendingKind: BrandingKind | null = upload.isPending
    ? upload.variables.kind
    : remove.isPending
      ? remove.variables
      : null;

  return {
    canManage,
    query,
    upload,
    remove,
    pendingKind,
    logoInputRef,
    faviconInputRef,
    inputRefOf,
    openPicker,
    onFileSelected,
    validationError,
  };
}
