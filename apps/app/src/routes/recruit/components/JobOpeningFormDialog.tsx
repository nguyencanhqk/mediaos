import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recruitApi, recruitKeys, hrApi, hrKeys, useCan } from "@mediaos/web-core";
import type { JobOpeningResponseDto } from "@mediaos/contracts";
import { Button, Dialog, Input, Select } from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS } from "../constants";
import { availableJobOpeningStatusTargets } from "../recruit-actions";
import { parseRecruitError, recruitErrorI18nKey } from "../recruit-errors";

interface JobOpeningFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** `undefined` = tạo mới; có object = sửa. */
  jobOpening?: JobOpeningResponseDto;
  onDone: () => void;
}

/**
 * REC-SCREEN-001 (S12-RECRUIT-FE-1) — dialog tạo/sửa vị trí tuyển + đổi trạng thái (SPEC-12 §9: job
 * detail/form KHÔNG có route riêng, sống trong dialog của màn danh sách).
 *
 * Đổi trạng thái đi API RIÊNG (`changeJobOpeningStatus`, FSM §13.2) — KHÔNG gộp vào PATCH thường vì
 * `updateJobOpeningSchema` cố ý `.strict()` không nhận `status` (field lạ ⇒ 400 ở biên).
 */
export function JobOpeningFormDialog({
  open,
  onClose,
  jobOpening,
  onDone,
}: JobOpeningFormDialogProps) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();
  const isEdit = jobOpening !== undefined;

  const canCreate = useCan(
    RECRUIT_ENGINE_PAIRS.jobOpeningCreate.action,
    RECRUIT_ENGINE_PAIRS.jobOpeningCreate.resourceType,
  );
  const canUpdate = useCan(
    RECRUIT_ENGINE_PAIRS.jobOpeningUpdate.action,
    RECRUIT_ENGINE_PAIRS.jobOpeningUpdate.resourceType,
  );
  const allowed = isEdit ? canUpdate : canCreate;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [orgUnitId, setOrgUnitId] = useState("");
  const [positionId, setPositionId] = useState("");
  const [headcount, setHeadcount] = useState("1");
  const [recruiterUserId, setRecruiterUserId] = useState("");
  const [toStatus, setToStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setToStatus("");
    setStatusReason("");
    setTitle(jobOpening?.title ?? "");
    setDescription(jobOpening?.description ?? "");
    setOrgUnitId(jobOpening?.orgUnitId ?? "");
    setPositionId(jobOpening?.positionId ?? "");
    setHeadcount(String(jobOpening?.headcount ?? 1));
    setRecruiterUserId(jobOpening?.recruiterUserId ?? "");
  }, [open, jobOpening]);

  // ⚠️ Hai lookup này đi API HR (cặp read:department / read:position) — role `recruiter` seed 0560
  // KHÔNG có ⇒ 403. Không được nuốt câm: orgUnitId là trường BẮT BUỘC, select rỗng không lời giải
  // thích làm form thành ngõ cụt (review-gate mục 22). BE chưa có picker org-unit cho RECRUIT —
  // gap seed/API ghi ở backlog FE-1, đây chỉ vá phần HIỆN LỖI tường minh.
  const { data: departments, isError: departmentsFailed } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    enabled: open && allowed,
    staleTime: 300_000,
  });
  const { data: positions, isError: positionsFailed } = useQuery({
    queryKey: hrKeys.positions.list(),
    queryFn: () => hrApi.listPositions(),
    enabled: open && allowed,
    staleTime: 300_000,
  });
  const { data: recruiters } = useQuery({
    queryKey: recruitKeys.pickers.recruiterUsers(),
    queryFn: () => recruitApi.pickerRecruiterUsers(),
    enabled: open && canUpdate,
    staleTime: 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: recruitKeys.jobs.allOf() });
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = {
        title: title.trim(),
        description: description.trim() === "" ? null : description.trim(),
        orgUnitId,
        positionId: positionId === "" ? null : positionId,
        headcount: Number(headcount),
        recruiterUserId: recruiterUserId === "" ? null : recruiterUserId,
      };
      return isEdit
        ? recruitApi.updateJobOpening(jobOpening.id, {
            title: body.title,
            description: body.description,
            positionId: body.positionId,
            headcount: body.headcount,
            recruiterUserId: body.recruiterUserId,
          })
        : recruitApi.createJobOpening(body);
    },
    onSuccess: () => {
      invalidate();
      onDone();
      onClose();
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      setError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  const statusMutation = useMutation({
    mutationFn: () =>
      recruitApi.changeJobOpeningStatus(jobOpening!.id, {
        toStatus: toStatus as JobOpeningResponseDto["status"],
        reason: statusReason.trim() === "" ? null : statusReason.trim(),
      }),
    onSuccess: () => {
      invalidate();
      onDone();
      onClose();
    },
    onError: (err) => {
      const info = parseRecruitError(err);
      setError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
    },
  });

  if (!allowed) return null;

  // Ô số bị XOÁ TRẮNG ⇒ `Number("") === 0` ⇒ gửi thẳng `headcount: 0` lên server, ăn 400
  // (`createJobOpeningSchema.headcount` đòi ≥1) mà không có gợi ý tại chỗ (mục 9 review-gate).
  const headcountNum = Number(headcount);
  const headcountValid =
    headcount.trim() !== "" && Number.isInteger(headcountNum) && headcountNum >= 1;
  // Tạo mới mà danh sách đơn vị không tải được ⇒ không thể chọn orgUnitId hợp lệ — khoá submit
  // (sửa thì orgUnit đã cố định, lookup hỏng không chặn).
  const lookupBlocked = !isEdit && departmentsFailed;
  const canSubmit =
    title.trim() !== "" &&
    orgUnitId !== "" &&
    headcountValid &&
    !lookupBlocked &&
    !saveMutation.isPending;
  const statusTargets = isEdit ? availableJobOpeningStatusTargets(jobOpening.status) : [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(isEdit ? "jobForm.editTitle" : "jobForm.createTitle")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("states.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending
              ? t("states.saving")
              : t(isEdit ? "jobForm.submitEdit" : "jobForm.submitCreate")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("jobForm.fields.title")}</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("jobForm.fields.orgUnit")}</span>
          <Select
            value={orgUnitId}
            onChange={(e) => setOrgUnitId(e.target.value)}
            disabled={isEdit}
          >
            <option value="">{t("jobForm.selectOrgUnit")}</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          {(departmentsFailed || positionsFailed) && (
            <span role="alert" className="mt-1 block text-xs text-danger">
              {t("jobForm.errors.lookupFailed")}
            </span>
          )}
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("jobForm.fields.position")}</span>
          <Select value={positionId} onChange={(e) => setPositionId(e.target.value)}>
            <option value="">—</option>
            {(positions ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("jobForm.fields.headcount")}</span>
          <Input
            type="number"
            min={1}
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
          />
          {!headcountValid && (
            <span className="mt-1 block text-xs text-danger">
              {t("jobForm.errors.headcountInvalid")}
            </span>
          )}
        </label>

        {canUpdate && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("jobForm.fields.recruiter")}</span>
            <Select value={recruiterUserId} onChange={(e) => setRecruiterUserId(e.target.value)}>
              <option value="">{t("jobForm.selectRecruiter")}</option>
              {(recruiters ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fullName ?? r.id}
                </option>
              ))}
            </Select>
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("jobForm.fields.description")}</span>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {isEdit && canUpdate && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">{t("jobForm.changeStatusTitle")}</p>
            {statusTargets.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("jobForm.noTransition")}</p>
            ) : (
              <>
                <Select value={toStatus} onChange={(e) => setToStatus(e.target.value)}>
                  <option value="">—</option>
                  {statusTargets.map((s) => (
                    <option key={s} value={s}>
                      {t(`jobStatus.${s}`)}
                    </option>
                  ))}
                </Select>
                <Input
                  placeholder={t("jobForm.reasonOptional")}
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toStatus === "" || statusMutation.isPending}
                  onClick={() => statusMutation.mutate()}
                >
                  {t("jobForm.changeStatus")}
                </Button>
              </>
            )}
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
