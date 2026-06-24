import { z } from "zod";

/**
 * S1-FND-WIRE-1 — Foundation my-apps response DTO (nguồn sự thật contracts cho GET
 * /api/v1/foundation/modules/my-apps). Khớp MyAppItem (apps/api foundation/module-catalog). BACKEND-04 §9.3.
 * snake_case theo ví dụ spec. required_permissions = FE display code (KHÔNG phải cặp engine enforcement).
 */
export const myAppItemSchema = z.object({
  module_code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  route: z.string(),
  icon: z.string(),
  group: z.string().nullable(),
  is_active: z.boolean(),
  is_favorite: z.boolean(),
  is_recent: z.boolean(),
  badges: z.array(z.string()),
  required_permissions: z.array(z.string()),
  allowed_actions: z.array(z.string()),
});

export type MyAppItem = z.infer<typeof myAppItemSchema>;

/** Response /modules/my-apps = mảng app (envelope bọc ở interceptor; chuẩn hoá envelope = WIRE-DRIFT-1). */
export const myAppsResponseSchema = z.array(myAppItemSchema);
export type MyAppsResponse = z.infer<typeof myAppsResponseSchema>;
