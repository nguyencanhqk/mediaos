import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Trash2 } from "lucide-react";
import type { LabelDto } from "@mediaos/contracts";
import { PermissionGate, useCan } from "@mediaos/web-core";
import { Button, Input, Skeleton } from "@mediaos/ui";
import { labelsApi } from "@/lib/labels-api";
import { queryKeys } from "@/lib/query-keys";

interface LabelsPanelProps {
  projectId: string;
}

const DEFAULT_LABEL_COLOR = "#6366f1";

/** Quản lý nhãn dự án (labels): liệt kê · thêm · đổi tên/màu · xoá. Gated *:label. */
export function LabelsPanel({ projectId }: LabelsPanelProps) {
  const { t } = useTranslation("projects");
  const qc = useQueryClient();
  const canUpdate = useCan("update", "label");
  const canDelete = useCan("delete", "label");

  const labels = useQuery({
    queryKey: queryKeys.labels(projectId),
    queryFn: () => labelsApi.listLabels(projectId),
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: queryKeys.labels(projectId) });

  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_LABEL_COLOR);

  const create = useMutation({
    mutationFn: () => labelsApi.createLabel(projectId, { name: newName.trim(), color: newColor }),
    onSuccess: () => {
      invalidate();
      setNewName("");
      setNewColor(DEFAULT_LABEL_COLOR);
    },
  });

  const update = useMutation({
    mutationFn: ({ labelId, data }: { labelId: string; data: Parameters<typeof labelsApi.updateLabel>[1] }) =>
      labelsApi.updateLabel(labelId, data),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (labelId: string) => labelsApi.deleteLabel(labelId),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t("settings.labels.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.labels.description")}</p>
      </div>

      {labels.isLoading ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : labels.data && labels.data.length > 0 ? (
        <ul className="space-y-2">
          {labels.data.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              canUpdate={canUpdate}
              canDelete={canDelete}
              onRename={(name) => update.mutate({ labelId: label.id, data: { name } })}
              onRecolor={(color) => update.mutate({ labelId: label.id, data: { color } })}
              onDelete={() => remove.mutate(label.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("settings.labels.empty")}</p>
      )}

      <PermissionGate action="create" resourceType="label">
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-border p-3">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            aria-label={t("settings.labels.color")}
            className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent"
          />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("settings.labels.newNamePlaceholder")}
            className="w-56"
          />
          <Button size="sm" onClick={() => create.mutate()} disabled={!newName.trim() || create.isPending}>
            <Plus className="h-4 w-4" />
            {t("settings.labels.add")}
          </Button>
        </div>
      </PermissionGate>
    </div>
  );
}

interface LabelRowProps {
  label: LabelDto;
  canUpdate: boolean;
  canDelete: boolean;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onDelete: () => void;
}

function LabelRow({ label, canUpdate, canDelete, onRename, onRecolor, onDelete }: LabelRowProps) {
  const { t } = useTranslation("projects");
  const [name, setName] = useState(label.name);

  return (
    <li className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <input
        type="color"
        value={label.color}
        disabled={!canUpdate}
        onChange={(e) => onRecolor(e.target.value)}
        aria-label={t("settings.labels.color")}
        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent disabled:cursor-not-allowed"
      />
      {canUpdate ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== label.name) onRename(name.trim());
            else setName(label.name);
          }}
          className="flex-1 rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-border focus:outline-none"
        />
      ) : (
        <span className="flex-1 text-sm text-foreground">{label.name}</span>
      )}
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("common.delete")}
          className="rounded p-1 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}
