'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const logger = require('./logger');
const { createR2Client, uploadFile, downloadFile, listObjects, deleteObject } = require('./r2');
const { dumpDatabase, resetPublicSchema, restoreDatabase, dockerComposeService } = require('./docker');

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
}

function timestampFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '_',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
  return `db_${ts}.sql.gz`;
}

/** Parse the date portion out of a backup filename: db_YYYYMMDD_hhmmss.sql.gz */
function extractDateFromFilename(filename) {
  const m = filename.match(/db_(\d{8})_\d{6}\.sql\.gz$/);
  return m ? m[1] : null; // "YYYYMMDD" string or null
}

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── commands ─────────────────────────────────────────────────────────────────

/**
 * backup()
 * Dump → gzip → upload to R2 → local cleanup → R2 retention cleanup
 */
async function backup(config) {
  const client = createR2Client(config);

  fs.mkdirSync(config.localBackupDir, { recursive: true });

  const filename = timestampFilename();
  const localPath = path.join(config.localBackupDir, filename);

  logger.log('Starting database backup…');

  try {
    await dumpDatabase(config.dbUser, config.dbName, localPath);
  } catch (err) {
    fs.rmSync(localPath, { force: true });
    throw new Error(`Database dump failed: ${err.message}`);
  }

  const stat = fs.statSync(localPath);
  if (stat.size === 0) {
    fs.rmSync(localPath, { force: true });
    throw new Error('Backup failed – empty file produced');
  }

  logger.success(`Local backup created: ${filename} (${formatBytes(stat.size)})`);

  logger.log('Uploading to Cloudflare R2…');
  try {
    await uploadFile(client, config.r2Bucket, filename, localPath);
  } catch (err) {
    throw new Error(`Upload failed: ${err.message}`);
  }
  logger.success(`Uploaded to R2: ${filename}`);

  // Remove local backups older than 7 days
  pruneLocalBackups(config.localBackupDir, 7);

  await cleanupR2(config, client);

  logger.success('Backup completed!');
}

/**
 * list()
 * Print local and R2 backups side by side.
 */
async function list(config) {
  const client = createR2Client(config);

  logger.log('=== Local Backups ===');
  const localFiles = getLocalBackups(config.localBackupDir);
  if (localFiles.length === 0) {
    console.log('  (none)');
  } else {
    for (const f of localFiles) {
      const size = formatBytes(fs.statSync(path.join(config.localBackupDir, f)).size);
      console.log(`  ${f}  (${size})`);
    }
  }

  console.log('');
  logger.log('=== R2 Cloud Backups ===');
  try {
    const objects = await listObjects(client, config.r2Bucket);
    if (objects.length === 0) {
      console.log('  (none)');
    } else {
      for (const obj of objects) {
        const date = obj.lastModified ? obj.lastModified.toISOString().replace('T', ' ').slice(0, 19) : '';
        console.log(`  ${obj.key}  ${date}  (${formatBytes(obj.size)})`);
      }
    }
  } catch (err) {
    logger.warn(`Could not list R2 backups: ${err.message}`);
  }
}

/**
 * restore(backupName)
 * Download from R2 if needed → confirm → reset schema → restore → restart service
 */
async function restore(config, backupName) {
  if (!backupName) {
    throw new Error(
      'Usage: pg-r2-backup restore <backup_name>\n\nRun "pg-r2-backup list" to see available backups.'
    );
  }

  const client = createR2Client(config);
  const localPath = path.join(config.localBackupDir, backupName);

  if (!fs.existsSync(localPath)) {
    logger.log('Downloading from R2…');
    fs.mkdirSync(config.localBackupDir, { recursive: true });
    try {
      await downloadFile(client, config.r2Bucket, backupName, localPath);
    } catch (err) {
      throw new Error(`Download failed: ${err.message}`);
    }
  }

  if (!fs.existsSync(localPath)) {
    throw new Error(`Backup not found: ${backupName}`);
  }

  logger.warn('This will REPLACE the current database!');
  const answer = await confirm("Type 'yes' to confirm: ");
  if (answer !== 'yes') {
    logger.log('Cancelled.');
    return;
  }

  logger.log('Stopping web-service…');
  await dockerComposeService('stop', 'web-service');

  logger.log('Resetting public schema…');
  await resetPublicSchema(config.dbUser, config.dbName);

  logger.log('Restoring database…');
  try {
    await restoreDatabase(config.dbUser, config.dbName, localPath);
  } catch (err) {
    throw new Error(`Database restore failed: ${err.message}`);
  }

  logger.log('Starting web-service…');
  await dockerComposeService('start', 'web-service');

  logger.success(`Database restored from: ${backupName}`);
}

/**
 * cleanupR2()
 * Delete R2 objects older than config.retentionDays.
 */
async function cleanupR2(config, existingClient) {
  logger.log(`Cleaning R2 backups older than ${config.retentionDays} days…`);

  const client = existingClient || createR2Client(config);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - config.retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10).replace(/-/g, ''); // "YYYYMMDD"

  let objects;
  try {
    objects = await listObjects(client, config.r2Bucket);
  } catch (err) {
    logger.warn(`Could not list R2 objects for cleanup: ${err.message}`);
    return;
  }

  for (const obj of objects) {
    const fileDate = extractDateFromFilename(obj.key);
    if (fileDate && fileDate < cutoffStr) {
      logger.log(`Deleting old backup: ${obj.key}`);
      try {
        await deleteObject(client, config.r2Bucket, obj.key);
      } catch (err) {
        logger.warn(`Could not delete ${obj.key}: ${err.message}`);
      }
    }
  }
}

// ─── internal helpers ─────────────────────────────────────────────────────────

function getLocalBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^db_\d{8}_\d{6}\.sql\.gz$/.test(f))
    .sort();
}

function pruneLocalBackups(dir, olderThanDays) {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  for (const f of getLocalBackups(dir)) {
    const full = path.join(dir, f);
    try {
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.rmSync(full);
        logger.log(`Pruned old local backup: ${f}`);
      }
    } catch {
      // ignore
    }
  }
}

module.exports = { backup, list, restore, cleanupR2 };
