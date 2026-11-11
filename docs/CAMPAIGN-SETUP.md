# Setting up a campaign

This guide is for a new DM, and for the AI assistant helping them. It covers everything from an empty account to a first session: the campaign, the players, the character sheets, the maps and the tokens.

**Using it with an AI.** Give the assistant this whole file, then say what you want: "set up my campaign", "turn this PDF sheet into JSON", "check these sheets". The live copy is always at `https://<your server>/api/guide.md`, so an assistant that can browse can read it there. The section [Instructions for the AI](#instructions-for-the-ai) tells it how to work and what to check before handing anything back.

---

## 1. Before you start

- **An account.** Your DM, or the person who runs the server, sends you an invitation link. Open it, pick a name and a password, and keep the recovery code it shows.
- **The right to create a campaign.** Only the admin can give it: *Admin console → Accounts → Autoriser à créer*. Without it, the home page shows no "Create a campaign" button. Anyone who already runs a campaign has it.

## 2. Create the campaign

Home page → **Create a campaign**:

| Field | What to choose |
|---|---|
| Name | Anything. It can change later. |
| Edition | **5e 2024** unless the whole table plays 2014. Each sheet can still say `"edition": "2014"`. |
| Currency | French PHB (1 po = 10 pa = 100 pc), English PHB (1 gp = 10 sp = 100 cp), or a house rate. The coin keys you pick here are the keys sheets must use. |

Then, in the **DM panel → Settings**: the Long Rest rule, the coins in detail, and **secret death saves** (the server rolls them and only the DM sees the tally).

## 3. Invite the players

DM panel → **Members → Invitation link**. Choose the role (player or co-DM), how many uses and when it expires. Send the link, or show the QR code at the table. Each player signs up through it and lands in the campaign.

A co-DM sees and edits everything the DM does, but cannot delete the campaign or create API tokens.

## 4. Character sheets

There are three ways to get a sheet into the campaign:

1. **The player builds it in the app.** Once in the campaign, they get "Create my character": class, subclass, species, background and level fill what 5etools knows. Every number can be corrected by hand.
2. **The DM creates it.** DM panel → **Sheets → New sheet**, for a player or as an NPC with no player.
3. **Import a JSON file.** DM panel → **Sheets → Import a JSON** creates a new sheet. On an existing sheet, *⚙ Sheet settings → Import a JSON* replaces it, and ↶ undoes that.

**Writing the JSON with an AI.** Next to every import button there are two buttons:

- **Copier le modèle JSON** copies a complete example sheet in the exact format the import accepts, already set to the campaign's edition and coins.
- **Copier la consigne pour une IA** copies the filling rules plus that example. Paste it into the AI, then describe the character, or attach their paper or PDF sheet. The AI answers with one JSON file.

Every import is **checked first**. A window lists what blocks the import (in red) and what looks wrong but can go through (to check). Nothing is replaced until you confirm. Send the messages back to the AI if it needs to fix its file.

After importing in the DM panel, pick the player in the **Played by** column so the sheet becomes theirs.

### The sheet format

| Field | Meaning |
|---|---|
| `edition` | `"2024"` or `"2014"`. |
| `name`, `race`, `background`, `alignment`, `appearance` | Free text. `race` is the species. |
| `classes` | `[{ "name": "Ranger", "subclass": "Hunter", "level": 3 }]`. English class names from the Player's Handbook. One entry per class when multiclassing; 20 levels in total at most. |
| `abilities` | `str dex con int wis cha`, scores from 1 to 30. |
| `saves` | `true` for each proficient saving throw. |
| `skills` | `1` proficient, `2` Expertise. Keys: `acrobatics animalHandling arcana athletics deception history insight intimidation investigation medicine nature perception performance persuasion religion sleightOfHand stealth survival`. |
| `ac`, `speed`, `initiativeBonus` | `speed` in feet: `"30 ft"`. |
| `hp` | `{ "max": 28, "current": 28, "temp": 0 }`. |
| `attacks` | `name`, `bonus` (`"+5"`), `damage` (`"1d8+3"`), `type` for the damage type, properties and range. |
| `resources` | Limited uses: `name`, `max`, `used`, `reset` = `long`, `short` (all back on a Short Rest) or `short1` (one back on a Short Rest). |
| `featureList` | One entry per feature, feat or trait: `group` (the heading), `kind` (`class subclass species background feat item other`), `name`, `text`. The text is copied word for word, never summarized. |
| `proficiencies` | Armor, weapons, tools and languages, as text. |
| `spellcasting` | `ability` (`int`, `wis` or `cha`) and `mode` (`prepared`, `known` or `none`). |
| `spells` | `name`, `level` (0 for a cantrip), `source` (`XPHB` for the 2024 book, `PHB` for 2014), `prepared`, `always` (granted by a feature and not counted), `concentration`, `ritual`, `notes`. |
| `inventory` | `name`, `qty`, `weight` in lb, `equipped`, `attunement`, `attuned`, `consumable`, `rarity`, `charges: { max, used }`. |
| `currency` | The campaign's coin keys: `{ "gp": 15, "sp": 8 }` or `{ "po": 15, "pa": 8 }`. |
| `personality`, `notes` | `traits ideals bonds flaws`; `backstory allies session free`. |

The app computes the Proficiency Bonus, modifiers, spell slots, save DC and spell attack. Don't write them. Missing fields get their defaults; unknown fields are kept but unused.

### Example

The same example the "copy" buttons give, here with English coins:

```json
{
  "format": "dnd-sheet",
  "version": 2,
  "character": {
    "edition": "2024",
    "name": "Mira Thornwood",
    "race": "Wood Elf",
    "background": "Guide",
    "alignment": "Neutral Good",
    "appearance": "Short, freckled, green cloak patched at the elbows.",
    "classes": [
      {
        "name": "Ranger",
        "subclass": "Hunter",
        "level": 3,
        "hitDie": 10
      }
    ],
    "abilities": {
      "str": 12,
      "dex": 17,
      "con": 14,
      "int": 10,
      "wis": 15,
      "cha": 8
    },
    "saves": {
      "str": true,
      "dex": true,
      "con": false,
      "int": false,
      "wis": false,
      "cha": false
    },
    "skills": {
      "perception": 1,
      "stealth": 2,
      "survival": 1,
      "nature": 1,
      "athletics": 1
    },
    "skillBonus": {},
    "ac": 15,
    "speed": "35 ft",
    "initiativeBonus": 0,
    "hp": {
      "max": 28,
      "current": 28,
      "temp": 0
    },
    "attacks": [
      {
        "name": "Longbow",
        "bonus": "+5",
        "damage": "1d8+3",
        "type": "Piercing · Ammunition, Heavy, Two-Handed · range 150/600 ft · Slow"
      },
      {
        "name": "Shortsword",
        "bonus": "+5",
        "damage": "1d6+3",
        "type": "Piercing · Finesse, Light · Vex"
      }
    ],
    "resources": [
      {
        "name": "Favored Enemy",
        "max": 2,
        "used": 0,
        "reset": "long"
      }
    ],
    "featureList": [
      {
        "group": "RANGER",
        "kind": "class",
        "name": "Favored Enemy",
        "text": "You always have Hunter's Mark prepared. You can cast it twice without expending a spell slot, and you regain all expended uses when you finish a Long Rest."
      },
      {
        "group": "RANGER",
        "kind": "class",
        "name": "Weapon Mastery",
        "text": "Longbow (Slow), Shortsword (Vex)."
      },
      {
        "group": "RANGER",
        "kind": "class",
        "name": "Deft Explorer",
        "text": "Expertise in Stealth. Two extra languages: Sylvan, Goblin."
      },
      {
        "group": "RANGER · HUNTER",
        "kind": "subclass",
        "name": "Hunter's Prey",
        "text": "Colossus Slayer: once per turn, an extra 1d8 damage to a creature missing any of its Hit Points."
      },
      {
        "group": "WOOD ELF",
        "kind": "species",
        "name": "Darkvision",
        "text": "60 ft."
      },
      {
        "group": "FEATS",
        "kind": "feat",
        "name": "Alert",
        "text": "Add your Proficiency Bonus to Initiative. You can swap Initiative with a willing ally."
      }
    ],
    "proficiencies": "Armor: Light, Medium, Shields. Weapons: Simple, Martial. Tools: Cartographer's Tools. Languages: Common, Elvish, Sylvan, Goblin.",
    "personality": {
      "traits": "Talks to birds.",
      "ideals": "Nature first.",
      "bonds": "Her lost brother.",
      "flaws": "Trusts no city guard."
    },
    "spellcasting": {
      "ability": "wis",
      "mode": "prepared"
    },
    "spells": [
      {
        "name": "Hunter's Mark",
        "level": 1,
        "source": "XPHB",
        "always": true,
        "concentration": true,
        "notes": "Favored Enemy"
      },
      {
        "name": "Goodberry",
        "level": 1,
        "source": "XPHB",
        "prepared": true
      },
      {
        "name": "Ensnaring Strike",
        "level": 1,
        "source": "XPHB",
        "prepared": true,
        "concentration": true
      },
      {
        "name": "Cure Wounds",
        "level": 1,
        "source": "XPHB",
        "prepared": false
      }
    ],
    "inventory": [
      {
        "name": "Studded Leather Armor",
        "qty": 1,
        "weight": 13,
        "equipped": true
      },
      {
        "name": "Longbow",
        "qty": 1,
        "weight": 2,
        "equipped": true
      },
      {
        "name": "Arrows",
        "qty": 40,
        "weight": 0.05
      },
      {
        "name": "Potion of Healing",
        "qty": 2,
        "weight": 0.5,
        "consumable": true
      },
      {
        "name": "Cloak of Elvenkind",
        "qty": 1,
        "weight": 1,
        "attunement": true,
        "attuned": true,
        "rarity": "uncommon"
      }
    ],
    "currency": {
      "gp": 15,
      "sp": 8
    },
    "notes": {
      "backstory": "Grew up in the Thornwood, guide for caravans until the road burned.",
      "allies": "",
      "session": "",
      "free": ""
    }
  }
}
```

## 5. Maps and tokens

Open the map from the DM panel, or go to `/c/<campaign>/carte`. Everything here is DM-only. The players see the map on the TV window.

**Your images.** The **Images** button in the top bar (shortcut **I**) opens the campaign's images, with a **Tokens** tab and a **Maps** tab:

- Folders on the left. **+ New folder** makes one; images go into the folder that's open when you upload.
- Upload with the button or by dragging files onto the window. PNG, JPEG, WebP or GIF, 25 MB at most each.
- Each image has a folder menu to move it, ✎ to rename and × to delete.
- Click a token to place it on the open map. Click a map image to create a map from it.

**Naming token files.** The file name is how the app finds a token: `Goblin_Small.png` becomes "Goblin", one square; `Owlbear_Large.png` takes 2×2 squares (`Huge` 3×3, `Gargantuan` 4×4). When you add a creature, images whose name matches are proposed first.

**A new map.** *Maps → New map*: pick or upload the image, name it, choose a folder. Drag across one square of the image to measure the grid. Then draw walls and doors in **Walls** mode, or let **Auto-walls** propose them. Fog of war follows the player tokens.

**Adding tokens.** **+ Add** (shortcut **A**): a creature from the campaign bestiary or from 5etools, the party, **My tokens** (your uploads, by folder), or a lone image for an NPC or a marker.

**The TV.** *TV → Open the window* on the screen the players see, then *Send the map*. The TV shows only what the player tokens can see.

## 6. Bestiary and world map

- **Bestiary** (DM panel): copy a 5etools creature and edit it, or write a stat block in Markdown. Encounter difficulty is written as a label: Easy, Medium, Hard or Deadly.
- **World map** (`/c/<campaign>/monde`): an Azgaar `.map` file or any image, with places, DM notes and a text for the players.

## 7. Letting an AI work on the campaign directly

DM panel → **API → New token**. The token (`dt_…`) gives a tool the DM's rights on this one campaign and nothing else. It cannot create other tokens or touch accounts. Delete it when you're done.

The campaign id is in the address bar: `/c/<campaign>/…`. Every call sends `Authorization: Bearer dt_…`.

| Call | What it does |
|---|---|
| `GET /api/c/<campaign>/sheet/template` | `{ example, prompt }`, set to the campaign's edition and coins. |
| `POST /api/c/<campaign>/sheet/check` (body: the sheet) | `{ errors, warnings }`. Doesn't import anything. |
| `GET /api/c/<campaign>/characters` | The sheets: id, name, class, level, player. |
| `GET /api/c/<campaign>/characters/<id>/json` | One sheet, in the import format. |
| `POST /api/c/<campaign>/characters` (body: `{ "data": <sheet>, "owner": null }`) | Creates a sheet. Refused if the check finds errors. |
| `PUT /api/c/<campaign>/characters/<id>` (body: the sheet) | Replaces a sheet. Refused if the check finds errors. The DM can undo it. |
| `POST /api/c/<campaign>/bestiary` (body: `{ "name", "body", "ac", "hp", "init", "size" }`) | Adds a creature; `body` is the stat block in Markdown. |
| `POST /api/c/<campaign>/stash` (body: `{ "items": [{ "name", "qty" }] }`) | Adds items to the party stash. |

```bash
curl -s -H "Authorization: Bearer dt_…" -H "Content-Type: application/json" \
  --data @mira.json https://<server>/api/c/<campaign>/sheet/check
```

Without a server, the same check runs from the app's folder:

```bash
node tools/check-sheet.mjs mira.json --coins=gp,sp,cp
```

`node tools/check-sheet.mjs --prompt --coins=po,pa,pc` prints the AI instructions, and `--template` prints the example.

---

## Instructions for the AI

You are helping a DM set up a campaign in the D&D Table app. Follow these rules.

**How to work**

1. Ask for anything you can't know: the edition (2024 unless told otherwise), the campaign's coin keys, house rules, the player's choices. Don't invent a choice the player made.
2. Produce sheets in the format of section 4, one JSON object per character, with nothing around it.
3. Check every sheet before handing it over: `POST …/sheet/check` if you have a token, `node tools/check-sheet.mjs` if you have the repository, otherwise go through the checklist below yourself. Fix every error, and fix or explain every warning.
4. Never send a sheet with the API without the DM's go-ahead, and never use `PUT` on a sheet a player is using without asking first.

**Checklist for each sheet**

- [ ] `edition` matches the campaign. 2024 rules come from the 2024 Player's Handbook; don't mix 2014 features into a 2024 sheet unless the DM says the player kept them.
- [ ] Class, subclass and level exist in that edition. Total level is 20 at most. Features match the level: for example, no Extra Attack before level 5.
- [ ] Ability scores are plausible: standard array, point buy or rolled, plus the background or species bonuses of that edition. Ability Score Improvements match the levels that grant them.
- [ ] Saving throw proficiencies are those of the first class taken.
- [ ] Skills use the listed keys, `1` or `2`. Expertise (`2`) appears only where a feature grants it.
- [ ] HP max is right: full hit die + CON at level 1, then average or rolled + CON for each level.
- [ ] Every feature, feat and species trait has its own `featureList` entry, with the rules text **word for word**. Never summarize.
- [ ] Spells are on the class list or granted by a feature. Granted ones have `"always": true`. The number of prepared spells matches the class table.
- [ ] Units are imperial everywhere: `ft`, `lb`. Never meters or kilograms, in numbers or in words.
- [ ] D&D terms stay in English: class, spell, feat, condition and item names.
- [ ] `currency` uses only the campaign's coin keys.
- [ ] Nothing the app computes is written by hand: no Proficiency Bonus, modifiers, spell slots, save DC or spell attack.

**Campaign setup checklist**

- [ ] The DM's account can create campaigns (section 1).
- [ ] Campaign created with the right edition and coins; secret death saves and the Long Rest rule set (section 2).
- [ ] Each player has joined through an invitation link (section 3).
- [ ] Each player has a sheet, assigned to them in **Played by** (section 4).
- [ ] Maps and tokens are uploaded into folders; the first map has its grid measured and its walls drawn (section 5).
- [ ] Any API token made for setup is deleted afterwards (section 7).
