import { asRow, asRows, getDb, nowSeconds, toNumber } from "../db";
import type { Plan, PlanConfig } from "../types";

/**
 * Kho ke hoach dang tu dong.
 *
 * Ke hoach chi luu lai cau hinh da dung de sinh lich - cac bai da sinh
 * nam trong bang `posts` va tu do song doc lap. Giu lai cau hinh de
 * nguoi dung xem lai da rai gi len Page nao, va de huy ca lo khi can.
 */

interface PlanRow {
  id: number;
  name: string;
  config: string;
  total_posts: number;
  created_at: number;
}

function mapRow(row: PlanRow): Plan {
  return {
    id: row.id,
    name: row.name,
    config: JSON.parse(row.config) as PlanConfig,
    totalPosts: row.total_posts,
    createdAt: row.created_at,
  };
}

export function createPlan(name: string, config: PlanConfig, totalPosts: number): Plan {
  const result = getDb()
    .prepare("INSERT INTO plans (name, config, total_posts, created_at) VALUES (?, ?, ?, ?)")
    .run(name, JSON.stringify(config), totalPosts, nowSeconds());

  const plan = getPlan(toNumber(result.lastInsertRowid));
  if (!plan) throw new Error("Khong tao duoc ke hoach");
  return plan;
}

export function getPlan(id: number): Plan | null {
  const row = asRow<PlanRow>(getDb().prepare("SELECT * FROM plans WHERE id = ?").get(id));
  return row ? mapRow(row) : null;
}

export function listPlans(): Plan[] {
  const rows = asRows<PlanRow>(getDb().prepare("SELECT * FROM plans ORDER BY id DESC").all());
  return rows.map(mapRow);
}

export function deletePlan(id: number): void {
  getDb().prepare("DELETE FROM plans WHERE id = ?").run(id);
}

/** Thong ke trang thai cac bai sinh ra tu mot ke hoach. */
export function planStatusCounts(id: number): Record<string, number> {
  const rows = asRows<{ status: string; total: number }>(
    getDb()
      .prepare("SELECT status, COUNT(*) AS total FROM posts WHERE plan_id = ? GROUP BY status")
      .all(id),
  );
  return Object.fromEntries(rows.map((r) => [r.status, r.total]));
}
