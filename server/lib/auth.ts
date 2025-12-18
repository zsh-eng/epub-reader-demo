import * as schema from "@server/db/auth-schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";

export const createAuth = (env: Env) => {
  const db = drizzle(env.DATABASE, { schema });

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
    }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,

    // Your authentication options
    emailAndPassword: {
      enabled: true,
    },

    // Add other options as needed
  });
};
