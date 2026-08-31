import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recruitApi, recruitKeys, useCanExact } from "@mediaos/web-core";
import { Button, EmptyState, Skeleton } from "@mediaos/ui";
import { RECRUIT_ENGINE_PAIRS } from "../constants";
import { parseRecruitError, recruitErrorI18nKey } from "../recruit-errors";

/** REC-SCREEN-003 — tab Ghi chú. `comment:candidate` là SENSITIVE ⇒ `useCanExact`. Sửa/xoá CHỈ ghi CỦA MÌNH — BE tự ép (404 chung nếu khác chủ). */
export function CandidateNotesTab({ candidateId }: { candidateId: string }) {
  const { t } = useTranslation("recruit");
  const queryClient = useQueryClient();

  const canView = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateNotesList.action,
    RECRUIT_ENGINE_PAIRS.candidateNotesList.resourceType,
  );
  const canComment = useCanExact(
    RECRUIT_ENGINE_PAIRS.candidateNoteCreate.action,
    RECRUIT_ENGINE_PAIRS.candidateNoteCreate.resourceType,
  );

  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notesQuery = useQuery({
    queryKey: recruitKeys.candidates.notes(candidateId, { page: 1 }),
    queryFn: () => recruitApi.listCandidateNotes(candidateId, { page: 1 }),
    enabled: canView,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: recruitKeys.candidates.notesOf(candidateId) });

  const onMutationError = (err: unknown) => {
    const info = parseRecruitError(err);
    setError(t(recruitErrorI18nKey(info), { ...Object.fromEntries(info.fields) }));
  };

  const createMutation = useMutation({
    mutationFn: () => recruitApi.createCandidateNote(candidateId, { body: draft.trim() }),
    onSuccess: () => {
      setError(null);
      setDraft("");
      invalidate();
    },
    onError: onMutationError,
  });

  const updateMutation = useMutation({
    mutationFn: (input: { noteId: string; body?: string; del?: boolean }) =>
      recruitApi.updateCandidateNote(
        candidateId,
        input.noteId,
        input.del ? { delete: true } : { body: input.body },
      ),
    onSuccess: () => {
      setError(null);
      setEditing(null);
      invalidate();
    },
    onError: onMutationError,
  });

  if (!canView) return <EmptyState title={t("states.error")} />;

  const notes = notesQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger-muted px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {canComment && (
        <div className="space-y-2">
          <textarea
            rows={2}
            placeholder={t("notes.placeholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            size="sm"
            disabled={draft.trim() === "" || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {t("notes.submit")}
          </Button>
        </div>
      )}

      {notesQuery.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : notes.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t("notes.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-border p-3 text-sm">
              {editing?.id === n.id ? (
                <div className="space-y-2">
                  <textarea
                    rows={2}
                    value={editing.body}
                    onChange={(e) => setEditing({ id: n.id, body: e.target.value })}
                    className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t("states.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({ noteId: n.id, body: editing.body.trim() })
                      }
                    >
                      {t("notes.editSubmit")}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p>{n.body}</p>
                  {canComment && (
                    <div className="mt-1 flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing({ id: n.id, body: n.body })}
                      >
                        {t("notes.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateMutation.mutate({ noteId: n.id, del: true })}
                      >
                        {t("notes.delete")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
