import { z } from "zod";
export const gitTargetsSchema = z.object({
  branch: z.string(),
  head: z.string(),
  refs: z.array(z.object({ name: z.string(), label: z.string() })),
  remotes: z.array(z.object({ name: z.string(), branches: z.array(z.string()) })),
});
export type GitTargets = z.infer<typeof gitTargetsSchema>;
export const pushRequestSchema = z.object({
  repo: z.string().min(1).max(4096),
  head: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
  remote: z.string().min(1).max(256),
  branch: z.string().min(1).max(256),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;
export const pushResultSchema = z.object({
  head: z.string(),
  remote: z.string(),
  branch: z.string(),
});
