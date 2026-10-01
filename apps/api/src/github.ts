import { createSign } from 'node:crypto';
import { safePath } from './sandbox.js';
import type { SQL } from './sql.js';
import type {
  RepositoryReaderProvider,
  RepositoryReader,
  RepositoryIndex,
} from './repository-reader.js';
import type { Project } from './domain.js';
import { DomainError } from './domain.js';
export interface Repo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  default_branch: string;
  owner: { login: string };
}
export interface Change {
  path: string;
  content: string | null;
  mode?: '100644' | '100755' | '120000';
}
export interface GitProvider {
  readToken(installationId: number, repositoryId: number): Promise<string>;
  repositories(installationId: number): Promise<Repo[]>;
  branches(installationId: number, repositoryId: number, fullName: string): Promise<string[]>;
  ship(
    installationId: number,
    repositoryId: number,
    fullName: string,
    base: string,
    baseRef: string,
    branch: string,
    changes: Change[],
    title: string,
    createPR: boolean,
  ): Promise<{ commit: string; branch: string; url?: string }>;
}
export class GitHubApp implements GitProvider, RepositoryReaderProvider {
  private jwt(): string {
    const id = process.env.GITHUB_APP_ID;
    const key = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
    if (!id || !key) throw new DomainError(503, 'GitHub App is not configured');
    const now = Math.floor(Date.now() / 1000);
    const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const input = `${b({ alg: 'RS256', typ: 'JWT' })}.${b({ iat: now - 60, exp: now + 540, iss: id })}`;
    return `${input}.${createSign('RSA-SHA256').update(input).sign(key, 'base64url')}`;
  }
  private async request(path: string, token: string, body?: unknown): Promise<any> {
    const r = await fetch(`https://api.github.com${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Pocket/0.1',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new DomainError(r.status === 404 ? 404 : 502, `GitHub returned ${r.status}`);
    return r.json();
  }
  async open(
    project: Project & { installationId: number; repositoryId: number },
    branch: string,
    db: SQL,
    options: { index?: boolean } = {},
  ): Promise<RepositoryReader> {
    const token = await this.readToken(project.installationId, project.repositoryId);
    const prefix = `/repos/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.name)}`;
    let head: any;
    try {
      head = await this.request(`${prefix}/commits/${encodeURIComponent(branch)}`, token);
    } catch (e) {
      if (e instanceof DomainError && e.message === 'GitHub returned 409')
        return {
          index: { commit: '', paths: [], truncated: false },
          list: () => '',
          read: async () => {
            throw new DomainError(404, 'File not found');
          },
          search: async () => '',
        };
      throw e;
    }
    const cached = (
      await db.query("SELECT data->'repositoryIndex' AS cache FROM projects WHERE id=$1", [
        project.id,
      ])
    ).rows[0]?.cache as (RepositoryIndex & { branch: string }) | undefined;
    let index: RepositoryIndex;
    if (cached && cached.commit === head.sha && cached.branch === branch) index = cached;
    else if (options.index === false) index = { commit: head.sha, paths: [], truncated: true };
    else {
      const tree = await this.request(
        `${prefix}/git/trees/${head.commit.tree.sha}?recursive=1`,
        token,
      );
      const all = tree.tree.filter((n: any) => n.type === 'blob').map((n: any) => n.path as string);
      index = {
        commit: head.sha,
        paths: all.slice(0, 5000),
        truncated: tree.truncated || all.length > 5000,
      };
      await db.query(
        "UPDATE projects SET data=jsonb_set(data,'{repositoryIndex}',$2::jsonb) WHERE id=$1",
        [project.id, JSON.stringify({ ...index, branch })],
      );
    }
    const files = new Map<string, Promise<string>>();
    const read = (path: string): Promise<string> => {
      safePath(path);
      if (files.has(path)) return files.get(path)!;
      const promise = (async () => {
        if (
          !index.paths.includes(path) &&
          index.paths.some((p) => p.startsWith(path.replace(/\/$/, '') + '/'))
        )
          return JSON.stringify({
            directory: true,
            entries: index.paths
              .filter((p) => p.startsWith(path.replace(/\/$/, '') + '/'))
              .slice(0, 80),
          });
        const data = await this.request(
          `${prefix}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${index.commit}`,
          token,
        );
        if (Array.isArray(data))
          return JSON.stringify({
            directory: true,
            entries: data.slice(0, 80).map((n) => n.name + (n.type === 'dir' ? '/' : '')),
          });
        if (data.type !== 'file' || data.size > 100000 || data.encoding !== 'base64')
          throw new DomainError(
            400,
            'File is unavailable or too large; read a relevant smaller file',
          );
        return Buffer.from(data.content, 'base64').toString('utf8');
      })();
      files.set(path, promise);
      return promise;
    };
    return {
      index,
      list: (path, limit = 80) => {
        safePath(path);
        const prefix = path === '.' ? '' : path.replace(/\/$/, '') + '/';
        return index.paths
          .filter((p) => !prefix || p === path || p.startsWith(prefix))
          .slice(0, limit)
          .join('\n');
      },
      read,
      search: async (query) => {
        const candidates = index.paths
          .filter((p) => p.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 40);
        if (candidates.length) return candidates.join('\n');
        const paths = index.paths
          .filter((p) => /\.(?:md|json|ts|tsx|js|jsx|swift|py|rs|go|yml|yaml|css|html)$/.test(p))
          .slice(0, 10);
        const results = await Promise.all(
          paths.map(async (p) => {
            try {
              return (await read(p))
                .split('\n')
                .flatMap((line, n) =>
                  line.includes(query) ? [`${p}:${n + 1}:${line.slice(0, 300)}`] : [],
                )
                .slice(0, 8)
                .join('\n');
            } catch {
              return '';
            }
          }),
        );
        return (
          results.filter(Boolean).join('\n') ||
          'No matches in the sampled files. Use the path listing to read relevant files.'
        );
      },
    };
  }
  async assertUserAccess(token: string, name: string): Promise<void> {
    await this.request(`/repos/${name}`, token);
  }
  private async token(
    installationId: number,
    repositoryId: number | undefined,
    write = false,
  ): Promise<string> {
    const result = await this.request(
      `/app/installations/${installationId}/access_tokens`,
      this.jwt(),
      {
        ...(repositoryId ? { repository_ids: [repositoryId] } : {}),
        permissions: {
          contents: write ? 'write' : 'read',
          ...(write ? { pull_requests: 'write' } : {}),
        },
      },
    );
    return result.token;
  }
  async readToken(i: number, r: number) {
    return this.token(i, r);
  }
  async repositories(i: number): Promise<Repo[]> {
    const token = await this.token(i, undefined);
    const repos: Repo[] = [];
    for (let page = 1; page <= 20; page++) {
      const d = await this.request(`/installation/repositories?per_page=100&page=${page}`, token);
      repos.push(...d.repositories);
      if (d.repositories.length < 100) break;
    }
    return repos;
  }
  async branches(i: number, r: number, name: string): Promise<string[]> {
    const token = await this.token(i, r);
    const result: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const rows = await this.request(`/repos/${name}/branches?per_page=100&page=${page}`, token);
      result.push(...rows.map((b: any) => b.name));
      if (rows.length < 100) break;
    }
    return result;
  }
  async repositoriesForUser(userToken: string, installationId: number): Promise<Repo[]> {
    const repos: Repo[] = [];
    for (let page = 1; page <= 20; page++) {
      const d = await this.request(
        `/user/installations/${installationId}/repositories?per_page=100&page=${page}`,
        userToken,
      );
      repos.push(...d.repositories);
      if (d.repositories.length < 100) break;
    }
    return repos;
  }
  async installationsForAccount(githubId: string): Promise<{ id: number; account: string }[]> {
    const result: { id: number; account: string }[] = [];
    for (let page = 1; page <= 20; page++) {
      const rows = await this.request(`/app/installations?per_page=100&page=${page}`, this.jwt());
      for (const installation of rows) {
        if (
          installation.target_type === 'User' &&
          String(installation.account.id) === githubId &&
          !installation.suspended_at
        )
          result.push({ id: installation.id, account: installation.account.login });
      }
      if (rows.length < 100) return result;
    }
    throw new DomainError(422, 'Too many installations to sync safely');
  }
  async isAccountInstallation(githubId: string, installationId: number): Promise<boolean> {
    try {
      const installation = await this.request(`/app/installations/${installationId}`, this.jwt());
      return (
        installation.target_type === 'User' &&
        String(installation.account.id) === githubId &&
        !installation.suspended_at
      );
    } catch (error) {
      if (error instanceof DomainError && error.statusCode === 404) return false;
      throw error;
    }
  }
  async installationsForUser(userToken: string): Promise<{ id: number; account: string }[]> {
    const appId = Number(process.env.GITHUB_APP_ID);
    if (!Number.isSafeInteger(appId) || appId <= 0)
      throw new DomainError(503, 'GitHub App is not configured');
    const installations: { id: number; account: string }[] = [];
    for (let page = 1; page <= 20; page++) {
      const data = await this.request(`/user/installations?per_page=100&page=${page}`, userToken);
      for (const installation of data.installations) {
        if (installation.app_id === appId && !installation.suspended_at)
          installations.push({ id: installation.id, account: installation.account.login });
      }
      if (data.installations.length < 100) return installations;
    }
    throw new DomainError(422, 'Too many GitHub installations to sync safely');
  }
  async verifyInstallation(userToken: string, installationId: number): Promise<void> {
    const installations = await this.installationsForUser(userToken);
    if (!installations.some((installation) => installation.id === installationId))
      throw new DomainError(403, 'GitHub installation is not authorized for this account');
  }
  async ship(
    i: number,
    r: number,
    name: string,
    base: string,
    baseRef: string,
    branch: string,
    changes: Change[],
    title: string,
    createPR: boolean,
  ) {
    const token = await this.token(i, r, true);
    const prefix = `/repos/${name}`;
    const current = await this.request(
      `${prefix}/git/ref/heads/${encodeURIComponent(base)}`,
      token,
    );
    if (current.object.sha !== baseRef)
      throw new DomainError(409, 'The base branch moved. Run a new task before shipping.');
    const commit = await this.request(`${prefix}/git/commits/${baseRef}`, token);
    const tree = [];
    for (const file of changes) {
      if (file.content === null)
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      else {
        const blob = await this.request(`${prefix}/git/blobs`, token, {
          content: file.content,
          encoding: 'base64',
        });
        tree.push({ path: file.path, mode: file.mode ?? '100644', type: 'blob', sha: blob.sha });
      }
    }
    const resultTree = await this.request(`${prefix}/git/trees`, token, {
      base_tree: commit.tree.sha,
      tree,
    });
    const resultCommit = await this.request(`${prefix}/git/commits`, token, {
      message: title,
      tree: resultTree.sha,
      parents: [baseRef],
    });
    await this.request(`${prefix}/git/refs`, token, {
      ref: `refs/heads/${branch}`,
      sha: resultCommit.sha,
    });
    if (!createPR) return { commit: resultCommit.sha, branch };
    const pr = await this.request(`${prefix}/pulls`, token, {
      title,
      head: branch,
      base,
      body: 'Created with Pocket. Review the changes and checks before merging.',
    });
    return { commit: resultCommit.sha, branch, url: pr.html_url };
  }
}
