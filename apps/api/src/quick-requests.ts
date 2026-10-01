export type QuickRequest =
  { kind: 'files' | 'count' | 'branch' | 'info' } | { kind: 'read'; path: string };
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, '')
    .trim();
export function quickRequest(prompt: string): QuickRequest | undefined {
  const p = normalize(prompt);
  if (
    /^(?:is there (?:any )?files? in (?:this |the )?(?:repo|repository)|are there (?:any )?files? in (?:this |the )?(?:repo|repository)|(?:is|est ce que) (?:this |the |ce |le )?(?:repo|repository|depot) (?:empty|vide)|(?:y a t il|y'a|il y a|est ce qu'il y a|est-ce qu'il y a) (?:des )?fichiers(?: dans (?:ce |le )?(?:repo|depot))?|(?:list|show|liste|montre)(?: me| moi|-moi)? (?:the |les )?(?:repo |repository )?files|liste (?:les )?fichiers(?: du (?:repo|depot))?|what files are in (?:this |the )?(?:repo|repository))$/.test(
      p,
    )
  )
    return { kind: 'files' };
  if (
    /^(?:how many files(?: are there)?(?: in (?:this |the )?(?:repo|repository))?|combien (?:de )?fichiers(?: (?:dans|a|contient) (?:ce |le )?(?:repo|depot))?)$/.test(
      p,
    )
  )
    return { kind: 'count' };
  if (
    /^(?:what(?: is|'s) (?:the |my |current )?branch|quelle (?:est la )?branche(?: actuelle)?|current branch|branche actuelle)$/.test(
      p,
    )
  )
    return { kind: 'branch' };
  if (
    /^(?:repo(?:sitory)? info|infos? (?:du |sur le )?(?:repo|depot)|repository metadata)$/.test(p)
  )
    return { kind: 'info' };
  const read = prompt
    .trim()
    .match(
      /^(?:read|show|open|lis|lire|affiche|montre)(?: me| moi|-moi)?\s+`?([\w./-]+\.[\w-]+)`?\s*[?.!]?$/i,
    );
  if (
    read &&
    !read[1]!.split('/').some((p) => p === '..' || p === '.git') &&
    !read[1]!.startsWith('/')
  )
    return { kind: 'read', path: read[1]! };
}
export function clearIntent(prompt: string): 'analysis' | 'change' | undefined {
  if (quickRequest(prompt)) return 'analysis';
  const p = normalize(prompt);
  if (
    /^(?:write|create|give|provide)(?: me)? (?:a |an |the )?(?:summary|explanation|analysis|plan|report|code example)\b/.test(
      p,
    )
  )
    return 'analysis';
  if (
    /^(?:implement|fix|add|create|write|update|remove|delete|refactor|change|build|corrige|ajoute|cree|implemente|modifie|supprime|remplace|refactorise|developpe|ameliore)\b/.test(
      p,
    )
  )
    return 'change';
  if (
    /^(?:summarize|explain|describe|review|audit|resume|resumer|explique|decris|analyse|analyser|fais(?:-| )moi un resume|fais un resume)\b/.test(
      p,
    ) &&
    !/\b(?:then|puis|ensuite|and|et)\s+(?:fix|change|rewrite|implement|update|corrige|modifie|reecris|implemente|ajoute)\b/.test(
      p,
    )
  )
    return 'analysis';
}
