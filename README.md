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

- [ ] Login
- [ ] Sync books
- [ ] Sync highlights
- [ ] Sync reading progress

Roadmap (v0.3):

- [ ] Better book text styles
- [ ] Text notes
- [ ] Reading stats over time
- [ ] Book shelves (DNF, completed, etc.)
- [ ] Full text search

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

## Notes on Env

`VITE_BETTER_AUTH_URL` should be defined in `.env.developmen` and `.env.production`.
Other environment variables should be defined in `.dev.vars` or `wrangler.jsonc` (non-sensitive).

You should manually add these environment variables to the cloudflare dashboard for the production build.
