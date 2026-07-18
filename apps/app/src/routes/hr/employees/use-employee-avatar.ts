import { useRef, useState, type ChangeEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { employeeAvatarApi, hrKeys, useCan } from "@mediaos/web-core";
import { validateAvatarFile, type AvatarValidationError } from "../../me/use-me-avatar";

/**
 * S5-HR-AVATAR-1 — hook cho HR/admin đặt/gỡ avatar của NHÂN VIÊN KHÁC (EmployeeDetailPage). MIRROR
 * `useMeAvatar` (own-scope, /hr/me/profile) nhưng:
 *   - gate `canManage` = `update:employee` (reuse cặp sửa hồ sơ — KHÔNG cặp quyền mới, khớp BE
 *     `assertWriteScope('update')`) thay vì `update:avatar`.
 *   - KHÔNG có query riêng lấy avatar hiện tại — `EmployeeDetailPage` đã có `data.avatarUrl` từ
 *     `GET /hr/employees/:id` (server resolve signed URL). Sau upload/remove chỉ cần invalidate
 *     `hrKeys.employees.detail(employeeId)` để refetch employee detail (set/remove response KHÔNG
 *     có URL — BẤT BIẾN: client KHÔNG tự suy URL từ fileId).
 *
 * Validate client-side (type/size) TÁI DÙNG `validateAvatarFile` của `useMeAvatar` (DRY — cùng
 * allowlist server: image/png|jpeg|webp, ≤5MB). Server vẫn là chốt cuối (403/415 nếu vượt).
 */
export function useEmployeeAvatar(employeeId: string) {
  const queryClient = useQueryClient();
  const canManage = useCan("update", "employee");

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: hrKeys.employees.detail(employeeId) });

  const upload = useMutation({
    mutationFn: (file: File) => employeeAvatarApi.uploadEmployeeAvatar(employeeId, file),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: () => employeeAvatarApi.removeEmployeeAvatar(employeeId),
    onSuccess: invalidate,
  });

  // ── Scaffolding chọn file (mirror useMeAvatar) ──
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
    upload,
    remove,
    inputRef,
    openPicker,
    onFileSelected,
    validationError,
  };
}
