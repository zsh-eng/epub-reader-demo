import type { AppType } from "@server/index";
import { hc } from "hono/client";

export const honoClient = hc<AppType>(import.meta.env.BASE_URL, {
  init: {
    credentials: "include",
  },
});
