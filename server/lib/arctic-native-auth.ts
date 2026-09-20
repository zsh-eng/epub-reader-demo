import { createNativeAuthRoutes } from "../../article-reader/SyncServer/native-auth";
import { createAuth } from "./auth";

/** Keep Google's existing Better Auth callback, account linking and HTTP rate
 * limiting. Native callers receive only the separate PKCE-bound Arctic code. */
export function createArcticNativeAuthRoutes() {
  return createNativeAuthRoutes<{ Bindings: Env }>({
    database: (c) => c.env.ARCTIC_DATABASE,
    secret: (c) => c.env.BETTER_AUTH_SECRET,
    origin: (c) => c.env.BETTER_AUTH_URL,
    startGoogle: (c, callbackURL, errorCallbackURL) => {
      const headers = new Headers(c.req.raw.headers);
      headers.set("Content-Type", "application/json");
      headers.delete("Content-Length");
      if (!headers.has("Origin"))
        headers.set("Origin", new URL(c.env.BETTER_AUTH_URL).origin);
      return createAuth(c.env).handler(
        new Request(
          new URL("/api/auth/sign-in/social", c.env.BETTER_AUTH_URL),
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              provider: "google",
              callbackURL,
              errorCallbackURL,
              disableRedirect: true,
            }),
          },
        ),
      );
    },
    authenticate: async (c, cookie) => {
      const session = await createAuth(c.env).api.getSession({
        headers: new Headers({ Cookie: cookie }),
      });
      return session
        ? { id: session.user.id, email: session.user.email }
        : null;
    },
  });
}
