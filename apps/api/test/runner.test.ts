import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { commandRunner } from '../src/sandbox.js';
function run(command: string, seconds = 2) {
  const result = spawnSync('python3', ['-I', '-c', commandRunner, command, String(seconds)], {
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test('command runner preserves exit status and combined output', () => {
  const result = run("printf 'hello'; printf 'error' >&2; exit 7");
  assert.equal(result.exitCode, 7);
  assert.equal(result.output, 'helloerror');
});
test('command runner stops output flooding rather than buffering it', () => {
  const result = run('yes output');
  assert.equal(result.exitCode, 137);
  assert.match(result.output, /Maximum terminal output reached/);
  assert.ok(result.output.length < 16100);
});
test('command runner enforces timeout even when command closes stdout', () => {
  const start = Date.now();
  const result = run('exec >/dev/null 2>&1; sleep 10', 1);
  assert.equal(result.exitCode, 137);
  assert.match(result.output, /Command timeout reached/);
  assert.ok(Date.now() - start < 4000);
});
