import { z } from "zod";

export const states = ["New", "Learning", "Review", "Relearning"] as const;
export const ratings = ["Manual", "Easy", "Good", "Hard", "Again"] as const;

export const cardOperationSchema = z
  .object({
    type: z.literal("card"),
    payload: z.object({
      id: z.string(),
      createdAt: z.number().optional(),
      // card variables
      due: z.coerce.date(),
      stability: z.number(),
      difficulty: z.number(),
      elapsed_days: z.number(),
      scheduled_days: z.number(),
      learning_steps: z.number().int().nonnegative().default(0),
      reps: z.number(),
      lapses: z.number(),
      state: z.enum(states),
      last_review: z.coerce.date().nullable(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type CardOperation = z.infer<typeof cardOperationSchema>;

export const reviewLogOperationSchema = z
  .object({
    type: z.literal("reviewLog"),
    payload: z.object({
      id: z.string(),
      cardId: z.string(),

      grade: z.enum(ratings),
      state: z.enum(states),

      due: z.coerce.date(),
      stability: z.number(),
      difficulty: z.number(),
      elapsed_days: z.number(),
      last_elapsed_days: z.number(),
      scheduled_days: z.number(),
      learning_steps: z.number().int().nonnegative().default(0),
      review: z.coerce.date(),
      duration: z.number(),

      createdAt: z.coerce.date(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type ReviewLogOperation = z.infer<typeof reviewLogOperationSchema>;

export const reviewLogDeletedOperationSchema = z
  .object({
    type: z.literal("reviewLogDeleted"),
    payload: z.object({
      reviewLogId: z.string(),
      deleted: z.boolean(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type ReviewLogDeletedOperation = z.infer<
  typeof reviewLogDeletedOperationSchema
>;

export const cardContentOperationSchema = z
  .object({
    type: z.literal("cardContent"),
    payload: z.object({
      cardId: z.string(),
      front: z.string(),
      back: z.string(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type CardContentOperation = z.infer<typeof cardContentOperationSchema>;

export const cardDeletedOperationSchema = z
  .object({
    type: z.literal("cardDeleted"),
    payload: z.object({
      cardId: z.string(),
      deleted: z.boolean(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type CardDeletedOperation = z.infer<typeof cardDeletedOperationSchema>;

export const cardBookmarkedOperationSchema = z
  .object({
    type: z.literal("cardBookmarked"),
    payload: z.object({
      cardId: z.string(),
      bookmarked: z.boolean(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type CardBookmarkedOperation = z.infer<
  typeof cardBookmarkedOperationSchema
>;

export const cardSuspendedOperationSchema = z
  .object({
    type: z.literal("cardSuspended"),
    payload: z.object({
      cardId: z.string(),
      suspended: z.coerce.date(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type CardSuspendedOperation = z.infer<
  typeof cardSuspendedOperationSchema
>;

export const cardMetadataOperationSchema = z
  .object({
    type: z.literal("cardMetadata"),
    payload: z.object({
      cardId: z.string(),
      noteId: z.string(),
      siblingTag: z.string(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type CardMetadataOperation = z.infer<typeof cardMetadataOperationSchema>;

export const deckOperationSchema = z
  .object({
    type: z.literal("deck"),
    payload: z.object({
      id: z.string(),
      name: z.string(),
      deleted: z.boolean(),
      description: z.string(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type DeckOperation = z.infer<typeof deckOperationSchema>;

export const updateDeckCardOperationSchema = z
  .object({
    type: z.literal("updateDeckCard"),
    payload: z.object({
      deckId: z.string(),
      cardId: z.string(),
      present: z.boolean(),
    }),
    timestamp: z.number(),
  })
  .passthrough();

export type UpdateDeckCardOperation = z.infer<
  typeof updateDeckCardOperationSchema
>;

export const operationSchema = z.union([
  cardOperationSchema,
  cardContentOperationSchema,
  cardDeletedOperationSchema,
  cardBookmarkedOperationSchema,
  cardSuspendedOperationSchema,
  cardMetadataOperationSchema,
  deckOperationSchema,
  updateDeckCardOperationSchema,
  reviewLogOperationSchema,
  reviewLogDeletedOperationSchema,
]);
export type Operation = z.infer<typeof operationSchema>;
