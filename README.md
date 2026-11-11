# D&D Table

A self-hosted table for D&D 5e campaigns: live character sheets, a DM map with fog of war and initiative for the TV, a world map, and the 5etools compendium built in. Several campaigns share one server; each has its own DM, players, sheets, maps and world. French or English, chosen by each person.

## What each person gets

**Everyone**
- An account with a password, a recovery code shown at sign-up, and a language: French or English.
- A home page listing their campaigns: the ones they run and the ones they play in. They join one with an invitation link, and create their own once the admin gives them that right.

**A player, in a campaign**
- Their own sheet, editable; the other sheets read-only. A player without a sheet creates one: class, subclass, species, background and level fill what 5etools knows, and every computed value can be corrected by hand.
- Features & Traits as a list of entries kept word for word. Paste the text of a paper or PDF sheet and each line or paragraph becomes an entry; the official 5etools text only replaces theirs when they ask.
- Spells fully editable. Spells granted by a subclass, feat, species or item are marked free and don't count. Limits come from the class tables (2024: prepared spells by level) and only warn.
- Dice rolls on every bonus, shared log, rests, level-up wizard, inventory with the party stash and fund, notes with a pencil layer, a secret page only they and the DM see.
- The world map, showing only what the DM marked as known.

**The DM of a campaign** (and co-DMs), in the DM panel
- **Members**: roles, invitation links (uses, expiry, QR code).
- **Sheets**: create for a player or as an NPC, assign, import or export JSON, delete. The DM can edit every sheet of the campaign. **Copy JSON template** and **Copy AI instructions** give a ready example to fill by hand or with an AI; every import is checked before anything changes.
- **Images**: maps, tokens, portraits, uploaded by drag and drop into folders. The same images, with their folders, are in the map's **Images** window.
- **Bestiary**: copy a 5etools creature and tweak it, or write a stat block in Markdown. Tokens show it on hover, on the DM's screen only. Never XP.
- **Settings**: name, edition, currency (coins, names and rates), Long Rest rule, **secret death saves** (the server rolls; only the DM sees the tally).
- **API tokens**: give a tool or an AI assistant the DM's rights on this campaign and nothing else.
- **Log** of everything that happened in the campaign.
- **Map** at `/c/<campaign>/carte`: upload a map, measure the grid by dragging over one square, Auto-walls from the image, then walls and doors by hand. Fog that follows the tokens, a TV window, initiative, rulers, templates, drawing. Token details: HP, conditions, notes, stat block.
- **World map** at `/c/<campaign>/monde`: an Azgaar `.map` file or any image. Corrected names, DM notes, a text for the players, places, the party's pin.

**The admin** (one or more accounts with the admin flag)
- Accounts: create, reset a forgotten password, delete, grant admin, and allow an account to create campaigns.
- Campaigns seen from outside: members, size, change the lead DM, delete. The admin does **not** see inside a campaign without being a member.
- Sign-up mode: by invitation (default), open, or closed.
- Server: 5etools update, token library, backups, and the vault bridge.

## Setting up a campaign

[docs/CAMPAIGN-SETUP.md](docs/CAMPAIGN-SETUP.md) walks a new DM through it, from the account to the first session, and ends with instructions for an AI assistant: the sheet format, the API calls and a checklist. The server also serves it at `/api/guide.md`. `node tools/check-sheet.mjs sheet.json` checks a sheet without a server.

## Install

Requirements: **Node.js 22.13 or newer**. Python 3 with Pillow, numpy and scipy only for Auto-walls.

```bash
npm ci
```

```bash
npm run 5etools
```

```bash
npm start
```

The first start creates `config.json` and an `admin` account whose temporary PIN is printed once in the terminal. Sign in, choose a password, and create a campaign.

For a server with HTTPS, a staging instance and deploys from GitHub Actions on every merge into `dev` or `prod`, see [docs/DEPLOY.md](docs/DEPLOY.md).

## Configuration

`config.json`, or `DND_TABLE_CONFIG=/path/config.json`. Environment variables `PORT`, `DND_DATA_DIR`, `DND_BACKUP_DIR`, `DND_5ETOOLS_DIR`, `DND_LIBRARY_DIR`, `DND_PUBLIC_URL` override it.

| Key | Default | Meaning |
| :-- | :-- | :-- |
| `port` | `3000` | HTTP port |
| `host` | `0.0.0.0` | Listen address; `127.0.0.1` behind a proxy |
| `publicUrl` | none | Public address, for invitation links and QR codes |
| `dataDir` | `data` | SQLite database and uploaded files (`files/`) |
| `backupDir` | `backups` | Daily database copies, and a copy before every migration |
| `backupKeepDays` | `30` | Daily copies kept |
| `fiveEToolsDir` | `5etools` | 5etools data, downloaded by `npm run 5etools` |
| `libraryDir` | none | A folder of token images shared by every campaign, such as Forgotten Adventures. Put only images there: any signed-in account can read it |
| `signup` | `invite` | Sign-up mode at first start; then set from the admin console |
| `maxUploadBytes` | 25 MB | Largest image upload |
| `campaignQuotaBytes` | 1 GB | Upload space per campaign |
| `python` | `python3` | Interpreter for Auto-walls |
| `trustProxy` | `true` | Read the client address from `X-Forwarded-For` when the request comes from localhost |
| `https` | none | `{ "cert": "…", "key": "…" }` to serve HTTPS directly |

## Data and backups

Everything a campaign holds is in `dataDir`: the database `fiches.sqlite` and `files/` (images, world `.map` files with their previous versions). The server copies the database every day into `backupDir/db/`. **That copy stays on the server**: run `scripts/backup-offsite.sh` every night to send the database and the files elsewhere.

```bash
DEST=me@other-machine:/backups/dnd-table scripts/backup-offsite.sh
```

To restore: stop the server, put the copy back as `dataDir/fiches.sqlite`, and `files/` beside it.

## Linking a campaign to an Obsidian vault

The admin can link **one** campaign to **one** vault folder on the server (admin console → Campaigns → Link a vault). That campaign's DM then gets a Vault tab:
- **Export**: each sheet and the party file as Markdown into the vault, with a "changes since last export" section. Only files carrying the app's marker are ever overwritten or removed.
- **Bestiary sync**: stat blocks written in the notes (`> [!danger]` callouts with AC and HP) become bestiary entries.
- **World map notes**: a place can link a vault note, read in place by the DM.

A vault can't be linked to two campaigns, and a campaign without a bridge never reads or writes outside the database. That is what keeps one campaign out of another's notes.

## API

A campaign's lead DM creates tokens in the DM panel → API. A token acts as the DM of that campaign only, on the routes under `/api/c/<campaign>/`:

```bash
curl -H "Authorization: Bearer $TOKEN" https://dnd.example.org/api/c/$CAMPAIGN/characters
```

Useful routes: `characters` (GET, and `characters/<id>` GET or PUT a whole sheet), `assets?kind=map&name=…` (POST an image as the request body), `map/scenes` (POST to create, `map/scenes/<id>` GET or PUT the scene with its walls), `bestiary` (GET, POST, PUT, DELETE), `monde/…` for the world map.

## Command line

```bash
npm run cli -- list
```

Accounts, admin flag and roles. Also: `campaigns`, `reset <login>` (temporary PIN), `admin <login> on|off`, `backup`, `fetch-5etools`, and `import-legacy` to bring the maps, token choices and world of the single-campaign version into a campaign.

## Development

```bash
npm test
```

Branches: open pull requests into `dev`; `dev` deploys to staging and `prod` to production (see [docs/DEPLOY.md](docs/DEPLOY.md)).

No build step: the browser loads `public/` and `shared/` as ES modules. Rules shared by the server and the browser are in `shared/`; the server is the authority. Schema changes are new entries in `server/migrations.js`. Interface text is French at the source; `npm run i18n` lists strings missing from `shared/i18n/en.js`. See `CLAUDE.md` for the rules agents follow in this repository.
