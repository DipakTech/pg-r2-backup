'use strict';

const { spawn } = require('child_process');
const { createGzip, createGunzip } = require('zlib');
const fs = require('fs');
const { pipeline } = require('stream/promises');

/**
 * Run a docker compose command and return a ChildProcess.
 * The process inherits stderr so progress / errors are visible.
 */
function spawnDockerCompose(args, options = {}) {
  return spawn('docker', ['compose', ...args], {
    stdio: options.stdio || ['pipe', 'pipe', 'inherit'],
    ...options,
  });
}

/**
 * Dump the database to a gzip-compressed file.
 *
 * Equivalent to:
 *   docker compose exec -T postgres pg_dump -U <user> <db> | gzip > <outPath>
 */
async function dumpDatabase(dbUser, dbName, outPath, postgresService = 'postgres') {
  return new Promise((resolve, reject) => {
    const pgDump = spawnDockerCompose([
      'exec', '-T', postgresService,
      'pg_dump', '-U', dbUser, dbName,
    ]);

    const gzip = createGzip();
    const outStream = fs.createWriteStream(outPath);

    // pg_dump stdout → gzip → file
    pgDump.stdout.pipe(gzip).pipe(outStream);

    let dumpError = null;

    pgDump.on('error', (err) => {
      dumpError = err;
      gzip.destroy(err);
    });

    pgDump.on('close', (code) => {
      if (code !== 0) {
        dumpError = dumpError || new Error(`pg_dump exited with code ${code}. Is the container running?`);
      }
    });

    outStream.on('error', reject);

    outStream.on('finish', () => {
      if (dumpError) return reject(dumpError);
      resolve();
    });
  });
}

/**
 * Reset the public schema in the database.
 *
 * Equivalent to:
 *   docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U <user> -d <db>
 *   with a heredoc that drops and recreates public schema.
 */
async function resetPublicSchema(dbUser, dbName, postgresService = 'postgres') {
  const sql = [
    `DROP SCHEMA IF EXISTS public CASCADE;`,
    `CREATE SCHEMA public AUTHORIZATION "${dbUser}";`,
    `GRANT ALL ON SCHEMA public TO public;`,
  ].join('\n');

  return runPsql(dbUser, dbName, sql, postgresService);
}

/**
 * Restore a gzip-compressed SQL dump into the database.
 *
 * Equivalent to:
 *   gunzip -c <filePath> | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U <user> -d <db>
 */
async function restoreDatabase(dbUser, dbName, filePath, postgresService = 'postgres') {
  return new Promise((resolve, reject) => {
    const psql = spawnDockerCompose([
      'exec', '-T', postgresService,
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', dbName,
    ]);

    const gunzip = createGunzip();
    const inStream = fs.createReadStream(filePath);

    // file → gunzip → psql stdin
    inStream.pipe(gunzip).pipe(psql.stdin);

    let psqlError = null;

    gunzip.on('error', (err) => {
      psqlError = err;
      psql.stdin.destroy(err);
    });

    psql.on('error', (err) => {
      psqlError = err;
    });

    psql.on('close', (code) => {
      if (code !== 0) {
        reject(psqlError || new Error(`psql exited with code ${code}`));
      } else {
        resolve();
      }
    });

    inStream.on('error', reject);
  });
}

/**
 * Run arbitrary SQL via psql inside the postgres container.
 */
async function runPsql(dbUser, dbName, sql, postgresService = 'postgres') {
  return new Promise((resolve, reject) => {
    const psql = spawnDockerCompose([
      'exec', '-T', postgresService,
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', dbName,
    ]);

    psql.stdin.write(sql);
    psql.stdin.end();

    psql.on('error', reject);
    psql.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`psql exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Start or stop a docker compose service.
 * action: 'start' | 'stop'
 */
async function dockerComposeService(action, service) {
  return new Promise((resolve, reject) => {
    const proc = spawnDockerCompose([action, service], {
      stdio: 'inherit',
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      // Treat non-zero gracefully (service may already be stopped/started)
      resolve(code);
    });
  });
}

module.exports = {
  dumpDatabase,
  resetPublicSchema,
  restoreDatabase,
  dockerComposeService,
};
