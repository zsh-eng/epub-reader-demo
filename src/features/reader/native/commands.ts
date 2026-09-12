import { z } from "zod";
import { FONT_CLASSES, THEME_CLASSES, TEXT_ALIGN } from "@/types/reader.types";

// The bridge accepts user intent, never arbitrary database operations or scripts.
const settings = z
  .object({
    fontSize: z.number().int().min(8).max(32).optional(),
    lineHeight: z.number().min(1).max(2.5).optional(),
    fontFamily: z.enum(FONT_CLASSES).optional(),
    theme: z.enum(THEME_CLASSES).optional(),
    textAlign: z.enum(Object.values(TEXT_ALIGN)).optional(),
    publisherBookStylingEnabled: z.boolean().optional(),
    matchPublisherBodyTextSize: z.boolean().optional(),
    pageAnimationsEnabled: z.boolean().optional(),
    showPageNumbers: z.boolean().optional(),
  })
  .strict();

export const readerCommandSchema = z.object({
  version: z.literal(1),
  type: z.literal("reader-command"),
  bookId: z.string(),
  session: z.string(),
  sequence: z.number().int().positive(),
  command: z.discriminatedUnion("action", [
    z.object({ action: z.literal("draft"), content: z.string() }),
    z.object({
      action: z.enum([
        "save",
        "cancel-edit",
        "remove-quote",
        "close",
        "back",
        "next",
        "previous",
        "start-reading",
        "bookmark",
        "dismiss-status",
        "remove-book",
      ]),
    }),
    z.object({
      action: z.enum(["edit", "delete", "undo", "visit"]),
      id: z.string(),
    }),
    z.object({ action: z.literal("page"), page: z.number().int().positive() }),
    z.object({ action: z.literal("chapter"), href: z.string() }),
    z.object({ action: z.literal("settings"), patch: settings }),
    z.object({
      action: z.literal("reading-status"),
      status: z.enum(["want-to-read", "reading", "finished", "dnf"]),
    }),
  ]),
});

export type ReaderCommand = z.infer<typeof readerCommandSchema>["command"];
