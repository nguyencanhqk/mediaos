import { useTranslation } from "react-i18next";
import type { ChannelPlatform, ChannelStatus, EmployeeListItemDto, TeamDto } from "@mediaos/contracts";
import { Input } from "@mediaos/ui";
import { Select } from "@mediaos/ui";
import {
  CHANNEL_STATUS_LABELS,
  CHANNEL_STATUS_OPTIONS,
  PLATFORM_LABELS,
  PLATFORM_OPTIONS,
} from "./constants";

/** State chung của form tạo/sửa kênh — string-based để bind thẳng input/select. */
export interface ChannelFormState {
  name: string;
  platform: ChannelPlatform;
  code: string;
  url: string;
  language: string;
  targetCountry: string;
  niche: string;
  channelManagerId: string;
  primaryTeamId: string;
  status: ChannelStatus;
}

export const emptyChannelForm: ChannelFormState = {
  name: "",
  platform: "youtube",
  code: "",
  url: "",
  language: "",
  targetCountry: "",
  niche: "",
  channelManagerId: "",
  primaryTeamId: "",
  status: "active",
};

function employeeLabel(e: EmployeeListItemDto): string {
  return e.userFullName ?? e.userEmail ?? e.userId;
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

interface ChannelFormFieldsProps {
  value: ChannelFormState;
  onChange: (patch: Partial<ChannelFormState>) => void;
  employees: EmployeeListItemDto[];
  teams: TeamDto[];
  /** Hiện ô trạng thái (chỉ form sửa). */
  showStatus?: boolean;
}

export function ChannelFormFields({
  value,
  onChange,
  employees,
  teams,
  showStatus = false,
}: ChannelFormFieldsProps) {
  const { t } = useTranslation("channels");
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Field label={t("formFields.channelName")}>
          <Input
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={t("formFields.channelNamePlaceholder")}
          />
        </Field>
      </div>

      <Field label={t("formFields.platform")}>
        <Select
          value={value.platform}
          onChange={(e) => onChange({ platform: e.target.value as ChannelPlatform })}
        >
          {PLATFORM_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("formFields.channelCode")}>
        <Input
          value={value.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder={t("formFields.channelCodePlaceholder")}
        />
      </Field>

      <div className="col-span-2">
        <Field label={t("formFields.url")}>
          <Input
            value={value.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://…"
          />
        </Field>
      </div>

      <Field label={t("formFields.language")}>
        <Input
          value={value.language}
          onChange={(e) => onChange({ language: e.target.value })}
          placeholder={t("formFields.languagePlaceholder")}
        />
      </Field>

      <Field label={t("formFields.targetCountry")}>
        <Input
          value={value.targetCountry}
          onChange={(e) => onChange({ targetCountry: e.target.value })}
          placeholder={t("formFields.targetCountryPlaceholder")}
        />
      </Field>

      <Field label={t("formFields.niche")}>
        <Input
          value={value.niche}
          onChange={(e) => onChange({ niche: e.target.value })}
          placeholder={t("formFields.nichePlaceholder")}
        />
      </Field>

      <Field label={t("formFields.channelManager")}>
        <Select
          value={value.channelManagerId}
          onChange={(e) => onChange({ channelManagerId: e.target.value })}
        >
          <option value="">{t("common:unassigned")}</option>
          {employees.map((e) => (
            <option key={e.userId} value={e.userId}>
              {employeeLabel(e)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t("formFields.team")}>
        <Select
          value={value.primaryTeamId}
          onChange={(e) => onChange({ primaryTeamId: e.target.value })}
        >
          <option value="">{t("common:unassigned")}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      {showStatus && (
        <Field label={t("formFields.status")}>
          <Select
            value={value.status}
            onChange={(e) => onChange({ status: e.target.value as ChannelStatus })}
          >
            {CHANNEL_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {CHANNEL_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </div>
  );
}
