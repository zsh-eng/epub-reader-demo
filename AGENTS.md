# Notes

This repository uses bun as the package manager and for running scripts.

The outstanding TODOs are listed in the TODO.md file.

Avoid using new colours if possible. You should use the existing color palette and CSS variables
defined in the index.css file.
If you do encounter other colours in the codebase, please feel free to refactor them to use the existing
CSS theme variables.
Please clarify with the user if you intend to add more colours and provide a justification for why.

We have the `motion` animation library installed. Do use it for animations that are more complex than a basic CSS animation (or would require excessive amounts of CSS syntax).

We have Tanstack React Query installed. Use it for managing data fetching and caching.

Prefer using early returns / guard clauses to avoid nested conditionals and improve code readability.

We're using Hono with Cloudflare Workers for the backend.
D1 Database with Drizzle ORM.
