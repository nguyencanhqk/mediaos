/**
 * S19-OPS-ZOD4-1 — C1.1: GHIM phong bì lỗi validate trên DÂY trước khi nâng zod 3 → 4.
 * Plan: `docs/plans/S19-OPS-ZOD4-1.md` §4.1 + §9.2-3.
 *
 * Mục đích: XANH trên zod 3.25.76; ĐỎ trên zod 4 nếu filter (`all-exceptions.filter.ts`) thiếu bảng alias
 * `rule` v4→v3 (`invalid_format→invalid_string` · `invalid_value→invalid_enum_value` · `invalid_union`
 * →`invalid_union_discriminator` + nối khoá discriminator vào `field`). FE và tích hợp đọc
 * `error.details[].{field,rule}` — đổi mã là vỡ hợp đồng im lặng.
 *
 * Ghim: `status` · `error.code` · `details[].field` · `details[].rule`. `message` CHỈ ghim ở thông điệp
 * tiếng Việt tự đặt (thông điệp mặc định tiếng Anh của zod được phép đổi — §9.2-3).
 *
 * Cách dựng: app THẬT (AppModule) qua `applyMainPipeline` (cùng ZodValidationPipe toàn cục + filter của
 * `main.ts`), cộng MỘT controller thăm dò `@Public()` chỉ sống trong module test — mỗi route = một loại issue,
 * DTO `createZodDto` y như controller nghiệp vụ. Không cần quyền/seed: guard toàn cục bỏ qua route public, nên
 * thứ được đo là đúng đường pipe → `ZodValidationException` → filter, không lẫn 401/403.
 * Ca «body là chuỗi thay object» mô phỏng bẫy `profile-change-request.controller.ts:94` (pipe schema object
 * áp lên một tham số chuỗi).
 *
 * Cổng `hasDb && LANE_DB` (CLAUDE.md §9.5) vì AppModule mở pool DB lúc boot. Không `Promise.all` quanh supertest.
 */

import "reflect-metadata";
import { Body, Controller, HttpCode, Param, Post, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emailSchema, idSchema } from "@mediaos/contracts";
import { z } from "zod";
import { AppModule } from "../../src/app.module";
import { Public } from "../../src/permission/public.decorator";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { hasDb } from "../helpers/integration-db";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);

const VN_END_BEFORE_START = "Ngày kết thúc phải sau hoặc bằng ngày bắt đầu";

const requiredSchema = z.object({ name: z.string() });
const lengthSchema = z.object({
  title: z.string().min(3),
  tags: z.array(z.string()).max(2).optional(),
});
const formatSchema = z.object({
  id: idSchema.optional(),
  email: emailSchema.optional(),
  at: z.string().datetime().optional(),
});
const enumSchema = z.object({ status: z.enum(["Draft", "Active", "Closed"]) });
const strictSchema = z
  .object({ name: z.string(), meta: z.object({ a: z.number() }).strict().optional() })
  .strict();
const customSchema = z
  .object({ startDate: z.string(), endDate: z.string() })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: VN_END_BEFORE_START,
      });
    }
  });
const unionSchema = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("user"), userId: z.string() }),
    z.object({ kind: z.literal("team"), teamId: z.string() }),
  ]),
});
const nestedSchema = z.object({
  items: z.array(z.object({ sku: z.string(), qty: z.number().int().min(1) })),
});
const objectOnlySchema = z.object({ reason: z.string() });

class RequiredDto extends createZodDto(requiredSchema) {}
class LengthDto extends createZodDto(lengthSchema) {}
class FormatDto extends createZodDto(formatSchema) {}
class EnumDto extends createZodDto(enumSchema) {}
class StrictDto extends createZodDto(strictSchema) {}
class CustomDto extends createZodDto(customSchema) {}
class UnionDto extends createZodDto(unionSchema) {}
class NestedDto extends createZodDto(nestedSchema) {}

@Public()
@Controller("__zod4-probe")
class ZodEnvelopeProbeController {
  @Post("required") @HttpCode(200) required(@Body() b: RequiredDto) {
    return { ok: !!b };
  }
  @Post("length") @HttpCode(200) length(@Body() b: LengthDto) {
    return { ok: !!b };
  }
  @Post("format") @HttpCode(200) format(@Body() b: FormatDto) {
    return { ok: !!b };
  }
  @Post("enum") @HttpCode(200) enumRoute(@Body() b: EnumDto) {
    return { ok: !!b };
  }
  @Post("strict") @HttpCode(200) strict(@Body() b: StrictDto) {
    return { ok: !!b };
  }
  @Post("custom") @HttpCode(200) custom(@Body() b: CustomDto) {
    return { ok: !!b };
  }
  @Post("union") @HttpCode(200) union(@Body() b: UnionDto) {
    return { ok: !!b };
  }
  @Post("nested") @HttpCode(200) nested(@Body() b: NestedDto) {
    return { ok: !!b };
  }
  @Post("string-param/:id")
  @HttpCode(200)
  stringParam(@Param("id", new ZodValidationPipe(objectOnlySchema)) id: unknown) {
    return { ok: !!id };
  }
}

interface WireDetail {
  field: string;
  rule: string;
  message: string;
}

describe.skipIf(!runDb)("S19-OPS-ZOD4-1 — phong bì lỗi validate ghim trên dây", () => {
  let nest: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ZodEnvelopeProbeController],
    }).compile();
    nest = applyMainPipeline(moduleRef.createNestApplication());
    await nest.init();
    await nest.listen(0);
  }, 60_000);

  afterAll(async () => {
    if (nest) await nest.close();
  });

  /** Gửi body, đòi 400 + `VALIDATION-ERR-001`, trả `details` (đã sắp theo field rồi rule). */
  async function rejected(path: string, body: unknown): Promise<WireDetail[]> {
    const res = await request(nest.getHttpServer())
      .post(`/__zod4-probe/${path}`)
      .send(body as object);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION-ERR-001");
    const details = res.body.error.details as WireDetail[];
    expect(Array.isArray(details) && details.length > 0, "phong bì thiếu details").toBe(true);
    return [...details].sort((a, b) =>
      `${a.field}|${a.rule}`.localeCompare(`${b.field}|${b.rule}`),
    );
  }
  const shape = (d: WireDetail[]) => d.map(({ field, rule }) => ({ field, rule }));

  it("chống xanh rỗng: body hợp lệ đi qua (200) — probe thật sự nhận request", async () => {
    const res = await request(nest.getHttpServer())
      .post("/__zod4-probe/union")
      .send({ target: { kind: "team", teamId: "t1" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("thiếu field bắt buộc ⇒ invalid_type tại đúng field", async () => {
    expect(shape(await rejected("required", {}))).toEqual([
      { field: "name", rule: "invalid_type" },
    ]);
  });

  it("chuỗi quá ngắn ⇒ too_small · mảng quá dài ⇒ too_big", async () => {
    expect(shape(await rejected("length", { title: "ab" }))).toEqual([
      { field: "title", rule: "too_small" },
    ]);
    expect(shape(await rejected("length", { title: "abc", tags: ["a", "b", "c"] }))).toEqual([
      { field: "tags", rule: "too_big" },
    ]);
  });

  it("uuid / email / datetime sai ⇒ invalid_string (mã v3 giữ trên dây)", async () => {
    expect(shape(await rejected("format", { id: "khong-phai-uuid" }))).toEqual([
      { field: "id", rule: "invalid_string" },
    ]);
    expect(shape(await rejected("format", { email: "a@b" }))).toEqual([
      { field: "email", rule: "invalid_string" },
    ]);
    expect(shape(await rejected("format", { at: "2026-13-45" }))).toEqual([
      { field: "at", rule: "invalid_string" },
    ]);
  });

  it("enum sai ⇒ invalid_enum_value", async () => {
    expect(shape(await rejected("enum", { status: "Archived" }))).toEqual([
      { field: "status", rule: "invalid_enum_value" },
    ]);
  });

  it("khoá lạ ở .strict() ⇒ unrecognized_keys, field = path của OBJECT chứa khoá", async () => {
    expect(shape(await rejected("strict", { name: "x", extra: 1 }))).toEqual([
      { field: "", rule: "unrecognized_keys" },
    ]);
    expect(shape(await rejected("strict", { name: "x", meta: { a: 1, b: 2 } }))).toEqual([
      { field: "meta", rule: "unrecognized_keys" },
    ]);
  });

  it("superRefine có path ⇒ custom + thông điệp tiếng Việt tự đặt giữ nguyên", async () => {
    const d = await rejected("custom", { startDate: "2026-11-10", endDate: "2026-11-01" });
    expect(d).toEqual([{ field: "endDate", rule: "custom", message: VN_END_BEFORE_START }]);
  });

  it("discriminated union sai nhánh ⇒ invalid_union_discriminator, field = khoá discriminator", async () => {
    expect(shape(await rejected("union", { target: { kind: "robot" } }))).toEqual([
      { field: "target.kind", rule: "invalid_union_discriminator" },
    ]);
  });

  it("path lồng trong mảng ⇒ field dạng items.<i>.<khoá>", async () => {
    const body = {
      items: [
        { sku: "a", qty: 2 },
        { sku: "b", qty: 0 },
      ],
    };
    expect(shape(await rejected("nested", body))).toEqual([
      { field: "items.1.qty", rule: "too_small" },
    ]);
  });

  it("schema object áp lên tham số CHUỖI ⇒ invalid_type, field rỗng (bẫy profile-change-request:94)", async () => {
    expect(shape(await rejected("string-param/abc", {}))).toEqual([
      { field: "", rule: "invalid_type" },
    ]);
  });
});
