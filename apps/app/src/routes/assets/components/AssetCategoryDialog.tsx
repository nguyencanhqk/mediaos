import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { assetApi, assetKeys } from "@mediaos/web-core";
import {
  ASSET_CODE_PREFIX_RE,
  type AssetCategoryResponseDto,
  type CreateAssetCategoryDto,
} from "@mediaos/contracts";
import { Badge, Button, Dialog, Input, Skeleton } from "@mediaos/ui";
import { assetErrorI18nKey, parseAssetError, readPrefixTakenHolder } from "../asset-errors";

interface AssetCategoryDialogProps {
  open: boolean;
  onClose: () => void;
}

const EMPTY_FORM: CreateAssetCategoryDto = {
  code: "",
  name: "",
  codePrefix: "",
  description: null,
  defaultMaintenanceIntervalDays: null,
};

/**
 * ASSET-SCREEN-007 (S11-ASSET-FE-1) — quản trị loại tài sản. Hộp thoại TRONG /assets (SPEC-13 §9),
 * không phải route riêng: nó là màn duy nhất của cặp `('manage','asset-category')` và luôn được mở từ
 * danh sách.
 *
 * Ba điểm nghiệp vụ dễ mất nếu chỉ làm CRUD thẳng:
 *
 *  1. **`includeDeleted=true` là đường DUY NHẤT phát ra id của loại đã xoá mềm.** Không bật nó thì
 *     `PATCH { restore: true }` là route chết — không endpoint nào khác trả về id đó để mà khôi phục.
 *  2. **`code_prefix` unique KHÔNG partial.** Prefix từng dùng ⇒ mã `TS-<PREFIX>-0001` đã tồn tại, cấp
 *     lại là đụng mã cũ. Nên khi tạo mới đụng `prefix-taken`, ta đọc `details.categoryId`/`deleted` và
 *     chỉ thẳng sang loại đang giữ prefix — khôi phục nó là cách DUY NHẤT dùng lại prefix đó.
 *  3. **`code` thì NGƯỢC LẠI** — unique partial theo `deleted_at IS NULL`, nên code của loại đã xoá
 *     dùng lại được bình thường. Hai vế này khác nhau, gộp thông điệp là chỉ sai đường cho người dùng.
 */
export function AssetCategoryDialog({ open, onClose }: AssetCategoryDialogProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();

  const [showDeleted, setShowDeleted] = useState(false);
  const [form, setForm] = useState<CreateAssetCategoryDto>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [prefixHolder, setPrefixHolder] = useState<{ categoryId: string; deleted: boolean } | null>(
    null,
  );

  const listParams = { includeInactive: true, includeDeleted: showDeleted };
  const listQuery = useQuery({
    queryKey: assetKeys.categories.list(listParams),
    queryFn: () => assetApi.listCategories(listParams),
    enabled: open,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: assetKeys.categories.all });
    // Danh sách tài sản hiện TÊN loại ⇒ đổi loại phải làm mới cả list. KHÔNG invalidate `assetKeys.all`
    // (nuốt luôn cả detail/summary đang mở) — chỉ nhánh list.
    void queryClient.invalidateQueries({ queryKey: [...assetKeys.all, "list"] });
  };

  /** Gom xử lý lỗi: đọc kind → thông điệp i18n; riêng `prefix-taken` còn dựng gợi ý khôi phục. */
  const handleError = (error: unknown) => {
    const info = parseAssetError(error);
    setFormError(t(assetErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    setPrefixHolder(readPrefixTakenHolder(info));
  };

  const createMutation = useMutation({
    mutationFn: (body: CreateAssetCategoryDto) => assetApi.createCategory(body),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setFormError(null);
      setPrefixHolder(null);
      invalidate();
    },
    onError: handleError,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => assetApi.updateCategory(id, { restore: true }),
    onSuccess: () => {
      setFormError(null);
      setPrefixHolder(null);
      invalidate();
    },
    onError: handleError,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      assetApi.updateCategory(id, { isActive }),
    onSuccess: invalidate,
    onError: handleError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => assetApi.deleteCategory(id),
    onSuccess: invalidate,
    onError: handleError,
  });

  const prefixValid = ASSET_CODE_PREFIX_RE.test(form.codePrefix);
  const canSubmit =
    form.code.trim() !== "" && form.name.trim() !== "" && prefixValid && !createMutation.isPending;

  const rows: AssetCategoryResponseDto[] = listQuery.data ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("category.title")}
      className="max-w-3xl"
      footer={
        <Button variant="outline" onClick={onClose}>
          {t("form.cancel")}
        </Button>
      }
    >
      <div className="space-y-5">
        {/* Tạo loại mới */}
        <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">{t("category.code")}</span>
            <Input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">{t("category.name")}</span>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">{t("category.codePrefix")}</span>
            <Input
              value={form.codePrefix}
              onChange={(e) => setForm((f) => ({ ...f, codePrefix: e.target.value.toUpperCase() }))}
              aria-invalid={form.codePrefix !== "" && !prefixValid}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("category.codePrefixHint")}
            </span>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">{t("category.maintenanceIntervalDays")}</span>
            <Input
              type="number"
              min={1}
              value={form.defaultMaintenanceIntervalDays ?? ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  defaultMaintenanceIntervalDays:
                    e.target.value === "" ? null : Number(e.target.value),
                }))
              }
            />
          </label>
          <div className="sm:col-span-2 flex justify-end">
            <Button size="sm" disabled={!canSubmit} onClick={() => createMutation.mutate(form)}>
              <Plus className="mr-2 size-4" />
              {t("category.create")}
            </Button>
          </div>
        </div>

        {formError && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            <p>{formError}</p>
            {/* Prefix đã bị một loại ĐÃ XOÁ chiếm ⇒ chỉ thẳng đường khôi phục: đó là cách DUY NHẤT
                dùng lại prefix (unique không partial). Prefix bị loại ĐANG SỐNG chiếm thì không có
                đường nào cả — người dùng phải đổi prefix, nên không hiện nút. */}
            {prefixHolder?.deleted && (
              <Button
                size="sm"
                variant="outline"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate(prefixHolder.categoryId)}
              >
                <RotateCcw className="mr-2 size-4" />
                {t("category.restore")}
              </Button>
            )}
          </div>
        )}

        {/* Danh sách loại */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          {t("category.showDeleted")}
        </label>

        {listQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("category.empty")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{c.codePrefix}</span>
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground">({c.code})</span>
                {c.deleted ? (
                  <Badge variant="muted">{t("category.deletedAt")}</Badge>
                ) : c.isActive ? (
                  <Badge variant="success">{t("category.isActive")}</Badge>
                ) : (
                  <Badge variant="warning">{t("category.isActive")}: —</Badge>
                )}
                <span className="ml-auto flex gap-1">
                  {c.deleted ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={restoreMutation.isPending}
                      onClick={() => restoreMutation.mutate(c.id)}
                    >
                      <RotateCcw className="mr-1 size-3.5" />
                      {t("category.restore")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={toggleActiveMutation.isPending}
                        onClick={() =>
                          toggleActiveMutation.mutate({ id: c.id, isActive: !c.isActive })
                        }
                      >
                        {c.isActive ? "⏸" : "▶"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(t("category.deleteConfirm"))) {
                            deleteMutation.mutate(c.id);
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
