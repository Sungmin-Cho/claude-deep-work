'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const POSIX_GRACE_MS = 500;
const TREE_EXIT_CONFIRM_MS = 2_000;

function typedError(code, message, details = {}) {
  const error = new Error(message || code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function supervisionStages(started, toolResult, termination) {
  return Object.freeze({started:Boolean(started), 'tool-result':Boolean(toolResult), termination});
}

function attachSupervisionStages(error, stages) {
  const target = error instanceof Error ? error : typedError('process-supervision-failed', String(error));
  try { target.stages = stages; return target; }
  catch { return typedError(target.code || 'process-supervision-failed', target.message,
    {cause:target, stages}); }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code !== 'ESRCH';
  }
}

function groupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    return error && error.code !== 'ESRCH';
  }
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (!predicate()) return true;
    await delay(20);
  } while (Date.now() < deadline);
  return !predicate();
}

async function terminatePosixGroup(pid, killImpl = process.kill) {
  const signal = (value) => {
    try { killImpl(-pid, value); return true; }
    catch (error) {
      if (error && error.code === 'ESRCH') return false;
      throw error;
    }
  };
  if (!groupAlive(pid)) return;
  signal('SIGTERM');
  if (await waitFor(() => groupAlive(pid), POSIX_GRACE_MS)) return;
  signal('SIGKILL');
  if (!await waitFor(() => groupAlive(pid), TREE_EXIT_CONFIRM_MS)) {
    throw typedError('process-tree-termination-failed', `process group ${pid} remains alive`, {pid});
  }
}

function terminateWindowsTree(pid, {systemRoot, spawnImpl = childProcess.spawn, knownPids = [],
  pidAliveImpl = pidAlive, confirmMs = TREE_EXIT_CONFIRM_MS} = {}) {
  return new Promise((resolve, reject) => {
    if (typeof systemRoot !== 'string' || !systemRoot || /[\0\r\n]/.test(systemRoot)) {
      reject(typedError('process-tree-termination-failed', 'SystemRoot is unavailable'));
      return;
    }
    const executable = path.win32.join(systemRoot, 'System32', 'taskkill.exe');
    let child;
    try {
      child = spawnImpl(executable, ['/PID', String(pid), '/T', '/F'], {
        shell:false,
        windowsHide:true,
        stdio:['ignore', 'pipe', 'pipe'],
      });
    } catch (cause) {
      reject(typedError('process-tree-termination-failed', cause.message, {cause, executable}));
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', (cause) => reject(typedError('process-tree-termination-failed',
      cause.message, {cause, executable})));
    child.once('close', async (code) => {
      if (code !== 0) {
        const childRoots = [...new Set(knownPids)]
          .filter((value) => Number.isSafeInteger(value) && value > 0 && value !== pid);
        await Promise.allSettled(childRoots.map((childPid) => terminateWindowsTree(childPid, {
          systemRoot, spawnImpl, knownPids:[], pidAliveImpl, confirmMs,
        })));
        reject(typedError('process-tree-termination-failed',
          `taskkill failed with exit ${code}: ${stderr.slice(0, 512)}`, {exitCode:code}));
        return;
      }
      const recorded = [...new Set([pid, ...knownPids]
        .filter((value) => Number.isSafeInteger(value) && value > 0))];
      if (!await waitFor(() => recorded.some((value) => pidAliveImpl(value)), confirmMs)) {
        const remainingPids = recorded.filter((value) => pidAliveImpl(value));
        reject(typedError('process-tree-termination-failed',
          `recorded Windows processes remain alive: ${remainingPids.join(',')}`, {pid, remainingPids}));
        return;
      }
      resolve();
    });
  });
}

function collectChild(child, {timeoutMs, maxOutputBytes, terminate}) {
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    let outputOverflow = false;
    let outputBytes = 0;
    let settled = false;
    let terminationPromise = null;
    const startedAt = Date.now();
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      void beginTermination();
    }, timeoutMs) : null;

    function append(which, chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, maxOutputBytes - stdout.length - stderr.length);
      const retained = value.subarray(0, remaining);
      if (which === 'stdout') stdout = Buffer.concat([stdout, retained]);
      else stderr = Buffer.concat([stderr, retained]);
      outputBytes += value.length;
      if (outputBytes > maxOutputBytes) {
        outputOverflow = true;
        void beginTermination();
      }
    }

    function beginTermination() {
      if (terminationPromise) return terminationPromise;
      terminationPromise = Promise.resolve().then(terminate).catch((error) => {
        if (timer) clearTimeout(timer);
        if (!settled) { settled = true; reject(error); }
      });
      return terminationPromise;
    }

    child.stdout?.on('data', (chunk) => append('stdout', chunk));
    child.stderr?.on('data', (chunk) => append('stderr', chunk));
    child.once('error', (cause) => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(typedError('process-spawn-failed', cause.message, {cause}));
      }
    });
    child.once('close', async (code, signal) => {
      if (timer) clearTimeout(timer);
      if (settled) return;
      try {
        await beginTermination();
        if (settled) return;
        settled = true;
        const overflowError = outputOverflow
          ? {code:'process-output-overflow', message:'process output exceeded the configured limit'}
          : null;
        resolve({
          ok:code === 0 && !timedOut && !outputOverflow,
          exitCode:code,
          signal,
          stdout:stdout.subarray(0, maxOutputBytes).toString('utf8'),
          stderr:stderr.subarray(0, maxOutputBytes).toString('utf8'),
          timedOut,
          outputOverflow,
          error:timedOut ? {code:'process-timeout', message:'process timed out'} : overflowError,
          durationMs:Date.now() - startedAt,
        });
      } catch (error) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function runPosix(spec, options) {
  const spawnImpl = options.spawnImpl || childProcess.spawn;
  const child = spawnImpl(spec.executable, spec.args, {
    cwd:options.cwd,
    env:options.env,
    shell:false,
    detached:true,
    windowsHide:true,
    stdio:[options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  if (options.input !== undefined) child.stdin.end(options.input);
  return collectChild(child, {
    timeoutMs:options.timeoutMs,
    maxOutputBytes:options.maxOutputBytes,
    terminate:() => (options.terminationImpl
      ? options.terminationImpl({platform:options.platform, pid:child.pid, child})
      : terminatePosixGroup(child.pid)),
  });
}

async function runWindows(spec, options) {
  if (options.spawnImpl) {
    const child = options.spawnImpl(spec.executable, spec.args, {
      cwd:options.cwd, env:options.env, shell:false, detached:false, windowsHide:true,
      stdio:[options.input === undefined ? 'ignore' : 'pipe','pipe','pipe'],
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    return collectChild(child, {
      timeoutMs:options.timeoutMs,
      maxOutputBytes:options.maxOutputBytes,
      terminate:() => options.terminationImpl
        ? options.terminationImpl({platform:'win32', pid:child.pid, child, knownPids:[child.pid]})
        : terminateWindowsTree(child.pid, {systemRoot:options.env.SystemRoot || options.env.SYSTEMROOT,
          knownPids:[child.pid]}),
    });
  }

  const supervisor = childProcess.fork(__filename, ['--windows-supervisor'], {
    cwd:options.cwd,
    env:options.env,
    windowsHide:true,
    detached:false,
    silent:true,
  });
  supervisor.send({type:'start', spec,
    input:options.input === undefined ? null : Buffer.from(options.input).toString('base64')});
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let finishing = false;
    let outputOverflow = false;
    let outputBytes = 0;
    let toolStarted = false;
    let toolResultSeen = false;
    const knownPids = new Set();
    const startedAt = Date.now();
    const timer = options.timeoutMs > 0 ? setTimeout(() => void finish('timeout', null),
      options.timeoutMs) : null;
    const terminate = () => options.terminationImpl
      ? options.terminationImpl({platform:'win32', pid:supervisor.pid, child:supervisor,
        knownPids:[...knownPids]})
      : terminateWindowsTree(supervisor.pid, {
        systemRoot:options.env.SystemRoot || options.env.SYSTEMROOT,
        knownPids:[...knownPids],
      });

    function append(which, chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, options.maxOutputBytes - stdout.length - stderr.length);
      const retained = value.subarray(0, remaining);
      if (which === 'stdout') stdout = Buffer.concat([stdout, retained]);
      else stderr = Buffer.concat([stderr, retained]);
      outputBytes += value.length;
      if (!finishing && outputBytes > options.maxOutputBytes) {
        outputOverflow = true;
        void finish('overflow', null);
      }
    }

    async function finish(reason, toolResult) {
      if (finishing || settled) return;
      finishing = true;
      if (timer) clearTimeout(timer);
      try {
        await terminate();
        settled = true;
        const timedOut = reason === 'timeout';
        resolve({
          ok:reason === 'normal' && toolResult && toolResult.exitCode === 0,
          exitCode:toolResult ? toolResult.exitCode : null,
          signal:toolResult ? toolResult.signal : null,
          stdout:stdout.subarray(0, options.maxOutputBytes).toString('utf8'),
          stderr:stderr.subarray(0, options.maxOutputBytes).toString('utf8'),
          timedOut,
          outputOverflow,
          error:timedOut ? {code:'process-timeout', message:'process timed out'}
            : outputOverflow ? {code:'process-output-overflow',
              message:'process output exceeded the configured limit'} : null,
          stages:supervisionStages(toolStarted, toolResultSeen, 'complete'),
          durationMs:Date.now() - startedAt,
        });
      } catch (error) {
        settled = true;
        reject(attachSupervisionStages(error,
          supervisionStages(toolStarted, toolResultSeen, 'failed')));
      }
    }

    supervisor.stdout.on('data', (chunk) => append('stdout', chunk));
    supervisor.stderr.on('data', (chunk) => append('stderr', chunk));
    supervisor.on('message', (message) => {
      if (message && message.type === 'tool-started' && Number.isSafeInteger(message.pid) &&
          message.pid > 0) {
        toolStarted = true;
        knownPids.add(message.pid);
      }
      if (message && message.type === 'tool-result') {
        toolResultSeen = true;
        void finish('normal', message);
      }
    });
    supervisor.once('error', (cause) => {
      if (timer) clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(typedError('process-spawn-failed', cause.message, {cause,
          stages:supervisionStages(toolStarted, toolResultSeen, 'not-started')}));
      }
    });
    supervisor.once('close', async (code, signal) => {
      if (!finishing && !settled) {
        if (timer) clearTimeout(timer);
        finishing = true;
        try {
          await terminate();
          settled = true;
          reject(typedError('process-tree-termination-failed',
            `Windows supervisor exited before a tool result (${code}/${signal})`,
            {knownPids:[...knownPids],
              stages:supervisionStages(toolStarted, toolResultSeen, 'complete')}));
        } catch (cause) {
          settled = true;
          reject(attachSupervisionStages(cause,
            supervisionStages(toolStarted, toolResultSeen, 'failed')));
        }
      }
    });
  });
}

async function runSupervisedProcess(spec, options = {}) {
  if (!spec || typeof spec.executable !== 'string' || !Array.isArray(spec.args)) {
    throw typedError('process-spec-invalid', 'executable and args are required');
  }
  const platform = options.platform || process.platform;
  if (!['win32','darwin','linux'].includes(platform)) {
    throw typedError('process-platform-unsupported', `unsupported platform: ${platform}`);
  }
  const normalized = {
    ...options,
    platform,
    env:Object.freeze(options.env === undefined ? {...process.env} : {...options.env}),
    timeoutMs:options.timeoutMs === undefined ? 30_000 : options.timeoutMs,
    maxOutputBytes:options.maxOutputBytes === undefined ? 16_777_216 : options.maxOutputBytes,
    input:options.input,
  };
  if (!Number.isSafeInteger(normalized.timeoutMs) || normalized.timeoutMs <= 0 ||
      !Number.isSafeInteger(normalized.maxOutputBytes) || normalized.maxOutputBytes <= 0 ||
      normalized.maxOutputBytes > 67_108_864) {
    throw typedError('process-budget-invalid', 'process timeout/output budget is invalid');
  }
  return platform === 'win32' ? runWindows(spec, normalized) : runPosix(spec, normalized);
}

if (process.argv[2] === '--windows-supervisor') {
  process.once('message', (message) => {
    if (!message || message.type !== 'start') process.exit(70);
    const child = childProcess.spawn(message.spec.executable, message.spec.args, {
      shell:false, detached:false, windowsHide:true,
      stdio:[message.input === null ? 'ignore' : 'pipe','pipe','pipe'],
    });
    process.send?.({type:'tool-started', pid:child.pid});
    if (message.input !== null) child.stdin.end(Buffer.from(message.input, 'base64'));
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.once('error', (error) => {
      process.stderr.write(error.message);
      process.exit(71);
    });
    child.once('close', (code, signal) => {
      let pendingFlushes = 2;
      const flushed = () => {
        pendingFlushes -= 1;
        if (pendingFlushes !== 0) return;
        process.send?.({type:'tool-result', exitCode:Number.isInteger(code) ? code : null,
          signal:signal || null, toolPid:child.pid});
        setInterval(() => {}, 1_000);
      };
      process.stdout.write('', flushed);
      process.stderr.write('', flushed);
    });
  });
}

if (process.argv[2] === '--windows-stream-inventory-supervisor') {
  const chunks = [];
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.once('end', async () => {
    try {
      const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const helper = path.join(__dirname, 'windows-stream-inventory.ps1');
      const helperDigest = crypto.createHash('sha256').update(fs.readFileSync(helper)).digest('hex');
      const expectedExecutable = path.win32.join(request.options.env.SystemRoot, 'System32',
        'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const args = request.spec.args;
      const exactPrefix = ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,
        '-RootPath'];
      const requestKeys = request && typeof request === 'object' ? Object.keys(request).sort().join(',') : '';
      const optionKeys = request.options && typeof request.options === 'object'
        ? Object.keys(request.options).sort().join(',') : '';
      const specKeys = request.spec && typeof request.spec === 'object'
        ? Object.keys(request.spec).sort().join(',') : '';
      const envKeys = request.options && request.options.env
        ? Object.keys(request.options.env).sort().join(',') : '';
      if (requestKeys !== 'input,options,spec' || optionKeys !== 'cwd,env,maxOutputBytes,platform,timeoutMs' ||
          specKeys !== 'args,executable' || envKeys !== 'PATH,PSModulePath,SystemRoot,TEMP,TMP,WINDIR' ||
          request.options.platform !== 'win32' || request.options.timeoutMs !== 20_000 ||
          request.options.maxOutputBytes !== 67_108_864 || helperDigest !==
            '6f03bbb1cf647b6932e092d179cf82cb37cf357d1f4fbc1f4589952d7fee552b' ||
          typeof request.spec.executable !== 'string' ||
          path.win32.normalize(request.spec.executable).toLowerCase() !==
            path.win32.normalize(expectedExecutable).toLowerCase() || !Array.isArray(args) || args.length !== 9 ||
          exactPrefix.some((value, index) => args[index] !== value) || args[8] !== request.options.cwd ||
          typeof request.input !== 'string' ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.input) ||
          Buffer.from(request.input, 'base64').length > 67_108_864) {
        throw typedError('process-spec-invalid', 'invalid closed Windows stream inventory request');
      }
      const result = await runSupervisedProcess(request.spec, {
        ...request.options,
        input:request.input === null ? undefined : Buffer.from(request.input, 'base64'),
      });
      process.stdout.write(JSON.stringify({ok:true, result}));
    } catch (error) {
      process.stdout.write(JSON.stringify({ok:false, error:{code:error.code || 'error',
        message:error.message, stages:error.stages || null}}));
      process.exitCode = 1;
    }
  });
}

module.exports = {
  runSupervisedProcess,
  terminateWindowsTree,
  POSIX_GRACE_MS,
  TREE_EXIT_CONFIRM_MS,
};
