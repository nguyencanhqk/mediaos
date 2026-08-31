import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  recruitApi,
  recruitKeys,
  useCan,
  useCanExact,
  createIdempotencyKey,
} from "@mediaos/web-core";
import type { CandidateStageDto, OfferResponseDto, OfferStatusDto } from "@mediaos/contracts";
import { recruitSalarySchema } from "@mediaos/contracts";
import { Button, Dialog, EmptyState, Input, Select, Skeleton } from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS } from "../constants";
import { availableOfferStatusTargets, canConvert } from "../recruit-actions";
import {
  parseRecruitError,
  recruitErrorI18nKey,
  shouldRotateIdempotencyKey,
} from "../recruit-errors";
import { OfferStatusBadge } from "./StatusBadges";

interface OfferTabProps {
  candidateId: string;
  candidateStage: CandidateStageDto;
  candidateEmployeeId: string | null;
  onConverted: (employeeCode: string) => void;
}

/**
 * REC-SCREEN-006 (S12-RECRUIT-FE-1) — tab Offer & chuyển thành nhân viên trong chi tiết ứng viên.
 * `salary` VẮNG KHOÁ khi thiếu `manage:offer` (contracts `.optional()`) ⇒ render "🔒 ẩn theo quyền"
 * thay vì hàng trống — hiện hàng trống vẫn rò rỉ "có dữ liệu ở đây mà bạn không được xem".
 */
export function OfferTab({
  candidateId,
  candidateStage,
  candidateEmployeeId,
  onConverted,
}: OfferTabProps) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();

  const canView = useCan(
    RECRUIT_ENGINE_PAIRS.offerList.action,
    RECRUIT_ENGINE_PAIRS.offerList.resourceType,
  );
  const canManage = useCan(
    RECRUIT_ENGINE_PAIRS.offerCreate.action,
    RECRUIT_ENGINE_PAIRS.offerCreate.resourceType,
  );
  const canConvertPerm = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateConvert.action,
    RECRUIT_ENGINE_PAIRS.candidateConvert.resourceType,
  );

  const [formTarget, setFormTarget] = useState<
    { kind: "none" } | { kind: "create" } | { kind: "edit"; offer: OfferResponseDto }
  >({ kind: "none" });
  const [statusTarget, setStatusTarget] = useState<OfferResponseDto | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertedCode, setConvertedCode] = useState<string | null>(null);
  // Idempotency-Key ổn định theo LẦN MỞ dialog xác nhận (KHÔNG sinh trong mutationFn — mỗi attempt một
  // khoá mới làm @Idempotent BE thành trang trí, double-click convert tạo 2 nhân viên — mục 7).
  const convertKeyRef = useRef(createIdempotencyKey());
  useEffect(() => {
    if (convertOpen) convertKeyRef.current = createIdempotencyKey();
  }, [convertOpen]);

  const offersQuery = useQuery({
    queryKey: recruitKeys.offers.list({ candidateId }),
    queryFn: () => recruitApi.listOffers({ candidateId }),
    enabled: canView,
  });
  const offers = offersQuery.data?.data ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: recruitKeys.offers.allOf() });
  };

  const convertMutation = useMutation({
    mutationFn: () => recruitApi.convertCandidate(candidateId, convertKeyRef.current),
    onSuccess: (res) => {
      setConvertedCode(res.employeeCode);
      setConvertError(null);
      void queryClient.invalidateQueries({ queryKey: recruitKeys.candidates.allOf() });
      onConverted(res.employeeCode);
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      if (shouldRotateIdempotencyKey(info)) convertKeyRef.current = createIdempotencyKey();
      setConvertError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  const allowConvert = canConvert(
    { stage: candidateStage, employeeId: candidateEmployeeId },
    offers,
    canConvertPerm,
  );

  if (!canView) return <EmptyState title={t("states.error")} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("offers.title")}</p>
        {canManage && (
          <Button size="sm" onClick={() => setFormTarget({ kind: "create" })}>
            {t("offers.create")}
          </Button>
        )}
      </div>

      {offersQuery.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : offers.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("offers.empty")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {offers.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{o.title ?? "—"}</p>
                <p className="text-xs text-muted-foreground">
                  {o.startDate} · {o.salary !== undefined ? o.salary : t("offers.salaryHidden")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <OfferStatusBadge status={o.status} />
                {canManage && o.status === "Draft" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFormTarget({ kind: "edit", offer: o })}
                  >
                    {t("offers.edit")}
                  </Button>
                )}
                {canManage && availableOfferStatusTargets(o.status).length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setStatusTarget(o)}>
                    {t("offers.changeStatus")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-md border border-border p-3">
        <p className="text-sm font-medium">{t("offers.convert.title")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("offers.convert.hint")}</p>
        {convertedCode ? (
          <p className="mt-2 text-sm text-success">
            {t("offers.convert.success", { employeeCode: convertedCode })}
          </p>
        ) : (
          <Button
            className="mt-2"
            size="sm"
            disabled={!allowConvert}
            onClick={() => setConvertOpen(true)}
          >
            {t("offers.convert.button")}
          </Button>
        )}
        {convertError && <p className="mt-2 text-sm text-danger">{convertError}</p>}
      </div>

      <OfferFormDialog
        open={formTarget.kind !== "none"}
        onClose={() => setFormTarget({ kind: "none" })}
        candidateId={candidateId}
        offer={formTarget.kind === "edit" ? formTarget.offer : undefined}
        onDone={invalidate}
      />
      <OfferStatusDialog
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        offer={statusTarget}
        onDone={invalidate}
      />
      <Dialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title={t("offers.convert.confirmTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => setConvertOpen(false)}>
              {t("states.cancel")}
            </Button>
            <Button
              disabled={convertMutation.isPending}
              onClick={() => {
                convertMutation.mutate();
                setConvertOpen(false);
              }}
            >
              {t("offers.convert.confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">{t("offers.convert.confirmBody")}</p>
      </Dialog>
    </div>
  );
}

function OfferFormDialog({
  open,
  onClose,
  candidateId,
  offer,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  candidateId: string;
  offer?: OfferResponseDto;
  onDone: () => void;
}) {
  const { t } = useTranslation("recruit");
  const isEdit = offer !== undefined;
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [salary, setSalary] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Idempotency-Key CHỈ dùng cho TẠO — sinh lại mỗi lần dialog MỞ (mục 7).
  const idempotencyKeyRef = useRef(createIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitle(offer?.title ?? "");
    setStartDate(offer?.startDate ?? "");
    setSalary(offer?.salary ?? "");
    setNote(offer?.note ?? "");
    if (!isEdit) idempotencyKeyRef.current = createIdempotencyKey();
  }, [open, offer, isEdit]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim() === "" ? null : title.trim(),
        startDate,
        salary,
        note: note.trim() === "" ? null : note.trim(),
      };
      return isEdit
        ? recruitApi.updateOffer(offer.id, body)
        : recruitApi.createOffer({ candidateId, ...body }, idempotencyKeyRef.current);
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      if (!isEdit && shouldRotateIdempotencyKey(info)) {
        idempotencyKeyRef.current = createIdempotencyKey();
      }
      setError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  // `recruitSalarySchema` từ CONTRACTS (KHÔNG regex tay riêng — chống drift 2 validator, mục 11).
  const canSubmit =
    startDate !== "" && recruitSalarySchema.safeParse(salary).success && !mutation.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(isEdit ? "offers.formTitle.edit" : "offers.formTitle.create")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("states.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending
              ? t("states.saving")
              : t(isEdit ? "offers.submitEdit" : "offers.submitCreate")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("offers.fields.title")}</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("offers.fields.startDate")}</span>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("offers.fields.salary")}</span>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={salary}
            onChange={(e) => setSalary(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("offers.fields.note")}</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

function OfferStatusDialog({
  open,
  onClose,
  offer,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  offer: OfferResponseDto | null;
  onDone: () => void;
}) {
  const { t } = useTranslation("recruit");
  const [toStatus, setToStatus] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const targets = offer ? availableOfferStatusTargets(offer.status) : [];

  useEffect(() => {
    if (!open) return;
    setToStatus("");
    setNote("");
    setError(null);
  }, [open, offer?.id]);

  const mutation = useMutation({
    mutationFn: () =>
      recruitApi.changeOfferStatus(offer!.id, {
        toStatus: toStatus as OfferStatusDto,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      setError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  return (
    <Dialog
      open={open && offer !== null}
      onClose={onClose}
      title={t("offers.statusDialogTitle")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("states.cancel")}
          </Button>
          <Button
            disabled={toStatus === "" || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("offers.changeStatus")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
          <option value="">—</option>
          {targets.map((s) => (
            <option key={s} value={s}>
              {t(`offerStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Input
          placeholder={t("offers.statusNote")}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
