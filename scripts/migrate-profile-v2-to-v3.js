'use strict';

const {
  migrateProfileCore: migrateProfile,
  readVersion,
  v2TextToV3Text,
  createV3Profile,
  isStaleLock,
} = require('../runtime/profile-runtime.js');

module.exports = { migrateProfile, readVersion, v2TextToV3Text, createV3Profile, isStaleLock };

if (require.main === module) {
  const profilePath = process.argv[2];
  if (!profilePath) {
    process.stderr.write('Usage: node migrate-profile-v2-to-v3.js <profile-path>\n');
    process.exitCode = 2;
  } else {
    try {
      let result = migrateProfile(profilePath);
      if (result.migrated === false && result.reason === 'not-found') {
        const initialPreset = process.env.DEEP_WORK_INITIAL_PRESET || 'solo-strict';
        createV3Profile(profilePath, initialPreset);
        result = {migrated:false, reason:'not-found-created-v3', default_preset:initialPreset};
      }
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch (error) {
      process.stderr.write(`migrate-profile error: ${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
