import { createAuth } from "@server/lib/auth";
import type { Session, User } from "better-auth/types";
import { Hono } from "hono";

// Define your environment bindings type
type Bindings = Env;

const app = new Hono<{
  Bindings: Bindings;
  Variables: {
    user: User | undefined;
    session: Session | undefined;
  };
}>();

// Mount Better Auth handler
app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// Optional: Add middleware for session management
app.use("*", async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (session) {
    c.set("user", session.user);
    c.set("session", session.session);
  }

  await next();
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const route = app
  .basePath("/api")
  .get("/hello", (c) => {
    return c.json({ message: "Hello from backend!" });
  })
  .get("/users/:id", (c) => {
    const id = c.req.param("id");
    return c.json({ userId: id });
  });

app.get("/me", (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return c.json({ user });
});

export default app;
// Export type for client-side type inference
export type AppType = typeof route;
