import { createSign } from 'node:crypto';
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
export class GitHubApp implements GitProvider {
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
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new DomainError(r.status === 404 ? 404 : 502, `GitHub returned ${r.status}`);
    return r.json();
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
  async verifyInstallation(userToken: string, installationId: number): Promise<void> {
    // Verify the installation belongs to the user's authenticated GitHub account.
    const d = await this.request('/user/installations?per_page=100', userToken);
    if (!d.installations.some((i: any) => i.id === installationId))
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
