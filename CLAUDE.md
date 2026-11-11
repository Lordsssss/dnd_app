# D&D Table — notes for AI agents

A self-hosted D&D 5e table app: live character sheets, campaigns with their own DM, a DM map with fog and initiative, a world map. Node 22 (built-in `node:sqlite`), Preact + htm with no build step, `ws`.

## Hard rules

- **This repository is public.** No secret, token, password, server address or personal name goes in it; deploy settings live in GitHub secrets and on the server (`docs/DEPLOY.md`).
- **This repository holds no campaign content.** No character, NPC, place, map image or lore of any real campaign, not even as a test fixture. Tests use invented data (`test/helpers.js`). Campaign data lives in the server's database, never in git.
- **Never read or write an Obsidian vault from this repository.** A campaign may be linked to a vault by the admin (the "vault bridge"); that is runtime configuration on the server, not something to develop against real notes.
- **Never use one campaign's data as context for another.** When asked to change live data, go through the API with a token scoped to that one campaign (`Authorization: Bearer dt_…`), never through the database file.
- Live data is on the production server. Don't run migrations, imports or scripts against it without the owner's explicit go-ahead.

## Layout

- `server/` — HTTP + WebSocket server. `app.js` assembles; `routes/*.js` hold the REST routes; `ws.js` the sheet channel; `map/` the DM map; `engine.js` the sheet engine; `migrations.js` the numbered schema migrations; `campaigns.js` roles, invitations, API tokens.
- `shared/` — code run by both server and browser: rules, actions, model, features, bestiary, map ops, i18n.
- `public/` — the browser app. `app/` sheets, home, DM panel, admin console; `map/` the DM map and TV; `world/` the world map.
- `tools/map_walls.py` — wall tracer used by Auto-walls (python3, Pillow, numpy, scipy).

## Conventions

- **Permissions are per campaign.** Use the guards in `server/app.js` (`guard.member`, `guard.dm`, `guard.owner`, `guard.admin`). `is_admin` gives no view into a campaign. Every new route under `/api/c/:cid/…` needs a test that a member of another campaign gets a 403.
- **Schema changes are new migrations** appended to `MIGRATIONS` in `server/migrations.js`. Never edit a shipped migration.
- **Text is French at the source** and translated through `shared/i18n/en.js`. Template text and `title`/`placeholder`/`aria-label` props are translated automatically by `public/app/html.js`; messages with variables use `t('… {x} …', { x })` in the browser and `tl(lang, …)` on the server. Run `npm run i18n` to list strings missing from the English dictionary and add them.
- D&D terms stay in English in both languages (Prone, Multiattack, Short Rest…). Imperial units only (5 ft, 30 ft).
- Player-entered text (features, spell descriptions, notes) is never rewritten by the app. Official 5etools text only replaces it when the user asks.
- Prepared-spell limits warn and never block.
- **The sheet JSON format lives in `shared/sheet-template.js`** (example, AI instructions, `checkSheet`). `docs/CAMPAIGN-SETUP.md` repeats the example and the API calls, and a test keeps them equal: change both together.
- Creating a campaign needs `canCreate` (granted in the admin console) or admin.
- Run `npm test` before committing.
