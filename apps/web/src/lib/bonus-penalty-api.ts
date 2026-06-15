import { z } from "zod";
import type {
  BonusPenaltyListQuery,
  CreateBonusPenaltyRequest,
  DecideBonusPenaltyRequest,
} from "@mediaos/contracts";
import { bonusPenaltySchema } from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Bonus/Penalty REST client (G12-3 FE). Số tiền (amount) là dữ liệu NHẠY CẢM per-person
 * (ADR-0010): SERVER là sự thật quyền — gate cả list/get bằng 403 nếu thiếu view-bonus-penalty,
 * KHÔNG mask field. Vì vậy `bonusPenaltySchema.amount = z.number()` (KHÔNG nullable) — client
 * KHÔNG có nhánh tự suy amount=null, KHÔNG tự unmask. Lỗi 403 ném ra dạng ApiError (apiFetch)
 * và được trang xử lý thành trạng thái "không có quyền" — không nuốt lỗi.
 */

function buildQuery(filters: BonusPenaltyListQuery = {}): string {
  const qs = new URLSearchParams();
  if (filters.userId) qs.set("userId", filters.userId);
  if (filters.status) qs.set("status", filters.status);
  if (filters.periodMonth) qs.set("periodMonth", filters.periodMonth);
  if (filters.kind) qs.set("kind", filters.kind);
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const bonusPenaltyApi = {
  list: (filters?: BonusPenaltyListQuery) =>
    apiFetch(`/bonus-penalties${buildQuery(filters)}`, z.array(bonusPenaltySchema)),

  get: (id: string) => apiFetch(`/bonus-penalties/${id}`, bonusPenaltySchema),

  create: (data: CreateBonusPenaltyRequest) =>
    apiFetch("/bonus-penalties", bonusPenaltySchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  approve: (id: string) =>
    apiFetch(`/bonus-penalties/${id}/approve`, bonusPenaltySchema, { method: "POST" }),

  reject: (id: string, data: DecideBonusPenaltyRequest) =>
    apiFetch(`/bonus-penalties/${id}/reject`, bonusPenaltySchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  remove: (id: string) =>
    apiFetch(`/bonus-penalties/${id}`, z.unknown(), { method: "DELETE" }),
};
