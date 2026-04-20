'use strict';

const RESET = '\x1b[0m';
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const DIM = '\x1b[2m';

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const logger = {
  log(msg) {
    console.log(`${DIM}[${timestamp()}]${RESET} ${msg}`);
  },
  success(msg) {
    console.log(`${GREEN}[OK]${RESET} ${msg}`);
  },
  warn(msg) {
    console.warn(`${YELLOW}[WARN]${RESET} ${msg}`);
  },
  error(msg) {
    console.error(`${RED}[ERROR]${RESET} ${msg}`);
  },
};

module.exports = logger;
