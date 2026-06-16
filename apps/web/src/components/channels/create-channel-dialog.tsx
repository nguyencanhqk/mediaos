import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { CreateChannelRequest } from "@mediaos/contracts";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { channelsApi } from "@/lib/channels-api";
import { ChannelFormFields, emptyChannelForm, type ChannelFormState } from "./channel-form-fields";
import { useEmployeeOptions, useTeamOptions } from "./use-channel-options";

function toCreateRequest(f: ChannelFormState): CreateChannelRequest {
  const req: CreateChannelRequest = { name: f.name.trim(), platform: f.platform };
  const code = f.code.trim();
  if (code) req.code = code;
  const url = f.url.trim();
  if (url) req.url = url;
  const language = f.language.trim();
  if (language) req.language = language;
  const targetCountry = f.targetCountry.trim();
  if (targetCountry) req.targetCountry = targetCountry;
  const niche = f.niche.trim();
  if (niche) req.niche = niche;
  if (f.channelManagerId) req.channelManagerId = f.channelManagerId;
  if (f.primaryTeamId) req.primaryTeamId = f.primaryTeamId;
  return req;
}

export function CreateChannelDialog() {
  const { t } = useTranslation("channels");
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ChannelFormState>(emptyChannelForm);
  const employees = useEmployeeOptions();
  const teams = useTeamOptions();

  const create = useMutation({
    mutationFn: () => channelsApi.createChannel(toCreateRequest(form)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["channels"] });
      setForm(emptyChannelForm);
      setOpen(false);
    },
  });

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("createDialog.openButton")}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("createDialog.title")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("createDialog.cancel")}
            </Button>
            <Button
              size="sm"
              onClick={() => create.mutate()}
              disabled={!form.name.trim() || create.isPending}
            >
              {create.isPending ? t("createDialog.creating") : t("createDialog.createButton")}
            </Button>
          </>
        }
      >
        <ChannelFormFields value={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} employees={employees} teams={teams} />
        {create.isError && (
          <p className="text-sm text-destructive">
            {t("createDialog.createFailed")}{" "}
            {create.error instanceof Error ? create.error.message : t("createDialog.errorUnknown")}
          </p>
        )}
      </Dialog>
    </>
  );
}
