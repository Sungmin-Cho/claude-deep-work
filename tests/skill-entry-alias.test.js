const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const skillPath = path.join(repoRoot, 'skills', 'deep-work', 'SKILL.md');
const commandPath = path.join(repoRoot, 'commands', 'deep-work.md');

test('deep-work skill alias is the primary skill-only entrypoint', () => {
  assert.equal(fs.existsSync(commandPath), false, 'commands/deep-work.md should not be required');

  const skill = fs.readFileSync(skillPath, 'utf8');
  assert.match(skill, /^name: deep-work$/m);
  assert.match(skill, /^user-invocable: true$/m);
  assert.match(skill, /Skill\("deep-work-orchestrator", args="\$ARGUMENTS"\)/);
});

test('deep-spec is a discoverable user-invocable skill entrypoint', () => {
  const skill = fs.readFileSync(path.join(repoRoot, 'skills', 'deep-spec', 'SKILL.md'), 'utf8');
  assert.match(skill, /^name: deep-spec$/m);
  assert.match(skill, /^user-invocable: true$/m);
  assert.match(skill, /\$deep-work:deep-spec/);
  assert.match(skill, /\/deep-spec/);
});
