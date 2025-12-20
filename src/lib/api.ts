import type { AppType } from "@server/index";
import { hc } from "hono/client";
import { getOrCreateDeviceId } from "./device";

export const honoClient = hc<AppType>(import.meta.env.BASE_URL, {
  init: {
    credentials: "include",
  },
  headers: () => ({
    "X-Device-ID": getOrCreateDeviceId(),
  }),
});
