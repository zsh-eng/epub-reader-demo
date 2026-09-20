import { z } from "zod";
import { browseSourceSchema } from "./browse";

export const symbolMatchSchema = z.object({
  name: z.string(),
  kind: z.string(),
  path: z.string(),
  line: z.number().int().positive().max(200_000),
  column: z.number().int().positive().optional(),
  scope: z.string().optional(),
});
export type SymbolMatch = z.infer<typeof symbolMatchSchema>;
export const symbolSearchRequestSchema = z.object({
  source: browseSourceSchema,
  query: z
    .string()
    .max(256)
    .regex(/^[^\0\r\n]*$/),
  path: z.string().min(1).max(4096).optional(),
  identity: z.string().max(8192).optional(),
});
export type SymbolSearchRequest = z.infer<typeof symbolSearchRequestSchema>;
export const symbolSearchSchema = z.object({
  source: browseSourceSchema,
  resultSource: browseSourceSchema.optional(),
  path: z.string().optional(),
  identity: z.string().optional(),
  query: z.string(),
  matches: z.array(symbolMatchSchema),
  truncated: z.boolean(),
  engine: z.enum(["ctags", "zoekt"]),
  unavailable: z.string().optional(),
});
export type SymbolSearch = z.infer<typeof symbolSearchSchema>;
