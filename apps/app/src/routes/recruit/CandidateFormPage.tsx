import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { recruitApi, recruitKeys, useCanExact } from "@mediaos/web-core";
import type {
  CandidateDuplicateResponseDto,
  CreateCandidateInput,
  UpdateCandidateInput,
} from "@mediaos/contracts";
import { Button, EmptyState, Input, PageHeader, Select, Skeleton } from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS } from "./constants";
import {
  parseRecruitError,
  recruitErrorI18nKey,
  shouldRotateIdempotencyKey,
} from "./recruit-errors";

interface CandidateFormPageProps {
  /** `undefined` = tạo mới; có id = sửa. */
  candidateId?: string;
  onSuccess: (id: string) => void;
  onCancel: () => void;
}

/**
 * Zod FORM schema (KHÁC `createCandidateSchema` của contracts): ô rỗng "" hợp lệ ở CLIENT (map → `null`
 * lúc submit) — dùng THẲNG schema server sẽ ăn `.email()` báo lỗi ngay khi ô email còn trống, đúng bẫy
 * `server-masking-needs-optional-fe-schema` phiên bản input. Payload gửi đi vẫn đúng kiểu
 * `CreateCandidateInput`/`UpdateCandidateInput` của contracts (ép compile-time ở `buildCreateBody`).
 */
const candidateFormSchema = z.object({
  jobOpeningId: z.string().min(1, "candidateForm.errors.selectJobOpening"),
  fullName: z.string().trim().min(1, "candidateForm.errors.required"),
  email: z.union([z.literal(""), z.string().trim().email("candidateForm.errors.invalidEmail")]),
  phone: z.string().trim(),
  source: z.string().trim(),
  note: z.string().trim(),
});
type CandidateFormValues = z.infer<typeof candidateFormSchema>;

const EMPTY_FORM: CandidateFormValues = {
  jobOpeningId: "",
  fullName: "",
  email: "",
  phone: "",
  source: "",
  note: "",
};

const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

export function CandidateFormPage({ candidateId, onSuccess, onCancel }: CandidateFormPageProps) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();
  const isEdit = candidateId !== undefined;

  const canCreate = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateCreate.action,
    RECRUIT_ENGINE_PAIRS.candidateCreate.resourceType,
  );
  const canUpdate = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateUpdate.action,
    RECRUIT_ENGINE_PAIRS.candidateUpdate.resourceType,
  );
  const allowed = isEdit ? canUpdate : canCreate;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CandidateFormValues>({
    resolver: zodResolver(candidateFormSchema),
    mode: "onSubmit",
    defaultValues: EMPTY_FORM,
  });

  const jobsQuery = useQuery({
    queryKey: recruitKeys.jobs.list({ status: ["Open"], scope: "candidate-form" }),
    queryFn: () => recruitApi.listJobOpenings({ status: ["Open"], per_page: 100 }),
    enabled: allowed,
    staleTime: 60_000,
  });

  const detailQuery = useQuery({
    queryKey: recruitKeys.candidates.detail(candidateId ?? ""),
    queryFn: () => recruitApi.getCandidate(candidateId as string),
    enabled: isEdit && allowed,
  });

  // Latch KEO THEO candidateId (KHÔNG phải boolean một-chiều): điều hướng A/edit → B/edit KHÔNG remount
  // component (cùng route, khác param) — latch cũ giữ nguyên "đã điền" nên form vẫn hiện dữ liệu của A,
  // Save sau đó ghi đè PII của B (mục 3 review-gate). Đổi candidateId ⇒ xoá form NGAY (tránh treo PII cũ
  // dưới danh nghĩa ứng viên mới) rồi chỉ điền lại khi dữ liệu ĐÚNG candidateId hiện tại đã tới.
  const filledForRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = candidateId ?? "__new__";
    if (filledForRef.current === key) return;
    if (!isEdit) {
      reset(EMPTY_FORM);
      filledForRef.current = key;
      return;
    }
    const c = detailQuery.data;
    if (!c) {
      reset(EMPTY_FORM);
      return; // chưa set filledForRef — effect chạy lại khi detailQuery.data (đúng candidateId) tới.
    }
    reset({
      jobOpeningId: c.jobOpeningId,
      fullName: c.fullName,
      email: c.email ?? "",
      phone: c.phone ?? "",
      source: c.source ?? "",
      note: c.note ?? "",
    });
    filledForRef.current = key;
  }, [candidateId, isEdit, detailQuery.data, reset]);

  // Idempotency-Key: sinh MỘT LẦN khi mở form tạo; xoay lại khi server báo KEY_REUSED.
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<CandidateDuplicateResponseDto[]>([]);

  const email = watch("email");
  const phone = watch("phone");

  const checkDuplicate = async (): Promise<void> => {
    if (isEdit) return; // Trùng lặp chỉ có ý nghĩa lúc TẠO mới.
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    if (trimmedEmail === "" && trimmedPhone === "") {
      setDuplicates([]);
      return;
    }
    try {
      const found = await recruitApi.checkDuplicate({
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        ...(trimmedPhone.length >= 3 ? { phone: trimmedPhone } : {}),
      });
      setDuplicates(found);
    } catch {
      // fail-soft: cảnh báo trùng KHÔNG chặn nhập liệu — im lặng bỏ qua lỗi mạng ở đây.
      setDuplicates([]);
    }
  };

  const buildCreateBody = (v: CandidateFormValues): CreateCandidateInput => ({
    jobOpeningId: v.jobOpeningId,
    fullName: v.fullName.trim(),
    email: orNull(v.email),
    phone: orNull(v.phone),
    source: orNull(v.source),
    note: orNull(v.note),
  });
  const buildUpdateBody = (v: CandidateFormValues): UpdateCandidateInput => ({
    jobOpeningId: v.jobOpeningId,
    fullName: v.fullName.trim(),
    email: orNull(v.email),
    phone: orNull(v.phone),
    source: orNull(v.source),
    note: orNull(v.note),
  });

  const mutation = useMutation({
    mutationFn: (values: CandidateFormValues) =>
      isEdit
        ? recruitApi.updateCandidate(candidateId, buildUpdateBody(values))
        : recruitApi.createCandidate(buildCreateBody(values), idempotencyKeyRef.current),
    onSuccess: (candidate) => {
      setServerError(null);
      void queryClient.invalidateQueries({ queryKey: recruitKeys.candidates.allOf() });
      void queryClient.invalidateQueries({ queryKey: recruitKeys.candidates.summary() });
      onSuccess(candidate.id);
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      if (shouldRotateIdempotencyKey(info)) idempotencyKeyRef.current = crypto.randomUUID();
      setServerError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  if (!allowed) return <EmptyState title={t("states.error")} />;
  if (isEdit && detailQuery.isLoading) return <Skeleton className="h-64 w-full" />;

  const errFor = (msg: string | undefined) => (msg ? t(msg) : undefined);

  return (
    <form
      onSubmit={(e) => void handleSubmit((v) => mutation.mutate(v))(e)}
      className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6"
    >
      <PageHeader
        title={t(isEdit ? "candidateForm.editTitle" : "candidateForm.createTitle")}
        actions={
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            <ArrowLeft className="mr-2 size-4" />
            {t("states.cancel")}
          </Button>
        }
      />

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("candidateForm.fields.jobOpening")}</span>
        <Select {...register("jobOpeningId")}>
          <option value="">{t("candidateForm.selectJobOpening")}</option>
          {(jobsQuery.data?.data ?? []).map((j) => (
            <option key={j.id} value={j.id}>
              {j.title}
            </option>
          ))}
        </Select>
        {errFor(errors.jobOpeningId?.message) && (
          <span className="mt-1 block text-xs text-danger">
            {errFor(errors.jobOpeningId?.message)}
          </span>
        )}
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("candidateForm.fields.fullName")}</span>
        <Input {...register("fullName")} />
        {errFor(errors.fullName?.message) && (
          <span className="mt-1 block text-xs text-danger">{errFor(errors.fullName?.message)}</span>
        )}
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("candidateForm.fields.email")}</span>
          <Input {...register("email")} onBlur={() => void checkDuplicate()} />
          {errFor(errors.email?.message) && (
            <span className="mt-1 block text-xs text-danger">{errFor(errors.email?.message)}</span>
          )}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("candidateForm.fields.phone")}</span>
          <Input {...register("phone")} onBlur={() => void checkDuplicate()} />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("candidateForm.fields.source")}</span>
        <Input {...register("source")} />
      </label>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("candidateForm.fields.note")}</span>
        <textarea
          rows={3}
          {...register("note")}
          className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {duplicates.length > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-sm text-warning">
          <p className="font-medium">{t("candidateForm.duplicateWarningTitle")}</p>
          <ul className="mt-1 space-y-0.5">
            {duplicates.map((d) => (
              <li key={d.id}>
                {t("candidateForm.duplicateEntry", {
                  fullName: d.fullName,
                  stage: t(`stage.${d.stage}`),
                  job: d.jobOpeningTitle,
                })}
                {d.deleted && ` ${t("candidateForm.duplicateDeletedHint")}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {serverError && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {serverError}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
          {t("states.cancel")}
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          <Save className="mr-2 size-4" />
          {mutation.isPending
            ? t("states.saving")
            : t(isEdit ? "candidateForm.submitEdit" : "candidateForm.submitCreate")}
        </Button>
      </div>
    </form>
  );
}
