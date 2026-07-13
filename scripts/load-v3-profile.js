'use strict';

const { loadV3Profile } = require('../runtime/profile-runtime.js');

module.exports = { loadV3Profile };

if (require.main === module) {
  const profilePath = process.argv[2];
  if (!profilePath) {
    process.stderr.write('Usage: node load-v3-profile.js <profile-path>\n');
    process.exitCode = 2;
  } else {
    const initialPreset = process.env.DEEP_WORK_INITIAL_PRESET || undefined;
    const result = loadV3Profile(profilePath, {initialPreset});
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.error) process.exitCode = 1;
  }
}
