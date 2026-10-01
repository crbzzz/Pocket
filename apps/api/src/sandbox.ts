import { Daytona, type Sandbox } from '@daytona/sdk';
import type { Checkpoint } from './artifacts.js';
import type { DiffFile } from './domain.js';
export interface CommandResult {
  exitCode: number;
  output: string;
}
export interface SandboxHandle {
  id: string;
  exec(command: string, timeoutSeconds: number): Promise<CommandResult>;
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string>;
  checkpoint(baseRef: string): Promise<Checkpoint & { files: DiffFile[] }>;
  restore(bundle: Buffer, commit: string): Promise<void>;
  destroy(): Promise<void>;
}
export interface SandboxProvider {
  create(jobId: string, repo: string, branch: string, readToken: string): Promise<SandboxHandle>;
}
export const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
export function safePath(path: string): string {
  if (
    !path ||
    path.startsWith('/') ||
    path.split('/').some((p) => p === '..' || p === '.git') ||
    path.includes('\0') ||
    path.length > 1000
  )
    throw new Error('Path must stay inside the repository');
  return path;
}
const maxOutput = 16000;
export const commandRunner = `import os,sys,time,json,subprocess,selectors,signal
p=subprocess.Popen(['/bin/sh','-c',sys.argv[1]],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,start_new_session=True)
s=selectors.DefaultSelector();s.register(p.stdout,selectors.EVENT_READ)
data=bytearray(); deadline=time.monotonic()+int(sys.argv[2]); reason=''
while True:
 if time.monotonic()>deadline: reason='Command timeout reached'; break
 ready=s.select(.2)
 if ready:
  part=os.read(p.stdout.fileno(),4096)
  if not part: break
  data.extend(part)
  if len(data)>16000: reason='Maximum terminal output reached'; break
 elif p.poll() is not None: break
if reason:
 try: os.killpg(p.pid,signal.SIGKILL)
 except ProcessLookupError: pass
try: p.wait(timeout=max(.1,deadline-time.monotonic()))
except subprocess.TimeoutExpired:
 reason='Command timeout reached'
 try: os.killpg(p.pid,signal.SIGKILL)
 except ProcessLookupError: pass
 p.wait()
print(json.dumps({'exitCode':p.returncode if not reason else 137,'output':data[:16000].decode(errors='replace')+('\\n'+reason if reason else '')}))`;
export class DaytonaProvider implements SandboxProvider {
  private client = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
  async create(
    jobId: string,
    repo: string,
    branch: string,
    readToken: string,
  ): Promise<SandboxHandle> {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Invalid repository');
    const sandbox = await this.client.create(
      {
        snapshot: process.env.DAYTONA_SNAPSHOT,
        language: 'typescript',
        ephemeral: true,
        autoStopInterval: 2,
        autoDeleteInterval: 0,
        ttlMinutes: 20,
        public: false,
        labels: { pocketJob: jobId },
      },
      { timeout: 90 },
    );
    try {
      const home = await sandbox.getUserHomeDir();
      if (!home || !home.startsWith('/')) throw new Error('Sandbox home is unavailable');
      const root = `${home}/pocket-repo`;
      await sandbox.git.clone(
        `https://github.com/${repo}.git`,
        root,
        branch,
        undefined,
        'x-access-token',
        readToken,
      );
      const handle = new DaytonaHandle(sandbox, root);
      const sanitized = await handle.exec(
        `git remote set-url origin ${quote(`https://github.com/${repo}.git`)} && (git config --unset-all credential.helper || true)`,
        10,
      );
      if (sanitized.exitCode !== 0) throw new Error('Could not sanitize Git credentials');
      return handle;
    } catch (e) {
      await sandbox.delete().catch(() => {});
      throw e;
    }
  }
}
export class DaytonaHandle implements SandboxHandle {
  readonly id: string;
  constructor(
    private sandbox: Sandbox,
    private root: string,
  ) {
    this.id = sandbox.id;
  }
  async exec(command: string, timeout: number) {
    const seconds = Math.min(timeout, 120);
    const r = await this.sandbox.process.executeCommand(
      `python3 -I -c ${quote(commandRunner)} ${quote(command)} ${seconds}`,
      this.root,
      {},
      seconds + 5,
    );
    if (r.exitCode !== 0) throw new Error('Sandbox command runner failed');
    const parsed = JSON.parse(r.result) as CommandResult;
    return { exitCode: parsed.exitCode, output: parsed.output.slice(0, maxOutput + 100) };
  }
  // Resolve symlinks server-side before file IO; reject paths escaping the repository.
  private async path(path: string): Promise<string> {
    safePath(path);
    const r = await this.exec(
      `python3 -I -c ${quote('import os,sys; p=os.path.realpath(sys.argv[1]); r=os.path.realpath("."); assert p.startswith(r+"/"), "Path escapes repository"; assert "/.git/" not in p; print(p)')} ${quote(path)}`,
      10,
    );
    if (r.exitCode !== 0) throw new Error('Path escapes repository');
    return r.output.trim();
  }
  async write(path: string, content: string) {
    const target = await this.path(path);
    await this.exec(`mkdir -p ${quote(target.slice(0, target.lastIndexOf('/')))}`, 10);
    await this.sandbox.fs.uploadFile(Buffer.from(content), target);
  }
  async read(path: string) {
    const target = await this.path(path);
    const listing = await this.exec(
      `python3 -I -c ${quote('import os,sys,json; p=sys.argv[1]; print(json.dumps({"directory":True,"entries":[n+("/" if os.path.isdir(os.path.join(p,n)) else "") for n in sorted(os.listdir(p)) if n!=".git"][:100]})) if os.path.isdir(p) else print("FILE")')} ${quote(target)}`,
      10,
    );
    if (listing.exitCode !== 0) throw new Error('Path unavailable; search for an existing file');
    if (listing.output.trim() !== 'FILE') return listing.output;
    const size = await this.exec(
      `python3 -I -c ${quote('import os,sys; assert os.path.getsize(sys.argv[1])<=100000, "File too large"')} ${quote(target)}`,
      10,
    );
    if (size.exitCode !== 0) throw new Error('File is too large; search relevant sections instead');
    const result = await this.sandbox.fs.downloadFile(target);
    if (result.length > 100000)
      throw new Error('File is too large; search relevant sections instead');
    return result.toString('utf8');
  }
  async restore(bundle: Buffer, commit: string) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid checkpoint commit');
    await this.sandbox.fs.uploadFile(bundle, '/tmp/pocket-restore.bundle');
    const r = await this.exec(
      `git -c core.hooksPath=/dev/null fetch /tmp/pocket-restore.bundle 'refs/heads/*:refs/remotes/pocket/*' && git -c core.hooksPath=/dev/null checkout --detach ${commit}`,
      30,
    );
    if (r.exitCode !== 0) throw new Error('Checkpoint restoration failed');
  }
  async checkpoint(baseRef: string): Promise<Checkpoint & { files: DiffFile[] }> {
    if (!/^[a-f0-9]{40}$/.test(baseRef)) throw new Error('Invalid Git base');
    const committed = await this.exec(
      `git -c core.hooksPath=/dev/null -c user.name=Pocket -c user.email=agent@pocket.local add -A && git -c core.hooksPath=/dev/null -c user.name=Pocket -c user.email=agent@pocket.local commit --allow-empty -m 'Pocket Save' && git branch -f pocket-save HEAD && git bundle create /tmp/pocket-save.bundle ${baseRef}..pocket-save`,
      30,
    );
    if (committed.exitCode !== 0) throw new Error('Could not create Git Save');
    const script = `import subprocess,json,base64,os,sys
base=sys.argv[1]
def git(*args): return subprocess.check_output(['git','-c','core.hooksPath=/dev/null',*args])
commit=git('rev-parse','HEAD').decode().strip()
paths=git('diff','--name-only','-z','--no-renames',base,commit).split(b'\\0')
files=[]; changes=[]
for raw in paths:
 if not raw: continue
 p=raw.decode(); patch=git('diff','--no-ext-diff','--no-textconv','--no-renames',base,commit,'--',p).decode(errors='replace')
 stat=git('diff','--numstat','--no-renames',base,commit,'--',p).decode().split('\\t')
 files.append({'path':p,'additions':int(stat[0]) if stat[0].isdigit() else 0,'deletions':int(stat[1]) if stat[1].isdigit() else 0,'patch':patch[:100000]})
 try:
  if int(git('cat-file','-s',commit+':'+p))>1000000: raise RuntimeError('Changed file exceeds 1 MB')
  data=git('show',commit+':'+p); mode=git('ls-tree',commit,'--',p).decode().split()[0]
  if len(data)>1000000: raise RuntimeError('Changed file exceeds 1 MB')
  if mode not in ['100644','100755','120000']: raise RuntimeError('Unsupported Git entry')
  changes.append({'path':p,'content':base64.b64encode(data).decode(),'mode':mode})
 except subprocess.CalledProcessError: changes.append({'path':p,'content':None})
 if len(files)>200: raise RuntimeError('Too many changed files')
print(json.dumps({'commit':commit,'baseRef':base,'files':files,'changes':changes}))`;
    await this.sandbox.fs.uploadFile(Buffer.from(script), '/tmp/pocket-manifest.py');
    const r = await this.exec(
      `python3 -I /tmp/pocket-manifest.py ${baseRef} > /tmp/pocket-manifest.json`,
      30,
    );
    if (r.exitCode !== 0) throw new Error('Could not capture changed files');
    const manifest = await this.sandbox.fs.downloadFile('/tmp/pocket-manifest.json');
    if (manifest.length > 8000000) throw new Error('Diff exceeds review limit');
    const d = JSON.parse(manifest.toString());
    const bundle = await this.sandbox.fs.downloadFile('/tmp/pocket-save.bundle');
    if (bundle.length > 20 * 1024 * 1024) throw new Error('Git Save exceeds 20 MB');
    return { ...d, bundle };
  }
  async destroy() {
    await this.sandbox.delete(30, true);
  }
}
