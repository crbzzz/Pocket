'use strict';
const paths = {
  projects:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9H13a8.5 8.5 0 0 1 8 8v.5Z"/>',
  changes:
    '<path d="M8 3v12a5 5 0 0 0 5 5h3M16 4v7"/><circle cx="8" cy="3" r="2"/><circle cx="16" cy="3" r="2"/><circle cx="18" cy="20" r="2"/><path d="m13 8 3 3 3-3"/>',
  saves:
    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/>',
  agents: '<path d="m13 2-3 8H4l7 12 3-8h6L13 2Z"/>',
  settings:
    '<path d="M12 3 14 5l3-.2.9 2.8L20 10l-1 2.5.6 3-2.5 1.7-1 2.8-3-.1-2.5 1.1-2-2.3-3-.6-.4-3-1.8-2.4 1.4-2.6.1-3 2.9-1.1L9 3.5Z"/><circle cx="12" cy="12" r="3"/>',
  branch:
    '<circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 6v12M6 14c6 0 12-2 12-6"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="M12 19V5m-5 5 5-5 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m8 12 3 3 5-6"/>',
  leaf: '<path d="M20 3C6 2 2 7 5 14c3 7 14 6 15-11Z"/><path d="M4 21 16 7"/>',
  butterfly:
    '<path d="M12 12C9 4 2 2 3 9c.3 3 3 4 6 4-6 0-7 6-3 7 3 0 5-4 6-7m0-1c3-8 10-10 9-3-.3 3-3 4-6 4 6 0 7 6 3 7-3 0-5-4-6-7Z"/><path d="M12 9v9m0-9-2-3m2 3 2-3"/>',
  atlas: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5 5-3Z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  memory: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9h6M9 12h6M9 15h3"/>',
  github:
    '<path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-1.5-.5-2 3.5-.4 7-1.7 7-7 0-1.5-.5-2.7-1.5-3.7.2-.4.7-1.8-.1-3.3 0 0-1.2-.4-3.9 1.5a13 13 0 0 0-7 0C6.8 1.6 5.6 2 5.6 2c-.8 1.5-.3 2.9-.1 3.3A5.2 5.2 0 0 0 4 9c0 5.3 3.5 6.6 7 7-.5.5-.7 1.2-.7 2v4"/>',
  external:
    '<path d="M15 3h6v6m0-6L10 14M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const state = {
  projects: [],
  jobs: [],
  models: [],
  saves: [],
  view: 'projects',
  projectId: localStorage.getItem('pocket.project'),
  jobId: null,
  modelId: 'auto',
  draft: '',
  filter: '',
  loading: false,
};
const content = document.querySelector('#content');
async function api(path, body, key) {
  const response = await fetch(`/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: 'Bearer pocket-local-demo',
      ...(body
        ? { 'Content-Type': 'application/json', 'Idempotency-Key': key || crypto.randomUUID() }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || 'Request failed');
  return result;
}
const project = () => state.projects.find((p) => p.id === state.projectId) || state.projects[0];
const jobs = () =>
  state.jobs.filter((j) => j.projectId === project()?.id && j.branch === project()?.branch);
const currentJob = () => jobs().find((j) => j.id === state.jobId) || jobs()[0];
const active = (j) => j && !['completed', 'failed', 'cancelled'].includes(j.status);
const relative = (d) => {
  const m = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60000));
  return m < 1
    ? 'Just now'
    : m < 60
      ? `${m}m ago`
      : m < 1440
        ? `${Math.floor(m / 60)}h ago`
        : `${Math.floor(m / 1440)}d ago`;
};
const label = (s) =>
  ({
    queued: 'Queued',
    analyzing: 'Analyzing',
    planning: 'Planning',
    editing: 'Working',
    testing: 'Checking',
    completed: 'Ready to review',
    failed: 'Failed',
    cancelled: 'Cancelled',
  })[s] || s;
function toast(message) {
  const t = document.querySelector('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 5500);
}
function logo(p) {
  return `<div class="project-logo" style="color:${/^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#79936d'};background:${p.name === 'Pocket' ? '#f6eee7' : p.name === 'Atlas' ? '#edf1f6' : '#eff2e9'}">${icon(p.name === 'Butterfly' ? 'butterfly' : p.name === 'Atlas' ? 'atlas' : 'saves')}</div>`;
}
function heading(eyebrow, title, subtitle, action = '') {
  return `<div class="eyebrow"><span></span>${eyebrow}</div><div class="heading-row"><div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;
}
function button(text, action, ic = 'arrow', primary = false, data = '') {
  return `<button class="button${primary ? ' primary' : ''}" data-action="${action}" ${data}>${ic ? icon(ic) : ''}${text}</button>`;
}
function renderNav() {
  for (const id of ['desktop-nav', 'mobile-nav'])
    document.getElementById(id).innerHTML = [
      'projects',
      'chat',
      'changes',
      'saves',
      'agents',
      'settings',
    ]
      .map(
        (v) =>
          `<button class="nav-item ${state.view === v ? 'active' : ''}" data-view="${v}" ${state.view === v ? 'aria-current="page"' : ''}>${icon(v)}${v[0].toUpperCase() + v.slice(1)}${v === 'agents' && state.jobs.some(active) ? `<span class="count">${state.jobs.filter(active).length}</span>` : ''}</button>`,
      )
      .join('');
  document.querySelector('#breadcrumb').textContent =
    state.view[0].toUpperCase() + state.view.slice(1);
}
function renderContext() {
  const p = project();
  if (!p) return;
  document.querySelector('#context').innerHTML =
    `<div class="context-heading">${icon('memory')}PROJECT MEMORY</div><div class="context-project">${logo(p)}<div><strong>${escape(p.name)}</strong><small>${escape(p.owner)} / ${escape(p.branch)}</small></div></div><p>A little context.<br>A lot less explaining.</p><div class="context-section"><h4>Stack</h4><div class="tags">${p.memory.stack.map((s) => `<span class="tag">${escape(s)}</span>`).join('')}</div></div><div class="context-section"><h4>Current objective</h4><p>${escape(p.memory.objective || 'Your next idea starts here.')}</p></div><div class="context-section"><h4>Keep in mind</h4>${p.memory.decisions.map((s) => `<div class="decision">${icon('check')}<span>${escape(s)}</span></div>`).join('')}${button('View project memory', 'memory', 'arrow')}</div><div class="context-bottom">${icon('shield')}<strong>Your work stays yours.</strong><p>Review every change. Nothing ships without your say.</p></div>`;
}
function projectsView() {
  const p = project();
  const recent = state.jobs.find((j) => j.status === 'completed');
  return (
    heading(
      'A little space. A lot of possibility.',
      'Good things start <em>here.</em>',
      'Your projects, ready for your next idea.',
      button('Connect repository', 'connect', 'plus'),
    ) +
    `<div class="projects-toolbar"><button class="filter-tab">All projects <span>${state.projects.length}</span></button><label class="search-box">${icon('search')}<input id="project-search" placeholder="Find a project…" aria-label="Search projects" value="${escape(state.filter)}"></label></div><div class="project-list">${
      state.projects
        .filter((p) =>
          (p.name + ' ' + p.description).toLowerCase().includes(state.filter.toLowerCase()),
        )
        .map((p) => {
          const j = state.jobs.find((j) => j.projectId === p.id);
          return `<a class="project-card" href="#chat" data-project="${p.id}">${logo(p)}<div><h2 class="project-name">${escape(p.name)}</h2><div class="project-description">${escape(p.description)}</div><div class="project-meta"><span><i class="language-dot" style="background:${p.language === 'Swift' ? '#daa17e' : '#8aa4bc'}"></i>${escape(p.language)}</span><span class="branch">${icon('branch')}${escape(p.branch)}</span><span>${escape(p.owner)}</span></div></div><div class="project-card-right"><span class="project-state ${!j ? 'neutral' : ''}">${j ? label(j.status) : 'Ready when you are'}</span>${icon('arrow')}</div></a>`;
        })
        .join('') || '<div class="empty-state"><p>No projects match your search.</p></div>'
    }</div><div class="section-label">PICK UP WHERE YOU LEFT OFF</div>${recent ? `<div class="activity-card"><div class="activity-icon">${icon('check')}</div><div><strong>Mobile dashboard, sorted.</strong><p>${escape(state.projects.find((p) => p.id === recent.projectId)?.name)} · ${recent.report.files.length} files changed · ready for review</p><span class="activity-meta">${relative(recent.updatedAt)} · Demo result</span></div>${button('Review', 'review', 'arrow', false, `data-job="${recent.id}"`)}</div>` : '<div class="activity-card"><div><strong>A fresh start.</strong><p>Your completed tasks will appear here.</p></div></div>'}<div class="idea-card">${icon('leaf')}<div><strong>Big ideas. Pocket-sized beginnings.</strong><p>A fix, a feature, a “what if.” Just tell Pocket what’s on your mind.</p></div>${button('Start a conversation', 'start', 'arrow', false, `data-project="${p?.id}"`)}</div>`
  );
}
function selector() {
  const p = project();
  return `<div class="chat-header"><div class="repo-select"><select id="repo-select" aria-label="Repository">${state.projects.map((r) => `<option value="${r.id}" ${r.id === p.id ? 'selected' : ''}>${escape(r.name)}</option>`).join('')}</select><span class="slash">/</span><select id="branch-select" aria-label="Branch">${p.branches.map((b) => `<option ${b === p.branch ? 'selected' : ''}>${escape(b)}</option>`).join('')}</select></div><label class="model-label">Model <select class="model-select" id="model-select" aria-label="Model">${state.models.map((m) => `<option value="${escape(m.id)}" ${m.id === state.modelId ? 'selected' : ''}>${escape(m.name)}</option>`).join('')}</select></label></div>`;
}
function jobCard(j) {
  if (!j) return '';
  if (active(j)) {
    const order = ['queued', 'analyzing', 'planning', 'editing', 'testing'];
    return `<div class="job-card"><div class="job-card-top"><span class="spinner"></span>Pocket is working</div><div class="run-phases">${order.map((s, i) => `<div class="phase ${s === j.status ? 'current' : i > order.indexOf(j.status) ? 'future' : ''}">${icon(i < order.indexOf(j.status) ? 'check' : 'clock')}${{ queued: 'Waiting for an agent slot', analyzing: 'Analyzing repository', planning: 'Planning your changes', editing: 'Editing files', testing: 'Running checks' }[s]}</div>`).join('')}</div>${button('Cancel task', 'cancel', null, false, `data-job="${j.id}"`)}<div class="demo-note">Simulated local run. No external repository is modified.</div></div>`;
  }
  if (j.status !== 'completed')
    return `<div class="job-card"><div class="job-card-top">${icon('clock')}${label(j.status)}</div><p>${escape(j.error || 'You cancelled this task.')}</p>${button('Try again', 'retry', 'arrow', false, `data-job="${j.id}"`)}</div>`;
  const r = j.report;
  return `<div class="job-card"><div class="job-card-top">${icon('check')}Ready for your review</div><div class="job-stat"><strong>${r.files.length} files changed</strong><span class="addition">+${r.files.reduce((n, f) => n + f.additions, 0)}</span><span class="deletion">−${r.files.reduce((n, f) => n + f.deletions, 0)}</span></div><div class="checks">${r.checks.map((c) => `<span class="check">${icon(c.status === 'passed' ? 'check' : 'clock')}${escape(c.name)} ${c.status}</span>`).join('')}</div><div class="job-actions">${button('Review changes', 'review', 'arrow', true, `data-job="${j.id}"`)}${button('Saved automatically', 'saves', 'saves')}</div><div class="demo-note">Demo diff and simulated checks. No code was executed.</div></div>`;
}
function chatView() {
  const j = currentJob();
  return (
    heading(
      'From thought to shipped.',
      'What’s on your <em>mind?</em>',
      'One message. A little less on your plate.',
    ) +
    selector() +
    `<div class="conversation">${j ? `<div class="message-user">${escape(j.prompt)}</div><div class="message-agent"><div class="message-label"><span class="pocket-mark"></span> POCKET <span>· ${relative(j.updatedAt)}</span></div>${j.report ? escape(j.report.summary) : active(j) ? 'I’ll work through this and bring the changes back for your review.' : 'Every idea is worth another try.'}${jobCard(j)}</div>` : `<div class="empty-state">${icon('chat')}<h2>Your next idea starts here.</h2><p>Ask Pocket to fix something, build something, or explore a possibility.</p></div>`}</div><form class="composer" id="composer"><textarea id="prompt" placeholder="Ask Pocket to build, fix, or explore…" aria-label="Task for Pocket" required minlength="3" maxlength="12000">${escape(state.draft)}</textarea><div class="composer-footer"><span>${icon('shield').replace('<svg', '<svg style="display:inline;width:10px;height:10px;vertical-align:middle;margin-right:4px"')} You’re in control of what ships.</span><button class="button primary" type="submit" ${state.loading ? 'disabled' : ''}>${icon('up')}Send</button></div></form><div class="composer-hint">Demo workspace · Cloud execution requires configured providers</div>`
  );
}
function changesView() {
  const j = currentJob();
  if (!j?.report)
    return (
      heading(
        'A closer look.',
        'Every change. <em>Yours to review.</em>',
        'Good work deserves a second look.',
      ) +
      `<div class="empty-state">${icon('changes')}<h2>No changes yet.</h2><p>Start a task and Pocket will bring the diff here.</p>${button('Open chat', 'chat', 'arrow', true)}</div>`
    );
  return (
    heading(
      'A closer look.',
      'The details <em>matter.</em>',
      `${escape(project().name)} / ${escape(j.branch)} · ${escape(label(j.status))}`,
    ) +
    `<div class="diff-summary"><strong>${j.report.files.length} files changed</strong><span class="addition">+${j.report.files.reduce((n, f) => n + f.additions, 0)}</span><span class="deletion">−${j.report.files.reduce((n, f) => n + f.deletions, 0)}</span><span>Demo diff</span></div>${j.report.files
      .map(
        (f, i) =>
          `<details class="diff-file" ${i === 0 ? 'open' : ''}><summary>${icon('file')}${escape(f.path)}<span class="diff-count"><span class="addition">+${f.additions}</span><span class="deletion">−${f.deletions}</span></span></summary><div class="diff-lines">${f.patch
            .split('\n')
            .map(
              (line, n) =>
                `<div class="diff-line ${line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : line.startsWith('@@') ? 'hunk' : ''}"><span class="line-number">${n + 1}</span>${escape(line)}</div>`,
            )
            .join('')}</div></details>`,
      )
      .join(
        '',
      )}<div class="checks">${j.report.checks.map((c) => `<span class="check">${icon('check')}${escape(c.detail)}</span>`).join('')}</div><div class="review-footer">${button('Create PR', 'ship', 'github', true, 'data-kind="pr"')}${button('Push branch', 'ship', 'up', false, 'data-kind="push"')}${button('Request changes', 'request', 'chat')}${button('View Save', 'saves', 'saves')}</div><div class="demo-note">Nothing is pushed automatically. Shipping actions are simulated in this workspace.</div>`
  );
}
function savesView() {
  return (
    heading(
      'A little peace of mind.',
      'Room to <em>experiment.</em>',
      'Every finished task is a Save. Come back to it whenever you like.',
    ) +
    `<div style="margin-top:32px">${state.saves.map((s) => `<div class="save-card"><div class="save-number">#${s.number}</div><div class="save-body"><strong>${escape(s.title)}</strong><small>${escape(project().name)} · ${relative(s.createdAt)} · Git checkpoint</small></div>${button('Restore', 'restore', 'clock', false, `data-save="${s.id}"`)}</div>`).join('') || `<div class="empty-state">${icon('saves')}<h2>Good ideas deserve a safety net.</h2><p>Your first finished task creates your first Save.</p></div>`}</div><div class="idea-card">${icon('shield')}<div><strong>Try the “what if.”</strong><p>A restore selects the starting point for your next task. Your remote branch stays untouched.</p></div></div>`
  );
}
function agentsView() {
  return (
    heading(
      'Quietly getting it done.',
      'A little work <em>in motion.</em>',
      'Put your phone away. Pocket keeps going.',
    ) +
    `<div style="margin-top:26px">${state.jobs.map((j) => `<a class="agent-card" href="#chat" data-agent="${j.id}">${active(j) ? '<span class="spinner"></span>' : icon(j.status === 'completed' ? 'check' : 'clock')}<div><strong>${escape(j.prompt.slice(0, 130))}</strong><small>${escape(state.projects.find((p) => p.id === j.projectId)?.name)} / ${escape(j.branch)} · ${relative(j.createdAt)} · ${j.demo ? 'Demo' : escape(j.modelId)}</small></div><span class="project-state">${label(j.status)}</span></a>`).join('') || '<div class="empty-state"><p>Your tasks will appear here.</p></div>'}</div>`
  );
}
function settingsView() {
  const total = state.jobs.reduce((n, j) => n + (j.report?.costCents ?? 0), 0);
  return (
    heading(
      'Make yourself at home.',
      'Small details. <em>Your way.</em>',
      'A quieter, more personal workspace.',
    ) +
    `<div class="settings-section"><h2>Connections</h2><div class="setting-row"><div>GitHub<small>Demo repositories · no account connected</small></div>${button('Connect', 'connect', 'external')}</div></div><div class="settings-section"><h2>Models & usage</h2><div class="setting-row"><div>Default model<small>Available models come from the Pocket API</small></div><select id="model-select" class="model-select" aria-label="Default model">${state.models.map((m) => `<option value="${escape(m.id)}" ${m.id === state.modelId ? 'selected' : ''}>${escape(m.name)}</option>`).join('')}</select></div><div class="setting-row"><div>Task budget<small>Hard cap for new tasks</small></div><span class="setting-value">$3.00 / task</span></div><div class="setting-row"><span>Recorded model cost</span><span class="setting-value">$${(total / 100).toFixed(2)} · demo</span></div><div class="setting-row"><span>Tasks</span><span class="setting-value">${state.jobs.length}</span></div></div><div class="settings-section"><h2>Preferences</h2><div class="setting-row"><div>Notify when a task finishes<small>Browser notifications while this preview is open</small></div><button class="toggle ${localStorage.getItem('pocket.notifications') === 'true' ? '' : 'off'}" data-action="notifications" role="switch" aria-checked="${localStorage.getItem('pocket.notifications') === 'true'}" aria-label="Task completion notifications"></button></div></div><div class="settings-section"><h2>Security</h2><div class="setting-row"><div>Shipping approval<small>Every push and pull request requires your approval</small></div>${icon('shield')}</div><div class="setting-row"><div>Ephemeral cloud sandboxes<small>Created for a task. Deleted after it finishes.</small></div><span class="setting-value">Daytona adapter</span></div><div class="setting-row"><div>Session<small>Local demo · bound to 127.0.0.1</small></div><span class="setting-value">Demo</span></div></div>`
  );
}
const views = {
  projects: projectsView,
  chat: chatView,
  changes: changesView,
  saves: savesView,
  agents: agentsView,
  settings: settingsView,
};
function render() {
  renderNav();
  renderContext();
  content.innerHTML = `<section class="page page-entrance">${views[state.view]()}</section>`;
}
async function navigate(view) {
  if (!views[view]) view = 'projects';
  state.view = view;
  location.hash = view;
  if (view === 'changes' && currentJob()) {
    const full = await api(`/jobs/${currentJob().id}`);
    state.jobs = state.jobs.map((j) => (j.id === full.id ? full : j));
  }
  if (view === 'saves') state.saves = await api(`/projects/${project().id}/saves`);
  render();
}
function modal(html) {
  document.querySelector('#dialog-content').innerHTML = html;
  document.querySelector('#dialog').showModal();
}
function closeModal() {
  document.querySelector('#dialog').close();
}
async function submit(prompt) {
  state.loading = true;
  try {
    const j = await api('/jobs', {
      projectId: project().id,
      branch: project().branch,
      prompt,
      modelId: state.modelId,
      maxCostCents: 300,
    });
    state.jobs.unshift(j);
    state.jobId = j.id;
    state.draft = '';
    await navigate('chat');
  } finally {
    state.loading = false;
    const b = document.querySelector('#composer button');
    if (b) b.disabled = false;
  }
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'prompt') state.draft = e.target.value;
  if (e.target.id === 'project-search') {
    state.filter = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const input = document.querySelector('#project-search');
    input.focus();
    input.setSelectionRange(pos, pos);
  }
});
document.addEventListener('change', async (e) => {
  try {
    if (e.target.id === 'model-select') state.modelId = e.target.value;
    if (e.target.id === 'branch-select') {
      project().branch = e.target.value;
      renderContext();
    }
    if (e.target.id === 'repo-select') {
      state.projectId = e.target.value;
      state.jobId = null;
      localStorage.setItem('pocket.project', state.projectId);
      render();
    }
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'composer') return;
  e.preventDefault();
  try {
    await submit(state.draft);
  } catch (err) {
    toast(err.message);
  }
});
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-view],[data-action],[data-project],[data-agent]');
  if (!el) return;
  e.preventDefault();
  try {
    if (el.dataset.view) {
      await navigate(el.dataset.view);
      return;
    }
    if (el.dataset.agent) {
      const j = state.jobs.find((j) => j.id === el.dataset.agent);
      state.projectId = j.projectId;
      project().branch = j.branch;
      state.jobId = j.id;
      await navigate('chat');
      return;
    }
    if (el.dataset.project) {
      state.projectId = el.dataset.project;
      state.jobId = null;
      localStorage.setItem('pocket.project', state.projectId);
      if (!el.dataset.action) {
        await navigate('chat');
        return;
      }
    }
    const action = el.dataset.action;
    if (views[action]) {
      await navigate(action);
      return;
    }
    if (action === 'start') {
      await navigate('chat');
      document.querySelector('#prompt').focus();
    }
    if (action === 'review') {
      state.jobId = el.dataset.job;
      const j = state.jobs.find((j) => j.id === state.jobId);
      state.projectId = j.projectId;
      project().branch = j.branch;
      await navigate('changes');
    }
    if (action === 'cancel') {
      const j = await api(`/jobs/${el.dataset.job}/cancel`, {});
      state.jobs = state.jobs.map((x) => (x.id === j.id ? j : x));
      render();
      toast('Task cancelled.');
    }
    if (action === 'retry') {
      const j = state.jobs.find((j) => j.id === el.dataset.job);
      state.draft = j.prompt;
      await navigate('chat');
      document.querySelector('#prompt').focus();
    }
    if (action === 'request') {
      state.draft = 'Please adjust the previous changes: ';
      await navigate('chat');
      document.querySelector('#prompt').focus();
    }
    if (action === 'connect')
      modal(
        `<div class="eyebrow">YOUR REPOSITORIES</div><h2>A place for your projects.</h2><p>This local workspace uses three demo projects. A real connection uses Supabase GitHub sign-in and your GitHub App installation.</p><p>Configure the server credentials and sign in from the native app to connect authorized repositories.</p><div class="dialog-actions">${button('Got it', 'close', null, true)}</div>`,
      );
    if (action === 'memory') {
      const p = project();
      modal(
        `<div class="eyebrow">POCKET MEMORY</div><h2>${escape(p.name)}</h2><div class="tags">${p.memory.stack.map((s) => `<span class="tag">${escape(s)}</span>`).join('')}</div><div class="memory-list"><h4>Current objective</h4><p>${escape(p.memory.objective)}</p><h4>Important decisions</h4>${p.memory.decisions.map((s) => `<p>✓ ${escape(s)}</p>`).join('')}<h4>Recent work</h4>${p.memory.recentWork.map((s) => `<p>${escape(s)}</p>`).join('')}</div>`,
      );
    }
    if (action === 'restore') {
      const s = state.saves.find((s) => s.id === el.dataset.save);
      modal(
        `<div class="eyebrow">POCKET SAVES</div><h2>A fresh starting point.</h2><p>Restore #${s.number}, “${escape(s.title)}”, as the starting point for your next task?</p><p>Your existing Saves and remote branch are preserved.</p><div class="dialog-actions">${button('Restore Save', 'confirm-restore', 'clock', true, `data-save="${s.id}"`)}${button('Keep working', 'close', null)}</div>`,
      );
    }
    if (action === 'confirm-restore') {
      await api(`/projects/${project().id}/restore`, {
        saveId: el.dataset.save,
        branch: project().branch,
      });
      closeModal();
      toast('Save selected. Your next task will start here.');
    }
    if (action === 'ship') {
      modal(
        `<div class="eyebrow">REVIEW → SHIP</div><h2>${el.dataset.kind === 'pr' ? 'Ready to open a PR?' : 'Ready to push a branch?'}</h2><p>Pocket will use a new branch. The base branch stays protected.</p><input id="ship-title" aria-label="Commit and pull request title" value="${escape(currentJob().prompt.slice(0, 160))}" maxlength="200"><p class="demo-note">Demo action: no GitHub repository will be changed.</p><div class="dialog-actions">${button(el.dataset.kind === 'pr' ? 'Approve & create PR' : 'Approve & push', 'confirm-ship', 'github', true, `data-kind="${el.dataset.kind}"`)}${button('Keep reviewing', 'close', null)}</div>`,
      );
    }
    if (action === 'confirm-ship') {
      el.disabled = true;
      try {
        const r = await api(`/jobs/${currentJob().id}/ship`, {
          kind: el.dataset.kind,
          title: document.querySelector('#ship-title').value,
          approved: true,
        });
        closeModal();
        toast(r.message || 'Ready on GitHub.');
      } finally {
        el.disabled = false;
      }
    }
    if (action === 'notifications') {
      if (!('Notification' in window)) {
        toast('This browser does not support notifications.');
        return;
      }
      const enabled = localStorage.getItem('pocket.notifications') === 'true';
      const permission = enabled ? 'denied' : await Notification.requestPermission();
      localStorage.setItem('pocket.notifications', String(!enabled && permission === 'granted'));
      render();
    }
    if (action === 'close') closeModal();
  } catch (err) {
    toast(err.message);
  }
});
document.querySelector('#settings-shortcut').innerHTML = icon('settings');
document.querySelector('#settings-shortcut').onclick = () => navigate('settings');
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (v !== state.view) navigate(v).catch((e) => toast(e.message));
});
async function refresh() {
  const incoming = await api('/jobs');
  const next = incoming.map((j) => {
    const old = state.jobs.find((o) => o.id === j.id);
    return old?.updatedAt === j.updatedAt && old?.report?.files.some((f) => f.patch) ? old : j;
  });
  const changed = JSON.stringify(next) !== JSON.stringify(state.jobs);
  const finished = next.find(
    (j) => j.status === 'completed' && state.jobs.some((old) => old.id === j.id && active(old)),
  );
  state.jobs = next;
  if (finished) {
    state.projects = await api('/projects');
    toast('Pocket finished your task. Ready to review.');
    if (
      localStorage.getItem('pocket.notifications') === 'true' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    )
      new Notification('Pocket finished your task.', { body: 'Your changes are ready to review.' });
  }
  if (changed && (state.view !== 'chat' || !document.querySelector('#prompt')?.matches(':focus'))) {
    if (state.view === 'saves') state.saves = await api(`/projects/${project().id}/saves`);
    render();
  }
}
(async () => {
  try {
    [state.projects, state.models, state.jobs] = await Promise.all([
      api('/projects'),
      api('/models'),
      api('/jobs'),
    ]);
    if (!project()) {
      content.innerHTML = '<div class="empty-state">No projects connected.</div>';
      return;
    }
    state.projectId = project().id;
    await navigate(location.hash.slice(1) || 'projects');
    setInterval(() => {
      if (document.visibilityState === 'visible' && state.jobs.some(active))
        refresh().catch((e) => toast(e.message));
    }, 1200);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh().catch((e) => toast(e.message));
    });
  } catch (err) {
    content.innerHTML = `<div class="page empty-state"><h2>Couldn’t reach Pocket.</h2><p>${escape(err.message)}</p><p>Start the API with npm run dev, then reload.</p></div>`;
  }
})();
