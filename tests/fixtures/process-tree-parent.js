'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const mode = process.argv[2] || 'normal';
const marker = process.argv[3];
spawn(process.execPath, [path.join(__dirname, 'process-tree-grandchild.js'), marker], {
  detached: false,
  stdio: 'ignore',
});
if (mode === 'overflow') {
  const timer = setInterval(() => {
    if (marker && require('node:fs').existsSync(marker)) {
      clearInterval(timer);
      process.stdout.write('x'.repeat(2_000_000));
    }
  }, 5);
}
if (mode === 'normal') setTimeout(() => process.exit(0), 100);
else setInterval(() => {}, 1_000);
