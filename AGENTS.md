# Notes

This repository uses bun as the package manager and for running scripts.

After you finish editing code, you do not need to generate a separate document / README as a summary, you can simply provide your brief summary within the conversation itself.

Avoid using new colours if possible. You should use the existing color palette and CSS variables
defined in the index.css file.
If you do encounter other colours in the codebase, please feel free to refactor them to use the existing
CSS theme variables.
Please clarify with the user if you intend to add more colours and provide a justification for why.

We have the `motion` animation library installed. Do use it for animations that are more complex than a basic CSS animation (or would require excessive amounts of CSS syntax).

We have Tanstack React Query installed. Use it for managing data fetching and caching.

Prefer using early returns / guard clauses to avoid nested conditionals and improve code readability.

We're using Hono with Cloudflare Workers for the backend.
D1 Database with Drizzle ORM and BetterAuth for authentication.

## Backend Structure

- **Database Schema**: Auth tables in `server/db/auth-schema.ts`, custom tables in `server/db/schema.ts`
- **API Client**: Use the typed Hono client from `src/lib/api.ts`:
  ```ts
  const res = await honoClient.posts.$get({
    query: { id: '123' },
  })
  ```
- **Protected Routes**: See `server/index.ts` for example using `c.get('user')` to check authentication

For backend APIs, the main logic should live in the `server/lib` directory.
Only the parsing of query and parameters and returning of responses should live in the `server/index.ts` file.

Tests: see `test/hello.test.ts` for example of integration test with Cloudflare.
There is no need for unit tests of the *endpoints* (though we may need unit tests for specific functionality in the backend).
In general, we prefer integration tests that include the database.

Run the tests using `bun run test test/me.test.ts`.
