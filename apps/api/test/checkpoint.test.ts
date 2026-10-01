import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Sandbox } from '@daytona/sdk';
import { DaytonaHandle } from '../src/sandbox.js';
// Exercise the provider's real Git/Python commands against a disposable fixture,
// through the SDK boundary; no repository or cloud account is contacted.
test('Git Saves preserve edits, deletes, untracked files and restore after sandbox disposal', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'pocket-save-test-'));
  const root = join(temp, 'repo');
  const artifacts = join(temp, 'artifacts');
  await mkdir(root);
  await mkdir(artifacts);
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const map = (path: string) => (path.startsWith('/tmp/') ? join(artifacts, path.slice(5)) : path);
  const sdk = {
    id: 'local-test-boundary',
    process: {
      executeCommand: async (command: string, cwd: string) => ({
        exitCode: 0,
        result: execFileSync(
          '/bin/sh',
          ['-c', command.replaceAll('/tmp/pocket-', `${artifacts}/pocket-`)],
          { cwd, encoding: 'utf8', timeout: 10000 },
        ),
      }),
    },
    fs: {
      uploadFile: async (data: Buffer, path: string) => {
        await writeFile(map(path), data);
      },
      downloadFile: async (path: string) => readFile(map(path)),
    },
  } as unknown as Sandbox;
  try {
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@pocket.local');
    git('config', 'user.name', 'Pocket Test');
    await writeFile(join(root, 'app.ts'), 'const value = 1;\n');
    await writeFile(join(root, 'remove.txt'), 'old\n');
    git('add', '.');
    git('commit', '-m', 'Base');
    const base = git('rev-parse', 'HEAD');
    const handle = new DaytonaHandle(sdk, root);
    await handle.write('app.ts', 'const value = 2;\n');
    await writeFile(join(root, 'new.ts'), 'export const created = true;\n');
    await rm(join(root, 'remove.txt'));
    await mkdir(join(root, '.agents/rules'), { recursive: true });
    await writeFile(join(root, '.agents/rules/project.md'), 'Project rules');
    const directory = await handle.read('.agents/rules');
    assert.equal(JSON.parse(directory).directory, true);
    assert.deepEqual(JSON.parse(directory).entries, ['project.md']);
    assert.equal(await handle.read('.agents/rules/project.md'), 'Project rules');
    await rm(join(root, '.agents'), { recursive: true });
    const save = await handle.checkpoint(base);
    assert.equal(save.files.length, 3);
    assert.match(save.files.find((f) => f.path === 'app.ts')!.patch, /\+const value = 2/);
    assert.equal(save.changes.find((c) => c.path === 'remove.txt')!.content, null);
    assert.equal(save.baseRef, base);
    git('checkout', '-f', base);
    git('branch', '-D', 'pocket-save');
    git('branch', '-f', 'main', base);
    git('reflog', 'expire', '--expire=now', '--all');
    git('gc', '--prune=now');
    assert.throws(() => git('cat-file', '-e', save.commit));
    assert.equal(await readFile(join(root, 'app.ts'), 'utf8'), 'const value = 1;\n');
    await handle.restore(save.bundle, save.commit);
    assert.equal(await handle.read('app.ts'), 'const value = 2;\n');
    assert.equal(await readFile(join(root, 'new.ts'), 'utf8'), 'export const created = true;\n');
    await symlink('/etc/passwd', join(root, 'escape'));
    await assert.rejects(() => handle.read('escape'), /escapes repository/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
