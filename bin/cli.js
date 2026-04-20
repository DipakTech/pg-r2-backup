#!/usr/bin/env node
'use strict';

/**
 * pg-r2-backup CLI
 *
 * Usage:
 *   pg-r2-backup backup
 *   pg-r2-backup list
 *   pg-r2-backup restore <filename>
 *   pg-r2-backup cleanup
 *   pg-r2-backup help
 *
 * Options:
 *   --env-file <path>   Path to .env file (default: .env in cwd)
 */

const { loadConfig, validateConfig } = require('../src/config');
const { backup, list, restore, cleanupR2 } = require('../src/commands');
const logger = require('../src/logger');

// ─── parse argv ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

let command = 'help';
let restoreTarget = null;
let envFile = '.env';

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--env-file' || a === '-e') {
    envFile = args[++i];
  } else if (!command || command === 'help') {
    command = a;
  } else if (command === 'restore' && !restoreTarget) {
    restoreTarget = a;
  }
}

// ─── help ────────────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
pg-r2-backup — PostgreSQL backup & restore via Cloudflare R2

Usage:
  pg-r2-backup <command> [options]

Commands:
  backup              Dump database and upload to R2
  list                List local and R2 backups
  restore <file>      Restore from a backup file (downloads from R2 if needed)
  cleanup             Remove R2 backups older than RETENTION_DAYS (default: 30)
  help                Show this message

Options:
  --env-file, -e      Path to .env file (default: .env in current directory)

Environment Variables:
  R2_ACCOUNT_ID         Cloudflare account ID              (required)
  R2_ACCESS_KEY_ID      R2 API token access key            (optional if AWS CLI is configured)
  R2_SECRET_ACCESS_KEY  R2 API token secret key            (optional if AWS CLI is configured)
  R2_BUCKET             Bucket name                        (default: school-website-backups)
  DB_USER               PostgreSQL user                    (default: db_user)
  DB_NAME               PostgreSQL database name           (default: schooldb)
  LOCAL_BACKUP_DIR      Local backup directory             (default: ./backups)
  RETENTION_DAYS        Days to keep R2 backups            (default: 30)

Examples:
  pg-r2-backup backup
  pg-r2-backup list
  pg-r2-backup restore db_20260224_020000.sql.gz
  pg-r2-backup restore db_20260224_020000.sql.gz --env-file /etc/kaamhubs/.env

Cron (daily 2 AM):
  0 2 * * * cd /path/to/project && npx pg-r2-backup backup >> /var/log/pg-r2-backup.log 2>&1
`);
}

// ─── run ─────────────────────────────────────────────────────────────────────

async function main() {
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  let config;
  try {
    config = validateConfig(loadConfig(envFile));
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'backup':
        await backup(config);
        break;

      case 'list':
        await list(config);
        break;

      case 'restore':
        await restore(config, restoreTarget);
        break;

      case 'cleanup':
        await cleanupR2(config);
        break;

      default:
        logger.error(`Unknown command: "${command}"`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    logger.error(err.message);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main();
