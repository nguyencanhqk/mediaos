import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assetApi, assetKeys, useCan } from "@mediaos/web-core";
import type { CreateAssetDto } from "@mediaos/contracts";
import { Button, EmptyState, Input, PageHeader, Select, Skeleton } from "@mediaos/ui";
import { ASSET_ENGINE_PAIRS } from "./constants";
import { assetErrorI18nKey, parseAssetError } from "./asset-errors";

interface AssetFormPageProps {
  /** `undefined` = tạo mới; có id = sửa. */
  assetId?: string;
  onSuccess: (id: string) => void;
  onCancel: () => void;
}

type FormState = {
  categoryId: string;
  name: string;
  serialNumber: string;
  brand: string;
  model: string;
  location: string;
  purchaseDate: string;
  purchasePrice: string;
  supplier: string;
  warrantyEndDate: string;
  description: string;
};

const EMPTY: FormState = {
  categoryId: "",
  name: "",
  serialNumber: "",
  brand: "",
  model: "",
  location: "",
  purchaseDate: "",
  purchasePrice: "",
  supplier: "",
  warrantyEndDate: "",
  description: "",
};

/** Ô rỗng ⇒ `null` (server phân biệt "không đặt" với chuỗi rỗng); số rỗng ⇒ `null`. */
const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

/**
 * ASSET-SCREEN-003 (S11-ASSET-FE-1) — form tạo / sửa hồ sơ tài sản.
 *
 * `assetCode` KHÔNG có trong form: nó sinh ở SERVER (ASSET-DEC-004, từ `code_prefix` của loại + bộ
 * đếm) và chỉ hiện read-only SAU khi tạo. `status` cũng không: PATCH mang `assetCode`/`status` bị
 * `.strict()` của Zod trả **400** ngay ở biên — đó là lý do form này không có ô nào cho hai trường ấy
 * thay vì có mà disable.
 *
 * Trường tài chính (`purchasePrice`/`supplier`) chỉ hiện khi người dùng THẤY được chúng ở chi tiết —
 * suy từ `=== undefined` của bản ghi đang sửa. Ở form TẠO thì luôn hiện: người có `create:asset` là
 * Company-scope (SPEC-13 §11) nên chắc chắn đọc được lại giá trị mình vừa nhập.
 */
export function AssetFormPage({ assetId, onSuccess, onCancel }: AssetFormPageProps) {
  const { t } = useTranslation("assets");
  const queryClient = useQueryClient();
  const isEdit = assetId !== undefined;

  const canCreate = useCan(
    ASSET_ENGINE_PAIRS.CREATE.action,
    ASSET_ENGINE_PAIRS.CREATE.resourceType,
  );
  const canUpdate = useCan(
    ASSET_ENGINE_PAIRS.UPDATE.action,
    ASSET_ENGINE_PAIRS.UPDATE.resourceType,
  );
  const allowed = isEdit ? canUpdate : canCreate;

  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  /** Bản ghi đang sửa có phơi trường tài chính không (vắng khoá = bị che). */
  const [financeVisible, setFinanceVisible] = useState(!isEdit);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const categoriesQuery = useQuery({
    queryKey: assetKeys.categories.list(),
    queryFn: () => assetApi.listCategories(),
    enabled: allowed,
    staleTime: 300_000,
  });
  // Chỉ loại ĐANG DÙNG mới chọn được: tạo hồ sơ với loại inactive bị chặn ở server
  // (kind `category-inactive`), nên đưa vào dropdown là mời người dùng ăn lỗi.
  const categories = (categoriesQuery.data ?? []).filter((c) => c.isActive);

  const detailQuery = useQuery({
    queryKey: assetKeys.detail(assetId ?? ""),
    queryFn: () => assetApi.getAsset(assetId as string),
    enabled: isEdit && allowed,
  });

  useEffect(() => {
    const a = detailQuery.data;
    if (!a) return;
    setFinanceVisible(a.purchasePrice !== undefined || a.supplier !== undefined);
    setForm({
      categoryId: a.category.id,
      name: a.name,
      serialNumber: a.serialNumber ?? "",
      brand: a.brand ?? "",
      model: a.model ?? "",
      location: a.location ?? "",
      purchaseDate: a.purchaseDate ?? "",
      purchasePrice: a.purchasePrice != null ? String(a.purchasePrice) : "",
      supplier: a.supplier ?? "",
      warrantyEndDate: a.warrantyEndDate ?? "",
      description: a.description ?? "",
    });
  }, [detailQuery.data]);

  const buildBody = (): CreateAssetDto => ({
    categoryId: form.categoryId,
    name: form.name.trim(),
    serialNumber: orNull(form.serialNumber),
    brand: orNull(form.brand),
    model: orNull(form.model),
    location: orNull(form.location),
    purchaseDate: orNull(form.purchaseDate),
    // Trường bị che ⇒ KHÔNG gửi lại: gửi `null` sẽ XOÁ giá trị server đang giữ mà người sửa không hề
    // thấy nó — mất dữ liệu im lặng đúng cho người vừa được masking bảo vệ.
    ...(financeVisible
      ? {
          purchasePrice: form.purchasePrice === "" ? null : Number(form.purchasePrice),
          supplier: orNull(form.supplier),
        }
      : {}),
    warrantyEndDate: orNull(form.warrantyEndDate),
    description: orNull(form.description),
  });

  const mutation = useMutation({
    mutationFn: () =>
      isEdit ? assetApi.updateAsset(assetId, buildBody()) : assetApi.createAsset(buildBody()),
    onSuccess: (asset) => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: [...assetKeys.all, "list"] });
      void queryClient.invalidateQueries({ queryKey: assetKeys.detail(asset.id) });
      onSuccess(asset.id);
    },
    onError: (err) => {
      const info = parseAssetError(err);
      setError(t(assetErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  if (!allowed) {
    return <EmptyState title={t("states.error")} />;
  }
  if (isEdit && detailQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const canSubmit = form.categoryId !== "" && form.name.trim() !== "" && !mutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader title={t(isEdit ? "form.editTitle" : "form.createTitle")} />

      {isEdit && detailQuery.data && (
        <p className="text-sm text-muted-foreground">
          {t("detail.fields.assetCode")}:{" "}
          <span className="font-mono">{detailQuery.data.assetCode}</span>
        </p>
      )}
      {!isEdit && <p className="text-sm text-muted-foreground">{t("form.assetCodeHint")}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("detail.fields.category")}</span>
          <Select value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("detail.fields.name")}</span>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("detail.fields.serialNumber")}</span>
          <Input value={form.serialNumber} onChange={(e) => set("serialNumber", e.target.value)} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("detail.fields.brand")}</span>
          <Input value={form.brand} onChange={(e) => set("brand", e.target.value)} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("detail.fields.model")}</span>
          <Input value={form.model} onChange={(e) => set("model", e.target.value)} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("detail.fields.location")}</span>
          <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("detail.fields.purchaseDate")}</span>
          <Input
            type="date"
            value={form.purchaseDate}
            onChange={(e) => set("purchaseDate", e.target.value)}
          />
        </label>

        <label className="text-sm">
          <span className="mb-1 block font-medium">{t("detail.fields.warrantyEndDate")}</span>
          <Input
            type="date"
            value={form.warrantyEndDate}
            onChange={(e) => set("warrantyEndDate", e.target.value)}
          />
        </label>

        {financeVisible && (
          <>
            <label className="text-sm">
              <span className="mb-1 block font-medium">{t("detail.fields.purchasePrice")}</span>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.purchasePrice}
                onChange={(e) => set("purchasePrice", e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">{t("detail.fields.supplier")}</span>
              <Input value={form.supplier} onChange={(e) => set("supplier", e.target.value)} />
            </label>
          </>
        )}

        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">{t("detail.fields.description")}</span>
          <Input value={form.description} onChange={(e) => set("description", e.target.value)} />
        </label>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {t("form.cancel")}
        </Button>
        <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
          {mutation.isPending
            ? t("states.saving")
            : t(isEdit ? "form.submitEdit" : "form.submitCreate")}
        </Button>
      </div>
    </div>
  );
}
