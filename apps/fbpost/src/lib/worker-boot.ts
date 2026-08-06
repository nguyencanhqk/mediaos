import { startWorker } from "./worker";

/**
 * Khoi dong worker hen gio khi module server dau tien duoc nap.
 *
 * Truoc day viec nay nam trong `instrumentation.ts`, nhung Next.js bien dich
 * file do cho ca edge runtime - noi khong co `node:fs` - khien webpack bao
 * UnhandledSchemeError va hong toan bo trang. Dat o day thi worker chi duoc
 * nap tu cac route handler, von luon chay tren Node runtime.
 */

const STARTED = Symbol.for("fbpost.worker.started");
const registry = globalThis as unknown as Record<symbol, boolean | undefined>;

/**
 * Trong lúc `next build`, moi route duoc danh gia trong mot process rieng.
 * Neu khong chan, worker se khoi dong nhieu lan va tao san file CSDL
 * ngay tu buoc build - dieu khong ai mong doi.
 */
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

// Cot moc tren globalThis giup hot reload trong che do dev khong tao
// them nhieu bo dem trung nhau.
if (!isBuildPhase && process.env.NEXT_RUNTIME === "nodejs" && !registry[STARTED]) {
  registry[STARTED] = true;
  startWorker();
}
