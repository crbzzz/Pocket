import type { SQL } from './sql.js';
import type { QuickRequest } from './quick-requests.js';
import type { Project } from './domain.js';
import { safePath } from './sandbox.js';
export interface RepositoryIndex {
  commit: string;
  paths: string[];
  truncated: boolean;
}
export interface RepositoryReader {
  index: RepositoryIndex;
  list(path: string, limit?: number): string;
  read(path: string): Promise<string>;
  search(query: string): Promise<string>;
}
export interface RepositoryReaderProvider {
  open(
    project: Project & { installationId: number; repositoryId: number },
    branch: string,
    db: SQL,
    options?: { index?: boolean },
  ): Promise<RepositoryReader>;
}
export function quickAnswer(
  request: QuickRequest,
  repo: RepositoryReader,
  project: Project,
  branch: string,
): Promise<string> | string {
  // Locale is applied by the caller; these helpers return verified facts, never model guesses.
  if (request.kind === 'read')
    return repo
      .read(request.path)
      .then(
        (text) =>
          `### ${request.path}\n\n\`\`\`${request.path.endsWith('.json') ? 'json' : ''}\n${text.slice(0, 10000)}\n\`\`\`${text.length > 10000 ? '\n\nExcerpt limited to 10,000 characters.' : ''}`,
      );
  if (request.kind === 'branch') return `Current branch: **${branch}**.`;
  if (request.kind === 'info')
    return `**${project.owner}/${project.name}**\n\n${project.description}\n\n- Branch: \`${branch}\`\n- Language: ${project.language || 'Not detected'}`;
  const paths = repo.index.paths;
  if (request.kind === 'count')
    return `${repo.index.truncated ? 'At least ' : ''}**${paths.length} files** on \`${branch}\`.`;
  if (!paths.length) return `This repository has no files on \`${branch}\`.`;
  return `This repository contains ${repo.index.truncated ? 'at least ' : ''}**${paths.length} files** on \`${branch}\`.\n\n${paths
    .slice(0, 15)
    .map((p) => `- \`${p}\``)
    .join('\n')}${paths.length > 15 ? '\n\nShowing the first 15 files.' : ''}`;
}
export function localizeQuickAnswer(answer: string, prompt: string): string {
  if (!/[éèà]|\b(?:fichiers|branche|infos|lis|montre|liste|combien|vide)\b/i.test(prompt))
    return answer;
  return answer
    .replace('Current branch:', 'Branche actuelle :')
    .replace('This repository has no files on', 'Ce dépôt ne contient aucun fichier sur')
    .replace('This repository contains', 'Ce dépôt contient')
    .replaceAll('at least ', 'au moins ')
    .replace('At least ', 'Au moins ')
    .replaceAll('files', 'fichiers')
    .replaceAll(' on ', ' sur ')
    .replace('Showing the first 15 fichiers.', 'Les 15 premiers fichiers sont affichés.')
    .replace('Branch:', 'Branche :')
    .replace('Language:', 'Langage :')
    .replace('Files:', 'Fichiers :')
    .replace('Not detected', 'Non détecté')
    .replace('Excerpt limited to 10,000 characters.', 'Extrait limité à 10 000 caractères.');
}
