# EPUB Reader Demo (Name TBD)

Modern Reader App

Roadmap (v0.1):

- [x] Read books
- [x] Themes
- [x] Highlights
- [x] Navigation
- [x] Mobile view
- [x] Reading progress

Roadmap (v0.2):

- [x] Login
- [x] Sync books
- [ ] Sync reading progress
- [ ] Sync highlights
- [ ] Sync log (for debugging)

Testing:

- Playwright tests for
  - Adding books
  - Deleting books
  - Reading and navigating
  - Changing settings
  - Sync of books
  - Sync of highlights
  - Offline usage and support

Roadmap (v0.3):

- [ ] Better book text styles
- [ ] Text notes
- [ ] Reading stats over time
- [ ] Book shelves (DNF, completed, etc.)
- [ ] Full text search
- [ ] Add multiple EPUBs at once

Future:

- [ ] Voice notes
- [ ] Audio notes
- [ ] Quote sharing
- [ ] Read articles
- [ ] Read PDFs
- [ ] LLM (ask questions)
- [ ] Flashcard integration
- [ ] Chinese learning (show pinyin, translation of words)
- [ ] Desktop / Mobile App (Tauri)

Not on roadmap:

- Paginated view
- RTL or Top to bottom layout
- EPUB CFI for reading progress

## Notes on Env

`VITE_BETTER_AUTH_URL` should be defined in `.env.development` and `.env.production`.
Other environment variables should be defined in `.dev.vars` or `wrangler.jsonc` (non-sensitive).

You should manually add these environment variables to the cloudflare dashboard for the production build.
The only environment variable that's updated locally is the `VITE_BETTER_AUTH_URL` variable.

## Notes on Dependencies

Following the latest (as of 2025-12-20) Cloudflare Workers docs on using Vitest,
which means only using Vitest 3.2.0 (instead of the latest version).
See  [this link](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/).
