'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Load topology definitions from the registry JSON file.
 * @param {string} registryPath - Absolute path to topology-registry.json
 * @returns {object} Parsed registry
 */
function loadRegistry(registryPath) {
  const raw = fs.readFileSync(registryPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Load custom topology definitions from a directory of JSON files.
 * Each file must have a `topologies` array at top level, or be a single topology object.
 * @param {string} customDir - Directory to scan for *.json files
 * @returns {object[]} Array of custom topology definitions
 */
function loadCustomTopologies(customDir) {
  if (!fs.existsSync(customDir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(customDir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const result = [];
  for (const file of entries) {
    try {
      const raw = fs.readFileSync(path.join(customDir, file), 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.topologies)) {
        result.push(...parsed.topologies);
      } else if (parsed.id) {
        result.push(parsed);
      }
    } catch {
      // Skip invalid JSON files
    }
  }
  return result;
}

/**
 * Merge built-in topologies with custom topologies.
 * Custom topologies with existing IDs override built-ins; new IDs are appended.
 * Result is sorted by priority (highest first).
 * @param {object[]} builtins
 * @param {object[]} customs
 * @returns {object[]}
 */
function mergeTopologies(builtins, customs) {
  const map = new Map();
  for (const t of builtins) {
    map.set(t.id, t);
  }
  for (const t of customs) {
    map.set(t.id, t);
  }
  return Array.from(map.values()).sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/**
 * Read all dependency names from a package.json file.
 * @param {string} projectRoot
 * @returns {Set<string>}
 */
function readNodeDeps(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return new Set();
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ]);
  } catch {
    return new Set();
  }
}

/**
 * Read Python dependency names from pyproject.toml using a simple regex.
 * @param {string} projectRoot
 * @returns {Set<string>}
 */
function readPythonDeps(projectRoot) {
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (!fs.existsSync(pyprojectPath)) return new Set();
  try {
    const content = fs.readFileSync(pyprojectPath, 'utf-8');
    const match = content.match(/^dependencies\s*=\s*\[([^\]]*)\]/m);
    if (!match) return new Set();
    const depsStr = match[1];
    const deps = new Set();
    const itemRegex = /"([^"]+)"|'([^']+)'/g;
    let m;
    while ((m = itemRegex.exec(depsStr)) !== null) {
      const dep = (m[1] || m[2]).trim();
      const name = dep.split(/[><=!~\[;]/)[0].trim().toLowerCase();
      if (name) deps.add(name);
    }
    return deps;
  } catch {
    return new Set();
  }
}

/**
 * Check if a project is a Python project.
 * @param {string} projectRoot
 * @returns {boolean}
 */
function isPythonProject(projectRoot) {
  return (
    fs.existsSync(path.join(projectRoot, 'pyproject.toml')) ||
    fs.existsSync(path.join(projectRoot, 'setup.py')) ||
    fs.existsSync(path.join(projectRoot, 'requirements.txt'))
  );
}

/**
 * Evaluate whether a topology's detect conditions are satisfied.
 * @param {string} projectRoot
 * @param {object} detect
 * @param {Set<string>} nodeDeps
 * @param {Set<string>} pythonDeps
 * @returns {boolean}
 */
function matchTopology(projectRoot, detect, nodeDeps, pythonDeps) {
  if (detect.always === true) return true;

  if (detect.marker_files && detect.marker_files.length > 0) {
    const anyExists = detect.marker_files.some(f => fs.existsSync(path.join(projectRoot, f)));
    if (!anyExists) return false;
  }

  if (detect.marker_dirs && detect.marker_dirs.length > 0) {
    const anyExists = detect.marker_dirs.some(d => {
      const fullPath = path.join(projectRoot, d);
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    });
    if (!anyExists) return false;
  }

  if (detect.deps && detect.deps.length > 0) {
    const allPresent = detect.deps.every(dep => nodeDeps.has(dep));
    if (!allPresent) return false;
  }

  if (detect.deps_any && detect.deps_any.length > 0) {
    const anyPresent = detect.deps_any.some(dep => nodeDeps.has(dep));
    if (!anyPresent) return false;
  }

  if (detect.exclude_deps && detect.exclude_deps.length > 0) {
    const anyExcluded = detect.exclude_deps.some(dep => nodeDeps.has(dep));
    if (anyExcluded) return false;
  }

  if (detect.python_deps_any && detect.python_deps_any.length > 0) {
    const anyPresent = detect.python_deps_any.some(dep => pythonDeps.has(dep));
    if (!anyPresent) return false;
  }

  if (detect.python_project === true) {
    if (!isPythonProject(projectRoot)) return false;
  }

  if (detect.exclude_python_deps && detect.exclude_python_deps.length > 0) {
    const anyExcluded = detect.exclude_python_deps.some(dep => pythonDeps.has(dep));
    if (anyExcluded) return false;
  }

  const hasPositiveCondition =
    detect.always ||
    (detect.marker_files && detect.marker_files.length > 0) ||
    (detect.marker_dirs && detect.marker_dirs.length > 0) ||
    (detect.deps && detect.deps.length > 0) ||
    (detect.deps_any && detect.deps_any.length > 0) ||
    (detect.python_deps_any && detect.python_deps_any.length > 0) ||
    detect.python_project === true;

  if (!hasPositiveCondition) return false;

  return true;
}

/**
 * Detect the topology of a project.
 *
 * @param {string} projectRoot - Absolute path to project root
 * @param {string} registryPath - Path to topology-registry.json
 * @param {object} [options]
 * @param {object} [options.ecosystemResult] - Result from ecosystem detector (for dep reuse)
 * @param {string} [options.customDir] - Directory to scan for custom topology JSON files
 * @returns {{ id: string, display_name: string, priority: number, confidence: string }}
 */
function detectTopology(projectRoot, registryPath, options) {
  const opts = options || {};

  const registry = loadRegistry(registryPath);
  const builtins = registry.topologies || [];

  const customDir = opts.customDir || path.join(path.dirname(registryPath), 'custom');
  const customs = loadCustomTopologies(customDir);

  const topologies = mergeTopologies(builtins, customs);

  const nodeDeps = readNodeDeps(projectRoot);
  const pythonDeps = readPythonDeps(projectRoot);

  for (const topology of topologies) {
    if (!topology.detect) continue;
    if (matchTopology(projectRoot, topology.detect, nodeDeps, pythonDeps)) {
      return {
        id: topology.id,
        display_name: topology.display_name,
        priority: topology.priority,
        confidence: topology.priority >= 60 ? 'high' : 'low',
      };
    }
  }

  return {
    id: 'generic',
    display_name: 'Generic',
    priority: 0,
    confidence: 'low',
  };
}

module.exports = { detectTopology, loadRegistry, loadCustomTopologies, mergeTopologies, matchTopology };

if (require.main === module) {
  const projectRoot = process.argv[2] || process.cwd();
  const registryPath = path.join(__dirname, 'topology-registry.json');
  const result = detectTopology(projectRoot, registryPath);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
