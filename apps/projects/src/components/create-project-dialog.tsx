import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { CreateProjectRequest, ProjectDto } from "@mediaos/contracts";
import { Button, Dialog, Input } from "@mediaos/ui";
import { projectsApi } from "@/lib/projects-api";
import { queryKeys } from "@/lib/query-keys";

interface CreateProjectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Gọi sau khi tạo thành công (vd điều hướng tới board của dự án mới). */
  onCreated: (project: ProjectDto) => void;
}

/** Gợi ý identifier từ tên: lấy chữ cái/số đầu các từ, UPPER, tối đa 5 ký tự. */
export function suggestIdentifier(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const initials = words
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0] ?? "")
    .join("")
    .toUpperCase();
  const base = initials.length >= 2 ? initials : name.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return base.slice(0, 5);
}

const identifierFieldSchema = z
  .string()
  .trim()
  .max(10)
  .regex(/^[A-Za-z0-9]*$/, "identifierInvalid");

/**
 * Dialog tạo dự án (PRJ + PM-1). Tên bắt buộc; identifier optional, auto-suggest từ tên (UPPER ≤5),
 * cho phép sửa tay. Tạo xong server tự seed 5 state mặc định → điều hướng tới board.
 */
export function CreateProjectDialog({ open, onClose, onCreated }: CreateProjectDialogProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [identifierTouched, setIdentifierTouched] = useState(false);
  const [description, setDescription] = useState("");

  const reset = () => {
    setName("");
    setIdentifier("");
    setIdentifierTouched(false);
    setDescription("");
  };

  const identifierError =
    identifier.trim() !== "" && !identifierFieldSchema.safeParse(identifier).success;

  const create = useMutation({
    mutationFn: () => {
      const body: CreateProjectRequest = { name: name.trim() };
      if (identifier.trim()) body.identifier = identifier.trim();
      if (description.trim()) body.description = description.trim();
      return projectsApi.createProject(body);
    },
    onSuccess: (project) => {
      void qc.invalidateQueries({ queryKey: queryKeys.projects });
      reset();
      onClose();
      onCreated(project);
    },
  });

  const onNameChange = (value: string) => {
    setName(value);
    // Auto-suggest identifier khi user chưa sửa tay.
    if (!identifierTouched) setIdentifier(suggestIdentifier(value));
  };

  const canSubmit = name.trim().length > 0 && !identifierError && !create.isPending;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!create.isPending) onClose();
      }}
      title={t("createProject.title")}
      description={t("createProject.description")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={create.isPending}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={() => create.mutate()} disabled={!canSubmit}>
            {create.isPending ? t("createProject.submitting") : t("createProject.submit")}
          </Button>
        </>
      }
    >
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          {t("createProject.fieldName")}
        </span>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t("createProject.fieldNamePlaceholder")}
          autoFocus
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          {t("createProject.fieldIdentifier")}
        </span>
        <Input
          value={identifier}
          onChange={(e) => {
            setIdentifierTouched(true);
            setIdentifier(e.target.value.toUpperCase());
          }}
          placeholder={t("createProject.fieldIdentifierPlaceholder")}
          maxLength={10}
          className="font-mono uppercase"
        />
        <span className="text-[11px] text-muted-foreground">
          {identifierError ? (
            <span className="text-destructive">{t("createProject.identifierInvalid")}</span>
          ) : (
            t("createProject.fieldIdentifierHint")
          )}
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">
          {t("createProject.fieldDescription")}
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder={t("createProject.fieldDescriptionPlaceholder")}
          className="flex w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {create.isError && (
        <p className="text-sm text-destructive">
          {t("createProject.error")}{" "}
          {create.error instanceof Error ? create.error.message : ""}
        </p>
      )}
    </Dialog>
  );
}
