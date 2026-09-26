import { z } from "zod";
import { browseReadRequestSchema } from "./browse";
export const fileChangesRequestSchema = browseReadRequestSchema.extend({
  identity: z.string().min(1).max(8192),
  reviewId: z.string().max(128).optional(),
  saved: z.object({ id: z.string().max(128), target: z.string().max(128) }).optional(),
});
export const fileChangesSchema = z.object({
  identity: z.string(),
  label: z.string(),
  ranges: z.array(
    z.object({
      start: z.number().int().min(1),
      end: z.number().int().min(1),
      kind: z.enum(["added", "deleted", "working"]),
      edge: z.enum(["before", "after"]).optional(),
    }),
  ),
});
export type FileChanges = z.infer<typeof fileChangesSchema>;
