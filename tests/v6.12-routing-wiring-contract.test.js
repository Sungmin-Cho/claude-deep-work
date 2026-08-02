'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function routingCallWindow(skill, anchor) {
  const anchorIndex = skill.indexOf(anchor);
  assert.ok(anchorIndex >= 0, `missing routing anchor: ${anchor}`);
  const callIndex = skill.indexOf('MR_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/model-routing-cli.js"', anchorIndex);
  assert.ok(callIndex > anchorIndex, `missing model-routing call after: ${anchor}`);
  return skill.slice(anchorIndex, callIndex + 700);
}

function bashFences(block) {
  return [...block.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
}

function unquotedShellSurface(shell) {
  let surface = '';
  let quote = null;
  let escaped = false;
  let comment = false;
  for (let index = 0; index < shell.length; index++) {
    const char = shell[index];
    if (comment) {
      if (char === '\n') {
        comment = false;
        surface += '\n';
      } else {
        surface += ' ';
      }
      continue;
    }
    if (escaped) {
      surface += ' ';
      escaped = false;
      continue;
    }
    if (quote) {
      if (char === '\\' && quote === '"' && shell[index + 1] === '\n') {
        index++;
        continue;
      }
      if (char === '\\' && quote === '"') escaped = true;
      else if (char === quote) quote = null;
      surface += ' ';
      continue;
    }
    if (char === '\\' && shell[index + 1] === '\n') {
      index++;
    } else if (char === '\\') {
      escaped = true;
      surface += ' ';
    } else if (char === '"' || char === "'") {
      quote = char;
      surface += ' ';
    } else if (char === '#' && (index === 0 || /[\s;|&()]/.test(shell[index - 1]))) {
      comment = true;
      surface += ' ';
    } else {
      surface += char;
    }
  }
  return surface;
}

function runtimeAssignments(shell) {
  const surface = unquotedShellSurface(shell);
  return [...surface.matchAll(/(?:^|\n|;|&&|\|\||\||&)\s*(?:export\s+)?ROUTING_RUNTIME\s*=/g)];
}

function assertCurrentHostRuntimeWiring(block, surface) {
  assert.match(block, /Agent[^\n]*(?:도구|tool)[^\n]*(?:available|가용|사용 가능)/,
    `${surface} must derive the runtime from Agent tool availability`);
  assert.match(block, /Agent[\s\S]{0,120}?(?:available|가용|사용 가능)[\s\S]{0,80}?claude/i,
    `${surface} must map Agent availability to claude`);
  assert.match(block, /Agent[\s\S]{0,180}?(?:unavailable|없|사용 불가)[\s\S]{0,80}?codex/i,
    `${surface} must map Agent unavailability to codex`);

  const routingFences = bashFences(block)
    .filter((fence) => fence.includes('scripts/model-routing-cli.js'));
  assert.equal(routingFences.length, 1,
    `${surface} must define exactly one executable routing fence`);
  const routingFence = routingFences[0];
  const assignments = runtimeAssignments(routingFence);
  assert.equal(assignments.length, 1,
    `${surface} must assign the selected runtime exactly once in the routing fence`);
  assert.match(routingFence, /^ROUTING_RUNTIME="<current host: claude or codex>"$/m,
    `${surface} must require one host-selected literal assignment`);
  assert.match(routingFence, /case "\$ROUTING_RUNTIME" in[\s\S]*claude\|codex\)[\s\S]*\*\)[\s\S]*exit 1/,
    `${surface} must fail closed unless the selected literal is claude or codex`);
  assert.match(routingFence, /--runtime "\$ROUTING_RUNTIME"/,
    `${surface} must consume the asserted runtime in the same shell fence`);

  const otherFences = bashFences(block).filter((fence) => fence !== routingFence);
  assert.ok(otherFences.every((fence) => runtimeAssignments(fence).length === 0),
    `${surface} must not assign runtime in a separate shell fence`);
}

test('production routing calls assert the current host runtime explicitly', () => {
  const orchestrator = routingCallWindow(
    read('skills/deep-work-orchestrator/SKILL.md'),
    '**2단계 — methodology-authority routing facade:**',
  );
  const research = routingCallWindow(
    read('skills/deep-research/SKILL.md'),
    '3. 성공한 authoritative class로 재라우팅한다.',
  );

  assertCurrentHostRuntimeWiring(orchestrator, 'orchestrator initial routing');
  assertCurrentHostRuntimeWiring(research, 'research authoritative reroute');
  assert.match(research, /persisted[^\n]*runtime[^\n]*(?:재사용|reuse)[^\n]*(?:금지|않)/i,
    'authoritative reroute must refresh the current host instead of reusing persisted runtime');
});

test('runtime wiring contract rejects unsafe executable and prose-only shapes', () => {
  const prefix = [
    'Agent tool available maps to claude.',
    'Agent tool unavailable maps to codex.',
  ].join('\n');
  const call = 'MR_OUT=$(node "${CLAUDE_PLUGIN_ROOT}/scripts/model-routing-cli.js" --runtime "$ROUTING_RUNTIME")';
  const guard = 'case "$ROUTING_RUNTIME" in\n  claude|codex) ;;\n  *) exit 1 ;;\nesac';
  const splice = String.fromCharCode(92) + '\n';

  assert.throws(() => assertCurrentHostRuntimeWiring(`${prefix}\n\`\`\`bash\nROUTING_RUNTIME="claude"\nROUTING_RUNTIME="codex"\n${call}\n\`\`\``, 'dual assignment'));
  assert.throws(() => assertCurrentHostRuntimeWiring(`${prefix}\n\`\`\`bash\nROUTING_RUNTIME="<current host: claude or codex>"\ncase "$ROUTING_RUNTIME" in\n  claude|codex) ;;\n  *) exit 1 ;;\nesac\n  ROUTING_RUNTIME="codex"\n${call}\n\`\`\``, 'indented dual assignment'));
  assert.throws(() => assertCurrentHostRuntimeWiring(`${prefix}\n\`\`\`bash\nROUTING_RUNTIME="<current host: claude or codex>"\ncase "$ROUTING_RUNTIME" in\n  claude|codex) ;;\n  *) exit 1 ;;\nesac\ntrue | ROUTING_RUNTIME="codex"\n${call}\n\`\`\``, 'pipe-prefixed dual assignment'));
  assert.throws(() => assertCurrentHostRuntimeWiring(`${prefix}\n\`\`\`bash\nROUTING_RUNTIME="<current host: claude or codex>"\ncase "$ROUTING_RUNTIME" in\n  claude|codex) ;;\n  *) exit 1 ;;\nesac\ntrue & ROUTING_RUNTIME="codex"\n${call}\n\`\`\``, 'background-prefixed dual assignment'));
  assert.throws(() => assertCurrentHostRuntimeWiring(`${prefix}\n\`\`\`bash\nROUTING_RUNTIME="<current host: claude or codex>"\n${guard}\nROUTING_${splice}RUNTIME="codex"\n${call}\n\`\`\``, 'spliced-name dual assignment'));
  assert.doesNotThrow(() => assertCurrentHostRuntimeWiring(`${prefix}\n\`\`\`bash\nROUTING_RUNTIME="<current host: claude or codex>"\n${guard}\ntrue ${splice}ROUTING_RUNTIME="codex"\n${call}\n\`\`\``, 'continued argument'));
  assert.throws(() => assertCurrentHostRuntimeWiring(`${prefix}\n\`\`\`bash\nROUTING_RUNTIME="<current host: claude or codex>"\n\`\`\`\n\`\`\`bash\n${call}\n\`\`\``, 'separate fences'));
  assert.throws(() => assertCurrentHostRuntimeWiring(`${prefix}\n\`\`\`bash\n# ROUTING_RUNTIME="<current host: claude or codex>"\n${call}\n\`\`\``, 'comment-only assignment'));
});

test('model routing selects the matching Claude and Codex catalogs', () => {
  const route = (runtime) => JSON.parse(execFileSync(process.execPath, [
    'scripts/model-routing-cli.js',
    '--root', '.',
    '--task', 'runtime wiring contract probe',
    '--difficulty', 'medium',
    '--runtime', runtime,
  ], { cwd: ROOT, encoding: 'utf8' }));

  const claude = route('claude');
  const codex = route('codex');
  assert.equal(claude.meta.runtime, 'claude');
  assert.equal(claude.model_routing.research, 'sonnet');
  assert.equal(claude.model_routing.test, 'haiku');
  assert.equal(codex.meta.runtime, 'codex');
  assert.equal(codex.model_routing.research, 'gpt-5.6-terra');
  assert.equal(codex.model_routing.test, 'gpt-5.6-luna');
});

test('orchestrator init wires risk-only -> methodology authority -> routing facade', () => {
  const skill = read('skills/deep-work-orchestrator/SKILL.md');
  const riskOnly = skill.indexOf('--risk-only');
  const authority = skill.indexOf('methodology_authority', riskOnly + 1);
  const routing = skill.indexOf('--methodology-policy', authority + 1);
  const reusedPolicy = skill.indexOf('--reuse-input', routing + 1);

  assert.ok(riskOnly >= 0, 'provisional risk-only CLI argv must be documented');
  assert.ok(authority > riskOnly, 'policy authority must be compiled after risk');
  assert.ok(routing > authority, 'model routing must consume methodology authority');
  assert.ok(reusedPolicy > routing, 'policy snapshot must reuse the risk-only input last');
  assert.match(skill.slice(0, routing + 400), /risk-profile-cli\.js[\s\S]*--stage provisional[\s\S]*--risk-only/);
  assert.match(skill.slice(riskOnly, reusedPolicy), /model-routing-cli\.js[\s\S]*--methodology-policy/);
  assert.match(skill.slice(routing), /risk-profile-cli\.js[\s\S]*--stage provisional[\s\S]*--reuse-input/);
});

test('orchestrator persists canonical routing carriers and adaptive flag decisions', () => {
  const skill = read('skills/deep-work-orchestrator/SKILL.md');
  assert.match(skill, /model_routing_json[\s\S]*JSON\.stringify/);
  assert.match(skill, /model_routing_meta_json[\s\S]*JSON\.stringify/);
  assert.match(skill, /--policy[\s\S]*--risk[\s\S]*--review/);
  assert.match(skill, /risk_acceptances/);
  assert.match(skill, /floor_overridden_by_pin/);
  assert.match(skill, /(?:high|critical)[\s\S]*⚠️/);
});

test('deep-research uses state-file extraction and authoritative floor-aware rerouting', () => {
  const skill = read('skills/deep-research/SKILL.md');
  assert.match(skill, /risk-profile-cli\.js[\s\S]*--stage authoritative[\s\S]*--state-file "\$STATE_FILE"/);
  assert.match(skill, /methodology_authority[\s\S]*model-routing-cli\.js[\s\S]*--methodology-policy/);
  assert.match(skill, /methodology_policy_json[\s\S]*policy_sha256/);
  assert.match(skill, /risk_profile_json\.errors/);
  assert.match(skill, /유일한 state writer/);
  assert.doesNotMatch(skill, /스킬\(LLM\)이 직접 읽|미확정 후보 필드명|LLM 추출 절차/);
});

test('all eight routing readers use the shared scalar-first decode contract', () => {
  const readers = [
    'skills/deep-implement/SKILL.md',
    'skills/deep-status/SKILL.md',
    'skills/deep-resume/SKILL.md',
    'skills/deep-test/SKILL.md',
    'skills/deep-finish/SKILL.md',
    'skills/deep-research/SKILL.md',
    'skills/deep-report/SKILL.md',
    'skills/shared/references/implementation-guide.md',
  ];
  const directNestedAccess = /(?:state\.)?model_routing\.(?:research|implement|test)|model_routing_meta\.tiers|state\.model_routing_meta/;

  assert.match('model_routing.implement', directNestedAccess,
    'negative guard must catch bare model_routing.<phase> access');

  for (const reader of readers) {
    const body = read(reader);
    assert.match(body, /model-routing-guide\.md#model-routing-state-decode-v612/, `${reader} must reference the decode contract`);
    assert.doesNotMatch(body, directNestedAccess, `${reader} must not read nested routing state directly`);
  }

  const guide = read('skills/shared/references/model-routing-guide.md');
  assert.match(guide, /## Model routing state decode \(v6\.12\)/);
  assert.match(guide, /model_routing_json[\s\S]*model_routing_meta_json[\s\S]*JSON\.parse/);
  assert.match(guide, /부재[\s\S]*legacy nested[\s\S]*model_routing[\s\S]*model_routing_meta/);
});

test('slice routing and resume consume the new adaptive state', () => {
  const plan = read('skills/deep-plan/SKILL.md');
  const resume = read('skills/deep-resume/SKILL.md');
  assert.match(plan, /sliceModelTierWithRisk/);
  assert.match(plan, /slice_risk_shadow_json/);
  assert.match(resume, /methodology_policy_json[\s\S]*review_execution_json/);
  assert.match(resume, /신규 state 필드 복원/);
});
