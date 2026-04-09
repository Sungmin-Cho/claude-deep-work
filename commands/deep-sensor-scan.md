---
allowed-tools: Bash, Read, Glob, Grep
description: "Run computational sensors (linter, type checker, coverage) on the project. Works independently of deep-work sessions."
---

# /deep-sensor-scan

Manual computational sensor scanning. Can be used inside or outside deep-work sessions.

## Usage

```
/deep-sensor-scan              # Full sensor scan (detect + run all)
/deep-sensor-scan --detect     # Show detected ecosystems only (no sensor execution)
/deep-sensor-scan --lint       # Run linter only
/deep-sensor-scan --typecheck  # Run type checker only
/deep-sensor-scan --coverage   # Run coverage measurement only
```

## How It Works

### Step 1: Ecosystem Detection

Run detection engine:
```bash
node "$PLUGIN_DIR/sensors/detect.js" "$PROJECT_ROOT"
```

Display detected ecosystems and tool availability. If `--detect` flag, stop here.

### Step 2: Sensor Execution

For each detected ecosystem with available tools, run sensors in order:

1. **Linter** (if available and not `--typecheck`/`--coverage` only):
   ```bash
   node "$PLUGIN_DIR/sensors/run-sensors.js" "<lint_cmd>" "<parser>" "lint" "required" 30
   ```

2. **Type checker** (if available and not `--lint`/`--coverage` only):
   ```bash
   node "$PLUGIN_DIR/sensors/run-sensors.js" "<typecheck_cmd>" "<parser>" "typecheck" "required" 60
   ```

3. **Coverage** (if available and not `--lint`/`--typecheck` only):
   Run test command with coverage flag appended.

### Step 3: Results Display

Show results in a clear format:
- Per-sensor: status (pass/fail/not_installed/timeout), error count, warning count
- Per-error: file:line, rule, message, FIX suggestion
- Summary: total errors, total warnings, ecosystems scanned
