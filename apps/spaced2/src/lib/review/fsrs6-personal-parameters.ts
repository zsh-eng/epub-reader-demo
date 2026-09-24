/**
 * FSRS-6 defaults fitted locally with fsrs-optimizer 6.5.0.
 * See docs/FSRS_OPTIMIZATION.md for data preparation and held-out validation.
 * Active defaults for ts-fsrs 5.4.2.
 * User confirmed Hard means successful recall with effort.
 */
export const FSRS6_PERSONAL_PARAMETERS = {
  w: [
    0.9975, 35.782, 33.9744, 36.2856, 6.2805, 1.1704, 3.0851, 0.1093, 2.0351,
    0.2441, 0.9816, 1.436, 0.0656, 0.2007, 1.5786, 0.6156, 1.0157, 0.5682,
    0.0765, 0.0991, 0.1005,
  ],
  request_retention: 0.9,
  maximum_interval: 100,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ["1m", "10m"],
  relearning_steps: ["10m"],
} as const;
