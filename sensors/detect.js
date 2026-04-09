'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function loadRegistry(registryPath) {
  const raw = fs.readFileSync(registryPath, 'utf-8');
  return JSON.parse(raw);
}

function fileExistsOrGlob(dir, pattern) {
  if (!pattern.includes('*')) {
    return fs.existsSync(path.join(dir, pattern));
  }
  const regexStr = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
  const regex = new RegExp('^' + regexStr + '$');
  try {
    const entries = fs.readdirSync(dir);
    return entries.some(entry => regex.test(entry));
  } catch {
    return false;
  }
}

function matchEcosystem(projectRoot, detectConfig) {
  const required = detectConfig.require;
  const anyOf = detectConfig.any_of;

  if (required && required.length > 0) {
    const allPresent = required.every(pattern => fileExistsOrGlob(projectRoot, pattern));
    if (!allPresent) return false;
  }

  if (anyOf && anyOf.length > 0) {
    const somePresent = anyOf.some(pattern => fileExistsOrGlob(projectRoot, pattern));
    if (!somePresent) return false;
  }

  if (!required && !anyOf) return false;
  if (required && required.length === 0 && anyOf && anyOf.length === 0) return false;

  return true;
}

function checkToolAvailable(cmd) {
  if (!cmd) return false;
  const parts = cmd.trim().split(/\s+/);
  try {
    if (parts[0] === 'npx') {
      const pkg = parts[1];
      execFileSync('npx', ['--no-install', pkg, '--version'], { stdio: 'ignore', timeout: 10000 });
    } else {
      const binary = parts[0];
      execFileSync('which', [binary], { stdio: 'ignore', timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}

function detectEcosystems(projectRoot, registryPath) {
  const registry = loadRegistry(registryPath);
  const detected = [];

  for (const name of Object.keys(registry.ecosystems)) {
    const def = registry.ecosystems[name];
    if (!def.detect) continue;
    if (!matchEcosystem(projectRoot, def.detect)) continue;

    const sensors = {};
    const sensorKeys = ['lint', 'typecheck', 'mutation'];
    for (const key of sensorKeys) {
      if (def[key]) {
        const sensorDef = def[key];
        const available = checkToolAvailable(sensorDef.cmd);
        sensors[key] = {
          tool: sensorDef.cmd ? sensorDef.cmd.trim().split(/\s+/)[0] : null,
          cmd: sensorDef.cmd || null,
          parser: sensorDef.parser || null,
          status: available ? 'available' : 'not_installed',
        };
      }
    }

    detected.push({
      name,
      root: '.',
      sensors,
      file_extensions: def.file_extensions || [],
      coverage_flag: def.coverage_flag || null,
    });
  }

  return {
    ecosystems: detected,
    detected_at: new Date().toISOString(),
  };
}

module.exports = { loadRegistry, matchEcosystem, detectEcosystems, checkToolAvailable };

if (require.main === module) {
  const projectRoot = process.argv[2] || process.cwd();
  const registryPath = path.join(__dirname, 'registry.json');
  const result = detectEcosystems(projectRoot, registryPath);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');

  // Cache detection results to .claude/.sensor-detection-cache.json for
  // subsequent deep-implement runs to read without re-running detection.
  const cacheDir = path.join(projectRoot, '.claude');
  if (fs.existsSync(cacheDir)) {
    fs.writeFileSync(path.join(cacheDir, '.sensor-detection-cache.json'), JSON.stringify(result, null, 2));
  }
}
