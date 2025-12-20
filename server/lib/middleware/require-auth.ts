import type { Session, User } from "better-auth/types";
import type { MiddlewareHandler } from "hono";

type Env = {
  Bindings: {
    DATABASE: D1Database;
    BASE_URL?: string;
  };
  Variables: {
    user: User | undefined;
    session: Session | undefined;
    deviceId: string | undefined;
  };
};

/**
 * Middleware that requires both user authentication and device ID.
 * Returns 401 Unauthorized if either is missing.
 */
export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const user = c.get("user");
  const deviceId = c.get("deviceId");

  if (!user || !deviceId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};

/**
 * Middleware that requires only user authentication.
 * Returns 401 Unauthorized if user is not authenticated.
 */
export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await next();
};
