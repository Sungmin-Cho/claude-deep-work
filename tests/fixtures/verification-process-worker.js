'use strict';

const [mode, message = ''] = process.argv.slice(2);
if (message) process.stdout.write(`${message}\n`);
if (mode === 'pass') process.exitCode = 0;
else if (mode === 'fail') process.exitCode = 42;
else if (mode === 'write') {
  require('node:fs').writeFileSync(process.argv[4], 'side effect\n');
  process.exitCode = 0;
} else process.exitCode = 64;
