/**
 * S13-PAYROLL-FE-1 — chip trạng thái PAYROLL. Nhãn đi qua i18n namespace `payroll`, màu tra bảng
 * constants — KHÔNG rải chuỗi/hex trong page (SPEC-01 §17.15–17.17).
 *
 * S15-UI-SHELL-1 (DEC-020): render qua `StatusPill` của `packages/ui` — nhãn vẫn qua i18n, MÀU vẫn tra
 * bảng constants; đổi ở đây chỉ để mọi module dùng CÙNG một hình dạng chip trạng thái (UI-07 §13.7).
 *
 * ⚠️ `PayslipStatusBadge` nhận `status` **nullable**: trạng thái phiếu là DẪN XUẤT (SPEC-11 §13.2) và
 * server trả `null` khi KHÔNG nhánh nào khớp (fail-closed — phiếu không lộ ra đường Own). `null` phải
 * hiện thành chip trung tính, KHÔNG được coi là `Generated`.
 */
import { useTranslation } from "react-i18next";
import { StatusPill } from "@mediaos/ui";
import type {
  PayrollPeriodStatus,
  PayslipDerivedStatus,
  BonusPenaltyStatus,
  BonusKind,
} from "@mediaos/contracts";
import {
  PAYROLL_PERIOD_STATUS_BADGE_VARIANT,
  PAYSLIP_STATUS_BADGE_VARIANT,
  BONUS_PENALTY_STATUS_BADGE_VARIANT,
  BONUS_KIND_BADGE_VARIANT,
} from "../constants";

export function PayrollPeriodStatusBadge({ status }: { status: PayrollPeriodStatus }) {
  const { t } = useTranslation("payroll");
  return (
    <StatusPill
      tone={PAYROLL_PERIOD_STATUS_BADGE_VARIANT[status] ?? "muted"}
      label={t(`periodStatus.${status}`)}
    />
  );
}

export function PayslipStatusBadge({ status }: { status: PayslipDerivedStatus | null }) {
  const { t } = useTranslation("payroll");
  if (status === null) return <StatusPill tone="muted" label={t("payslipStatus.unknown")} />;
  return (
    <StatusPill
      tone={PAYSLIP_STATUS_BADGE_VARIANT[status] ?? "muted"}
      label={t(`payslipStatus.${status}`)}
    />
  );
}

export function BonusPenaltyStatusBadge({ status }: { status: BonusPenaltyStatus }) {
  const { t } = useTranslation("payroll");
  return (
    <StatusPill
      tone={BONUS_PENALTY_STATUS_BADGE_VARIANT[status] ?? "muted"}
      label={t(`bonusStatus.${status}`)}
    />
  );
}

export function BonusKindBadge({ kind }: { kind: BonusKind }) {
  const { t } = useTranslation("payroll");
  // «Thưởng/Phạt» là PHÂN LOẠI, không phải trạng thái vòng đời ⇒ giữ chip trần, KHÔNG chấm màu
  // (chấm màu của StatusPill là dấu hiệu «đây là một trạng thái»).
  return (
    <StatusPill tone={BONUS_KIND_BADGE_VARIANT[kind] ?? "muted"} hideDot label={t(`bonusKind.${kind}`)} />
  );
}
