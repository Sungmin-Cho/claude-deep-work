'use strict';

const fs = require('node:fs');

const marker = process.argv[2];
if (marker) fs.writeFileSync(marker, String(process.pid));
setInterval(() => {}, 1_000);
