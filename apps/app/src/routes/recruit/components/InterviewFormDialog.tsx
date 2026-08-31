import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { recruitApi, recruitKeys, createIdempotencyKey } from "@mediaos/web-core";
import type { InterviewResponseDto } from "@mediaos/contracts";
import { Badge, Button, Dialog, Input } from "@mediaos/ui";
import {
  parseRecruitError,
  recruitErrorI18nKey,
  shouldRotateIdempotencyKey,
} from "../recruit-errors";
import { isoToLocalInput, localInputToIso } from "../recruit-datetime";
import { useDebouncedValue } from "../use-debounced-value";

interface InterviewFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Cố định ứng viên khi mở từ tab Phỏng vấn của chi tiết ứng viên (ẩn ô chọn). */
  candidateId: string;
  candidateName?: string;
  /** Có → SỬA (chỉ khi `Scheduled`, KHÔNG đổi participants — sổ chỉ-INSERT); không → TẠO. */
  interview?: InterviewResponseDto;
  onDone: () => void;
}

/**
 * REC-SCREEN-005/003 (S12-RECRUIT-FE-1) — tạo/sửa lượt phỏng vấn. Interviewer chọn qua
 * `recruitApi.pickerEmployees` (RECRUIT-API-031) — TUYỆT ĐỐI KHÔNG gọi API HR (SPEC-12 §15 ghi chú).
 */
export function InterviewFormDialog({
  open,
  onClose,
  candidateId,
  candidateName,
  interview,
  onDone,
}: InterviewFormDialogProps) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();
  const isEdit = interview !== undefined;

  const [round, setRound] = useState("1");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [participantSearch, setParticipantSearch] = useState("");
  const debouncedParticipantSearch = useDebouncedValue(participantSearch, 300);
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Idempotency-Key: sinh MỘT LẦN mỗi lần dialog MỞ ở chế độ TẠO (đóng-mở lại ⇒ khoá mới); xoay lại khi
  // server báo KEY_REUSED. Sinh trong mutationFn (như bản trước) là BUG: mỗi lần thử = một khoá mới ⇒
  // @Idempotent BE thành trang trí, double-click tạo hai lượt phỏng vấn.
  const idempotencyKeyRef = useRef(createIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    setError(null);
    setParticipantSearch("");
    setRound(String(interview?.round ?? 1));
    setStartsAt(interview?.startsAt ? isoToLocalInput(interview.startsAt) : "");
    setEndsAt(interview?.endsAt ? isoToLocalInput(interview.endsAt) : "");
    setLocation(interview?.location ?? "");
    setNote(interview?.note ?? "");
    setParticipantIds(interview?.participants.map((p) => p.employeeId) ?? []);
    if (!interview) idempotencyKeyRef.current = createIdempotencyKey();
  }, [open, interview]);

  const employeesQuery = useQuery({
    queryKey: recruitKeys.pickers.employees({ q: debouncedParticipantSearch || undefined }),
    queryFn: () =>
      recruitApi.pickerEmployees({ q: debouncedParticipantSearch || undefined, limit: 20 }),
    enabled: open && !isEdit,
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: recruitKeys.interviews.allOf() });
  };

  const mutation = useMutation({
    mutationFn: () => {
      const startIso = localInputToIso(startsAt);
      const endIso = localInputToIso(endsAt);
      return isEdit
        ? recruitApi.updateInterview(interview.id, {
            round: Number(round),
            startsAt: startIso,
            endsAt: endIso,
            location: location.trim() === "" ? null : location.trim(),
            note: note.trim() === "" ? null : note.trim(),
          })
        : recruitApi.createInterview(
            {
              candidateId,
              round: Number(round),
              startsAt: startIso,
              endsAt: endIso,
              location: location.trim() === "" ? null : location.trim(),
              note: note.trim() === "" ? null : note.trim(),
              participantEmployeeIds: participantIds,
            },
            idempotencyKeyRef.current,
          );
    },
    onSuccess: () => {
      invalidate();
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

  const toggleParticipant = (employeeId: string) => {
    setParticipantIds((prev) =>
      prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId],
    );
  };

  const timeRangeValid =
    startsAt === "" || endsAt === "" || localInputToIso(endsAt) > localInputToIso(startsAt);

  const canSubmit =
    startsAt !== "" &&
    endsAt !== "" &&
    timeRangeValid &&
    (isEdit || participantIds.length > 0) &&
    !mutation.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(isEdit ? "interviews.formTitle.edit" : "interviews.formTitle.create")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("states.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={() => mutation.mutate()}>
            {mutation.isPending
              ? t("states.saving")
              : t(isEdit ? "interviews.submitEdit" : "interviews.submitCreate")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {candidateName && (
          <p className="text-sm text-muted-foreground">
            {t("interviews.fields.candidate")}: <span className="font-medium">{candidateName}</span>
          </p>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("interviews.fields.round")}</span>
          <Input type="number" min={1} value={round} onChange={(e) => setRound(e.target.value)} />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("interviews.fields.startsAt")}</span>
            <Input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("interviews.fields.endsAt")}</span>
            <Input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </label>
        </div>
        {!timeRangeValid && (
          <p className="text-xs text-danger">{t("interviews.errors.endBeforeStart")}</p>
        )}

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("interviews.fields.location")}</span>
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("interviews.fields.note")}</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        {!isEdit && (
          <div className="space-y-2">
            <span className="block text-sm font-medium">{t("interviews.fields.participants")}</span>
            <div className="flex flex-wrap gap-1">
              {participantIds.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  {t("interviews.noParticipants")}
                </span>
              )}
              {participantIds.map((id) => {
                const emp = employeesQuery.data?.find((e) => e.id === id);
                return (
                  <Badge key={id} variant="brand" className="gap-1">
                    {emp?.fullName ?? id}
                    <button type="button" onClick={() => toggleParticipant(id)}>
                      <X className="size-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
            <Input
              placeholder={t("interviews.searchParticipant")}
              value={participantSearch}
              onChange={(e) => setParticipantSearch(e.target.value)}
            />
            <ul className="max-h-36 overflow-y-auto rounded-md border border-border">
              {(employeesQuery.data ?? []).map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => toggleParticipant(e.id)}
                    className="block w-full px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    {e.fullName ?? e.employeeCode ?? e.id}
                  </button>
                </li>
              ))}
            </ul>
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
