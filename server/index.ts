import { createAuth } from "@server/lib/auth";
import { Hono } from "hono";

// Define your environment bindings type
type Bindings = Env;

const app = new Hono<{
  Bindings: Bindings;
}>();

app.use("*", async (c, next) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
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

export default app;
// Export type for client-side type inference
export type AppType = typeof route;
