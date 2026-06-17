import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ChannelDto, UpdateChannelRequest } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { Dialog } from "@mediaos/ui";
import { channelsApi } from "@/lib/channels-api";
import { ChannelFormFields, type ChannelFormState } from "./channel-form-fields";
import { useEmployeeOptions, useTeamOptions } from "./use-channel-options";

function fromChannel(c: ChannelDto): ChannelFormState {
  return {
    name: c.name,
    platform: c.platform,
    code: c.code ?? "",
    url: c.url ?? "",
    language: c.language ?? "",
    targetCountry: c.targetCountry ?? "",
    niche: c.niche ?? "",
    channelManagerId: c.channelManagerId ?? "",
    primaryTeamId: c.primaryTeamId ?? "",
    status: c.status,
  };
}

/** Trim → '' thành null (clear field nullable). */
function nullify(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function toUpdateRequest(f: ChannelFormState): UpdateChannelRequest {
  return {
    name: f.name.trim(),
    platform: f.platform,
    code: nullify(f.code),
    url: nullify(f.url),
    language: nullify(f.language),
    targetCountry: nullify(f.targetCountry),
    niche: nullify(f.niche),
    channelManagerId: f.channelManagerId || null,
    primaryTeamId: f.primaryTeamId || null,
    status: f.status,
  };
}

interface EditChannelDialogProps {
  channel: ChannelDto;
  open: boolean;
  onClose: () => void;
}

export function EditChannelDialog({ channel, open, onClose }: EditChannelDialogProps) {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const [form, setForm] = useState<ChannelFormState>(() => fromChannel(channel));
  const employees = useEmployeeOptions();
  const teams = useTeamOptions();

  // Reset form về giá trị kênh mỗi lần mở dialog.
  useEffect(() => {
    if (open) setForm(fromChannel(channel));
  }, [open, channel]);

  const update = useMutation({
    mutationFn: () => channelsApi.updateChannel(channel.id, toUpdateRequest(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["channels"] });
      void qc.invalidateQueries({ queryKey: ["channels", channel.id] });
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("editDialog.title")}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t("editDialog.cancel")}
          </Button>
          <Button
            size="sm"
            onClick={() => update.mutate()}
            disabled={!form.name.trim() || update.isPending}
          >
            {update.isPending ? t("editDialog.saving") : t("common:actions.save")}
          </Button>
        </>
      }
    >
      <ChannelFormFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} employees={employees} teams={teams} showStatus />
      {update.isError && (
        <p className="text-sm text-destructive">
          {t("editDialog.saveFailed")}{" "}
          {update.error instanceof Error ? update.error.message : t("editDialog.errorUnknown")}
        </p>
      )}
    </Dialog>
  );
}
