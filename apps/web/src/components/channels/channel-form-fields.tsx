import type { ChannelPlatform, ChannelStatus, EmployeeListItemDto, TeamDto } from "@mediaos/contracts";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="col-span-2">
        <Field label="Tên kênh *">
          <Input
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Tên kênh…"
          />
        </Field>
      </div>

      <Field label="Nền tảng *">
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

      <Field label="Mã kênh">
        <Input
          value={value.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder="VD: YT-EDU-01"
        />
      </Field>

      <div className="col-span-2">
        <Field label="URL">
          <Input
            value={value.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://…"
          />
        </Field>
      </div>

      <Field label="Ngôn ngữ">
        <Input
          value={value.language}
          onChange={(e) => onChange({ language: e.target.value })}
          placeholder="vi / en…"
        />
      </Field>

      <Field label="Quốc gia mục tiêu">
        <Input
          value={value.targetCountry}
          onChange={(e) => onChange({ targetCountry: e.target.value })}
          placeholder="VN / US…"
        />
      </Field>

      <Field label="Niche">
        <Input
          value={value.niche}
          onChange={(e) => onChange({ niche: e.target.value })}
          placeholder="Giáo dục, Giải trí…"
        />
      </Field>

      <Field label="Channel Manager">
        <Select
          value={value.channelManagerId}
          onChange={(e) => onChange({ channelManagerId: e.target.value })}
        >
          <option value="">— Chưa gán —</option>
          {employees.map((e) => (
            <option key={e.userId} value={e.userId}>
              {employeeLabel(e)}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Team phụ trách">
        <Select
          value={value.primaryTeamId}
          onChange={(e) => onChange({ primaryTeamId: e.target.value })}
        >
          <option value="">— Chưa gán —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>

      {showStatus && (
        <Field label="Trạng thái">
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
