# pg-r2-backup

PostgreSQL backup and restore tool using **Cloudflare R2** storage, designed for Docker Compose deployments.

## Features

- 🗄️ Dump & gzip-compress your Postgres database via `docker compose exec`
- ☁️ Upload/download to Cloudflare R2 (S3-compatible) using AWS SDK v3
- 🔄 Restore with automatic schema reset and service restart
- 🧹 Automatic retention cleanup (configurable, default 30 days)
- 📦 Works as a CLI tool **or** as a Node.js module
- 🔑 Supports explicit R2 credentials or falls back to AWS CLI credential chain

---

## Installation

```bash
# Global install (recommended for cron use)
npm install -g pg-r2-backup

# Or as a project dependency
npm install pg-r2-backup
```

---

## Quick Start

1. **Create a `.env` file** in your project root (or export variables in your shell):

```env
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key
R2_SECRET_ACCESS_KEY=your_r2_secret_key
R2_BUCKET=kaamhubs-backups

DB_USER=db_user
DB_NAME=schooldb
POSTGRES_SERVICE=postgres
APP_SERVICE=web-service
```

2. **Run a backup:**

```bash
pg-r2-backup backup
```

3. **List backups:**

```bash
pg-r2-backup list
```

4. **Restore:**

```bash
pg-r2-backup restore db_20260224_020000.sql.gz
```

---

## CLI Reference

```
pg-r2-backup <command> [options]

Commands:
  backup              Dump database and upload to R2
  list                List local and R2 backups
  restore <file>      Restore from a backup (downloads from R2 if not local)
  cleanup             Delete R2 backups older than RETENTION_DAYS
  help                Show help

Options:
  --env-file, -e      Path to .env file  (default: .env in cwd)
```

---

## Environment Variables

| Variable               | Default                    | Description                              |
|------------------------|----------------------------|------------------------------------------|
| `R2_ACCOUNT_ID`        | *(required)*               | Cloudflare account ID                    |
| `R2_ACCESS_KEY_ID`     | *(optional)*               | R2 API token access key                  |
| `R2_SECRET_ACCESS_KEY` | *(optional)*               | R2 API token secret key                  |
| `R2_BUCKET`            | `school-website-backups`   | R2 bucket name                           |
| `DB_USER`              | `db_user`                  | PostgreSQL user                          |
| `DB_NAME`              | `schooldb`                 | PostgreSQL database name                 |
| `POSTGRES_SERVICE`     | `postgres`                 | Docker Compose DB service name           |
| `APP_SERVICE`          | `web-service`              | Docker Compose app service to stop/start |
| `LOCAL_BACKUP_DIR`     | `./backups`                | Local directory for backup files         |
| `RETENTION_DAYS`       | `30`                       | Days to retain R2 backups                |

If `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` are not set, the AWS SDK credential chain is used (environment variables, `~/.aws/credentials`, instance metadata, etc.).

---

## Cron Setup

Add a daily 2 AM backup to your crontab:

```cron
0 2 * * * cd /path/to/project && npx pg-r2-backup backup >> /var/log/pg-r2-backup.log 2>&1
```

---

## Programmatic API

```js
const { loadConfig, validateConfig, backup, list, restore, cleanupR2 } = require('pg-r2-backup');

const config = validateConfig(loadConfig()); // loads .env automatically

// Backup
await backup(config);

// List
await list(config);

// Restore
await restore(config, 'db_20260224_020000.sql.gz');

// Cleanup old R2 backups
await cleanupR2(config);
```

---

## How It Works

### Backup
1. Runs `docker compose exec -T <POSTGRES_SERVICE> pg_dump -U <user> <db>` and pipes output through Node's `zlib.createGzip()` directly to a local `.sql.gz` file.
2. Uploads the file using `PutObjectCommand` (Content-Length based, avoids chunked Transfer-Encoding which R2 doesn't fully support).
3. Prunes local backups older than 7 days.
4. Deletes R2 backups older than `RETENTION_DAYS`.

### Restore
1. Downloads the backup from R2 if it's not already local.
2. Stops the `<APP_SERVICE>` via `docker compose stop`.
3. Resets the public schema (`DROP SCHEMA public CASCADE` + recreate).
4. Pipes the gunzipped dump into `docker compose exec -T <POSTGRES_SERVICE> psql`.
5. Starts the `<APP_SERVICE>` again.

---

## Requirements

- Node.js 18+
- Docker & Docker Compose installed and available in `PATH`
- AWS CLI **not** required (uses AWS SDK v3 directly)

---

## License

MIT
