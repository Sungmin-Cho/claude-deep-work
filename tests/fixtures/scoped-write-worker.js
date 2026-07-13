'use strict';

const fs = require('node:fs');
const path = require('node:path');
const [root, relative, contents = 'changed\n'] = process.argv.slice(2);
const target = path.join(root, relative);
fs.mkdirSync(path.dirname(target), {recursive:true});
fs.writeFileSync(target, contents);
