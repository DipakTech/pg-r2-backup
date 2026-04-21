'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Load and validate configuration from environment / .env file.
 * Mirrors the .env parsing logic from the original bash script.
 */
function loadConfig(envFile = '.env') {
  const envPath = path.resolve(process.cwd(), envFile);

  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    const lines = raw.split(/\r?\n/);

    let r2AccessKeyLoaded = false;
    let r2SecretKeyLoaded = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();

      // Strip surrounding quotes
      const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');
      const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
      if (isDoubleQuoted || isSingleQuoted) {
        value = value.slice(1, -1);
      } else {
        // Allow inline comments for unquoted values:
        // FOO=bar # comment
        const hashIdx = value.indexOf('#');
        if (hashIdx !== -1) {
          value = value.slice(0, hashIdx).trim();
        }
      }

      // Only set if not already set in the real environment
      if (!(key in process.env)) {
        process.env[key] = value;
      }

      if (key === 'R2_ACCESS_KEY_ID') r2AccessKeyLoaded = true;
      if (key === 'R2_SECRET_ACCESS_KEY') r2SecretKeyLoaded = true;
    }

    // If neither key was in .env, clear any stale values (match bash behaviour)
    if (!r2AccessKeyLoaded && !r2SecretKeyLoaded) {
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
    }
  }

  const e = process.env;

  return {
    // R2 / S3
    r2AccountId: e.R2_ACCOUNT_ID || e.ACCOUNT_ID || '',
    r2AccessKeyId: e.R2_ACCESS_KEY_ID || e.ACCESS_KEY_ID || '',
    r2SecretAccessKey: e.R2_SECRET_ACCESS_KEY || e.SECRET_ACCESS_KEY || '',
    r2Bucket: e.R2_BUCKET || 'school-website-backups',

    // Database
    dbUser: e.DB_USER || e.POSTGRES_USER || 'db_user',
    dbName: e.DB_NAME || e.POSTGRES_DB || 'schooldb',
    postgresService: e.POSTGRES_SERVICE || e.DB_SERVICE || 'postgres',
    appService: e.APP_SERVICE || e.WEB_SERVICE || 'web-service',

    // Local storage
    localBackupDir: e.LOCAL_BACKUP_DIR || './backups',

    // Retention
    retentionDays: parseInt(e.RETENTION_DAYS || '30', 10),
  };
}

/**
 * Validate that all required config fields are present.
 * Throws an error listing every missing field so the user can fix them all at once.
 */
function validateConfig(config) {
  const missing = [];

  if (!config.r2AccountId) missing.push('R2_ACCOUNT_ID');

  // If one R2 key is set the other must also be set
  const hasAccessKey = Boolean(config.r2AccessKeyId);
  const hasSecretKey = Boolean(config.r2SecretAccessKey);
  if (hasAccessKey !== hasSecretKey) {
    missing.push(
      hasAccessKey ? 'R2_SECRET_ACCESS_KEY' : 'R2_ACCESS_KEY_ID'
    );
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}\n` +
        'Set them in your shell, a .env file, or pass --env-file <path>.'
    );
  }

  return config;
}

module.exports = { loadConfig, validateConfig };
