# Deploying

Two branches, two instances on one server:

| Branch | Instance | Service | Code | Data |
|---|---|---|---|---|
| `dev` | staging | `dnd-table-staging` | `~/dnd-table-staging` | `~/dnd-table-staging-data` |
| `prod` | production | `dnd-table` | `~/dnd-table` | `~/dnd-table-data` |

**The flow.** Work on a feature branch and open a pull request into `dev`. GitHub Actions runs the tests on the pull request; the check is called `test / test`, the name the branch rule requires. Merging it deploys `dev` to staging. When staging looks right, open a pull request from `dev` into `prod`; merging it deploys to production.

Each deploy: the tests run again, then GitHub Actions connects to the server over SSH and runs `scripts/deploy.sh` for that instance. That script fast-forwards the checkout to the merged commit, installs dependencies if they changed, backs up the database and restarts the service. Database migrations run when the service starts, after their own automatic copy of the database. If the service doesn't answer after the restart, the deploy fails and the Actions run turns red.

## One-time setup

### On the server

Node.js 22.13 or newer, git, Caddy for HTTPS. Python 3 with Pillow, numpy and scipy only for Auto-walls.

1. **The code**, one checkout per instance:

   ```bash
   git clone -b prod https://github.com/<owner>/<repo>.git ~/dnd-table
   git clone -b dev  https://github.com/<owner>/<repo>.git ~/dnd-table-staging
   (cd ~/dnd-table && npm ci --omit=dev) && (cd ~/dnd-table-staging && npm ci --omit=dev)
   ```

2. **A data folder per instance**, each with its `config.json`. Staging listens on another port and never gets a vault bridge:

   ```json
   { "port": 3999, "host": "127.0.0.1", "publicUrl": "https://dev.dnd.example.org",
     "dataDir": "/home/<user>/dnd-table-staging-data/data", "backupDir": "/home/<user>/dnd-table-staging-data/backups",
     "fiveEToolsDir": "/home/<user>/dnd-table-staging-data/5etools", "libraryDir": "/home/<user>/dnd-table-staging-data/library" }
   ```

   `npm run 5etools` downloads the 5etools data into `fiveEToolsDir`.

3. **The services and their HTTPS sites**, once each, with sudo:

   ```bash
   sudo DOMAIN=dnd.example.org VAULT="/path/to/vault" ~/dnd-table/scripts/install-service.sh production
   sudo DOMAIN=dev.dnd.example.org ~/dnd-table-staging/scripts/install-service.sh staging
   ```

   `VAULT` is only for a campaign linked to an Obsidian vault; leave it out otherwise. Without `DOMAIN`, Caddy is left alone. On first start with an empty database, the server prints a temporary admin code: `journalctl -u dnd-table-staging -n 30`.

4. **The deploy hook.** A dedicated SSH key for GitHub Actions, allowed to run one script and nothing else:

   ```bash
   install -D -m 755 ~/dnd-table/scripts/deploy-hook.sh ~/.local/bin/dnd-deploy-hook
   ssh-keygen -t ed25519 -N '' -C github-actions-deploy -f ~/deploy-key
   echo "command=\"$HOME/.local/bin/dnd-deploy-hook\",restrict $(cat ~/deploy-key.pub)" >> ~/.ssh/authorized_keys
   ```

   The hook is installed outside the checkouts so a deployed commit can't change it. Reinstall it by hand when `scripts/deploy-hook.sh` changes. Its log is `~/.local/state/dnd-deploy.log`.

### On GitHub

*Settings → Secrets and variables → Actions → New repository secret*:

| Secret | Value |
|---|---|
| `DEPLOY_SSH_KEY` | The content of `~/deploy-key`, the private key. Delete the file from the server afterwards. |
| `DEPLOY_HOST` | `<user>@<server address>` |
| `DEPLOY_KNOWN_HOSTS` | The output of `ssh-keyscan <server address>`, run from a machine you trust. |

*Settings → Environments*: `staging` and `production` appear after the first deploy. Give each an `APP_URL` variable to get a link on the run. Add yourself as a required reviewer on `production` if you want to approve each production deploy.

*Settings → Branches → Add branch ruleset*, one ruleset for both branches:

- **Enforcement status**: Active. **Target branches**: Add target → Include by pattern → `dev`, then `prod`.
- **Restrict deletions**.
- **Require a pull request before merging**, with **Required approvals** at `0` when you work alone (GitHub doesn't let you approve your own pull request).
- **Require status checks to pass** → Add checks → `test / test` (GitHub Actions).
- **Block force pushes**. The deploy script refuses a commit that isn't a fast-forward, so a force push would make the next deploy fail.

## By hand

The same script works from a shell on the server, for example to roll back production to an earlier commit of `prod` after a `git revert` was merged:

```bash
cd ~/dnd-table && DEPLOY_BRANCH=prod DND_SERVICE=dnd-table DND_TABLE_CONFIG=~/dnd-table-data/config.json scripts/deploy.sh <commit>
```

A database backup is taken before each deploy, under the instance's `backupDir`, and before each migration, under `backupDir/migrations`.
