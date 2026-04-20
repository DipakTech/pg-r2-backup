'use strict';

/**
 * pg-r2-backup
 *
 * Programmatic API – useful when embedding backup/restore into larger Node.js
 * applications or custom scripts.
 *
 * @example
 * const { backup, restore, list, cleanupR2, loadConfig, validateConfig } = require('pg-r2-backup');
 *
 * const config = validateConfig(loadConfig());
 * await backup(config);
 */

const { loadConfig, validateConfig } = require('./config');
const { backup, list, restore, cleanupR2 } = require('./commands');

module.exports = { loadConfig, validateConfig, backup, list, restore, cleanupR2 };
