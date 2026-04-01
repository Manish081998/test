const express = require('express');
const cors    = require('cors');
const { spawn } = require('child_process');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Load server config (contains GitHub token) ───────────────────────────────
let serverConfig = {};
try {
  const cfgPath = path.join(__dirname, 'server-config.json');
  serverConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  console.log('✓ server-config.json loaded' + (serverConfig.githubToken ? ' (token present)' : ' (no token)'));
} catch {
  console.warn('⚠ server-config.json not found — create it with { "githubToken": "ghp_..." }');
}

// Returns git -c args that inject the token via http.extraheader.
// This bypasses Windows Credential Manager completely.
function authArgs(token) {
  if (!token) return ['-c', 'credential.helper='];
  const b64 = Buffer.from(`oauth2:${token}`).toString('base64');
  return [
    '-c', 'credential.helper=',
    '-c', `http.https://github.com/.extraheader=Authorization: Basic ${b64}`,
  ];
}

const STEPS = [
  { id: 'checkout', label: 'Checkout Branch',   args: (b)    => ['checkout', b]       },
  { id: 'add',      label: 'Stage All Changes',  args: ()     => ['add', '.']          },
  { id: 'status',   label: 'Show Status',        args: ()     => ['status']            },
  { id: 'commit',   label: 'Commit Changes',     args: (_, m) => ['commit', '-m', m]  },
  { id: 'push',     label: 'Push to Remote',     args: (b)    => ['push', '-u', 'origin', b, '--force'] },
];

// Run a git command, streaming output. Auth args injected when token provided.
function runGitCmd(args, cwd, send, token = null) {
  return new Promise((resolve) => {
    const auth = token ? authArgs(token) : ['-c', 'credential.helper='];
    const proc = spawn('git', [...auth, ...args], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    proc.stdout.on('data', d => send({ type: 'stdout', text: d.toString() }));
    proc.stderr.on('data', d => send({ type: 'stderr', text: d.toString() }));
    proc.on('close', code => resolve(code === 0));
  });
}

// Resolves the stdout string of a git command, or null on failure.
function gitOutput(args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', code => resolve(code === 0 ? out.trim() : null));
  });
}

// Ensure remote 'origin' points to repoUrl (clean URL, no token embedded).
async function ensureRemote(folder, repoUrl, send) {
  const current = await gitOutput(['remote', 'get-url', 'origin'], folder);
  if (current === null) {
    send({ type: 'stdout', text: `  → Adding remote origin: ${repoUrl}\n` });
    return new Promise(resolve => {
      const p = spawn('git', ['remote', 'add', 'origin', repoUrl], { cwd: folder });
      p.on('close', code => resolve(code === 0));
    });
  }
  // If URL changed, update it
  if (current !== repoUrl) {
    await new Promise(resolve => {
      const p = spawn('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: folder });
      p.on('close', resolve);
    });
  }
  return true;
}

function isGitRepo(folder) {
  try { return fs.existsSync(path.join(folder, '.git')); } catch { return false; }
}

function hasCommits(folder) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['log', '--oneline', '-1'], { cwd: folder });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', code => resolve(code === 0 && out.trim().length > 0));
  });
}

function branchExists(branch, folder) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['branch', '--list', branch], { cwd: folder });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim().length > 0));
  });
}

function remoteBranchExists(branch, folder) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['branch', '-r', '--list', `origin/${branch}`], { cwd: folder });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim().length > 0));
  });
}

// Sync a fresh local repo with remote branches already created by the Setup tab.
async function syncWithRemote(folder, token, send) {
  send({ type: 'stdout', text: '⚙ Remote branches detected — syncing local repo...\n' });
  send({ type: 'stdout', text: '  → git fetch origin\n' });
  await runGitCmd(['fetch', 'origin'], folder, send, token);

  const localMainExists = await branchExists('main', folder);
  if (!localMainExists) {
    send({ type: 'stdout', text: '  → Create local main tracking origin/main\n' });
    const ok = await runGitCmd(['checkout', '-b', 'main', 'origin/main'], folder, send);
    if (!ok) return false;
  } else {
    send({ type: 'stdout', text: '  → Checkout main\n' });
    await runGitCmd(['checkout', 'main'], folder, send);
  }

  const remoteDevExists = await remoteBranchExists('development', folder);
  const localDevExists  = await branchExists('development', folder);
  if (remoteDevExists && !localDevExists) {
    send({ type: 'stdout', text: '  → Create local development tracking origin/development\n' });
    await runGitCmd(['checkout', '-b', 'development', 'origin/development'], folder, send);
  } else if (!localDevExists) {
    send({ type: 'stdout', text: '  → Create development branch from main\n' });
    await runGitCmd(['checkout', '-b', 'development'], folder, send);
  } else {
    await runGitCmd(['checkout', 'development'], folder, send);
  }

  send({ type: 'stdout', text: '✓ Local branches synced with remote\n\n' });
  return true;
}

// Init a truly empty remote: commit → push main → create development.
async function initFreshRepo(folder, message, token, send) {
  send({ type: 'stdout', text: '⚙ Empty repository — creating initial commit + branches...\n' });

  const steps = [
    { label: 'Stage all files',       args: ['add', '.']             },
    { label: 'Create initial commit', args: ['commit', '-m', message]},
    { label: 'Rename branch → main',  args: ['branch', '-M', 'main'] },
  ];

  for (const step of steps) {
    send({ type: 'stdout', text: `  → ${step.label}\n` });
    const ok = await runGitCmd(step.args, folder, send);
    if (!ok) { send({ type: 'stdout', text: `  ✗ Failed: ${step.label}\n` }); return false; }
  }

  send({ type: 'stdout', text: '  → Push main to remote\n' });
  const pushOk = await runGitCmd(['push', '-u', 'origin', 'main'], folder, send, token);
  if (!pushOk) { send({ type: 'stdout', text: '  ✗ Failed: Push main\n' }); return false; }

  send({ type: 'stdout', text: '  → Create development branch\n' });
  const devOk = await runGitCmd(['checkout', '-b', 'development'], folder, send);
  if (!devOk) { send({ type: 'stdout', text: '  ✗ Failed: Create development\n' }); return false; }

  send({ type: 'stdout', text: '✓ Branches initialised (main + development)\n\n' });
  return true;
}

// ── /api/config — returns token to frontend (localhost only) ─────────────────
app.get('/api/config', (_, res) => {
  res.json({ githubToken: serverConfig.githubToken || '' });
});

// ── /api/git/push ─────────────────────────────────────────────────────────────
app.post('/api/git/push', async (req, res) => {
  const { folder, branch, message, repoUrl } = req.body;
  // Token comes from server config, NOT from the request body
  const token = serverConfig.githubToken || '';

  if (!folder || !branch || !message) {
    return res.status(400).json({ error: 'folder, branch and message are required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  if (!token) {
    send({ type: 'fatal', id: 'checkout', text: 'No GitHub token configured — add githubToken to server-config.json' });
    res.end(); return;
  }

  // ── 0. git init if needed ────────────────────────────────────────────────
  if (!isGitRepo(folder)) {
    send({ type: 'stdout', text: '  → git init (no .git found)\n' });
    const ok = await runGitCmd(['init'], folder, send);
    if (!ok) {
      send({ type: 'fatal', id: 'checkout', text: 'git init failed' });
      res.end(); return;
    }
  }

  // ── 1. Ensure remote origin ──────────────────────────────────────────────
  if (repoUrl) {
    const ok = await ensureRemote(folder, repoUrl, send);
    if (!ok) {
      send({ type: 'fatal', id: 'checkout', text: 'Failed to configure remote origin' });
      res.end(); return;
    }
  }

  // ── 2. Fetch so we know remote state ────────────────────────────────────
  await runGitCmd(['fetch', 'origin'], folder, send, token);

  // ── 3. Branch setup for repos with no local commits ─────────────────────
  const repoHasCommits = await hasCommits(folder);
  if (!repoHasCommits) {
    const remoteHasMain = await remoteBranchExists('main', folder);
    if (remoteHasMain) {
      const ok = await syncWithRemote(folder, token, send);
      if (!ok) {
        send({ type: 'fatal', id: 'checkout', text: 'Failed to sync with remote branches' });
        res.end(); return;
      }
    } else {
      const ok = await initFreshRepo(folder, message, token, send);
      if (!ok) {
        send({ type: 'fatal', id: 'checkout', text: 'Failed to initialise repository branches' });
        res.end(); return;
      }
    }
  }

  // ── 4. Source branch guard ───────────────────────────────────────────────
  const sourceBranchExists = await branchExists(branch, folder);
  if (!sourceBranchExists) {
    send({ type: 'stdout', text: `  → Branch '${branch}' not found — creating it\n` });
    const ok = await runGitCmd(['checkout', '-b', branch], folder, send);
    if (!ok) {
      send({ type: 'fatal', id: 'checkout', text: `Failed to create branch: ${branch}` });
      res.end(); return;
    }
  }

  // ── 5. Ensure source branch shares history with main ────────────────────
  // GitHub refuses to create a PR if branches have no common ancestor.
  // Fix: checkout source branch, then merge origin/main with --allow-unrelated-histories
  // using -X ours so our project files always win over any conflicts (e.g. README.md).
  await runGitCmd(['checkout', branch], folder, send);
  const remoteMainExists = await remoteBranchExists('main', folder);
  if (remoteMainExists) {
    send({ type: 'stdout', text: `  → Merging origin/main into ${branch} to connect git histories...\n` });
    await runGitCmd(
      ['merge', 'origin/main', '--allow-unrelated-histories', '-X', 'ours', '--no-edit'],
      folder, send
    );
    send({ type: 'stdout', text: '  ✓ Histories connected — PR creation will succeed\n' });
  }

  // ── 6. Auto-create CI workflow file if not already in the project ───────
  // This ensures "CI / Build" check runs on every PR without needing the
  // GitHub "workflow" token scope (git push works with repo scope only).
  const workflowDir  = path.join(folder, '.github', 'workflows');
  const workflowFile = path.join(workflowDir, 'build.yml');
  if (!fs.existsSync(workflowFile)) {
    fs.mkdirSync(workflowDir, { recursive: true });
    const isDotnet = fs.readdirSync(folder).some(f => f.endsWith('.sln') || f.endsWith('.csproj'));
    const buildStep = isDotnet
      ? [
          '      - uses: actions/setup-dotnet@v4',
          '        with:',
          "          dotnet-version: '8.x'",
          '      - name: Build',
          '        run: dotnet build',
        ]
      : [
          '      - uses: actions/setup-node@v4',
          '        with:',
          "          node-version: '20'",
          '      - name: Build',
          '        run: |',
          '          [ -f package-lock.json ] && npm ci || npm install',
          '          npm run build --if-present',
        ];
    const yaml = [
      'name: CI',
      '',
      'on:',
      '  pull_request:',
      '    branches: [main]',
      '  push:',
      '    branches: [development]',
      '',
      'jobs:',
      '  Build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      ...buildStep,
    ].join('\n');
    fs.writeFileSync(workflowFile, yaml, 'utf8');
    send({ type: 'stdout', text: '  → Created .github/workflows/build.yml (CI workflow)\n' });
  }

  // ── 7. Git steps ─────────────────────────────────────────────────────────
  for (const step of STEPS) {
    const args = step.args(branch, message);
    send({ type: 'step-start', id: step.id, label: step.label, cmd: `git ${args.join(' ')}` });

    let output = '';
    const isAuthStep = step.id === 'push';

    const ok = await new Promise(resolve => {
      const auth = isAuthStep ? authArgs(token) : ['-c', 'credential.helper='];
      const proc = spawn('git', [...auth, ...args], {
        cwd: folder,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      proc.stdout.on('data', d => { const t = d.toString(); output += t; send({ type: 'stdout', id: step.id, text: t }); });
      proc.stderr.on('data', d => { const t = d.toString(); output += t; send({ type: 'stderr', id: step.id, text: t }); });
      proc.on('close', code => resolve(code === 0));
    });

    const noop = step.id === 'commit' && (output.includes('nothing to commit') || output.includes('nothing added'));
    const stepOk = ok || noop;
    send({ type: 'step-end', id: step.id, ok: stepOk, noop });
    if (!stepOk) {
      send({ type: 'fatal', id: step.id, text: output.trim() || `git ${args.join(' ')} failed` });
      res.end(); return;
    }
  }

  send({ type: 'done' });
  res.end();
});

// ── /api/dotnet/build ─────────────────────────────────────────────────────────
app.post('/api/dotnet/build', (req, res) => {
  const { folder } = req.body;
  if (!folder) return res.status(400).json({ error: 'folder is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => {
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  let hasDotnet = false;
  try {
    const entries = fs.readdirSync(folder);
    hasDotnet = entries.some(f => f.endsWith('.sln') || f.endsWith('.csproj'));
  } catch (e) {
    send({ type: 'fatal', text: `Cannot read folder: ${e.message}` });
    res.end(); return;
  }

  if (!hasDotnet) {
    send({ type: 'stdout', text: 'No .sln / .csproj found — skipping dotnet build (Angular/Node project detected)\n' });
    send({ type: 'done', ok: true });
    res.end(); return;
  }

  const proc = spawn('dotnet', ['build'], { cwd: folder });
  proc.stdout.on('data', d => send({ type: 'stdout', text: d.toString() }));
  proc.stderr.on('data', d => send({ type: 'stderr', text: d.toString() }));
  proc.on('close', code => {
    if (code === 0) send({ type: 'done', ok: true });
    else            send({ type: 'fatal', text: `dotnet build failed — exit code ${code}` });
    res.end();
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.listen(3001, () => console.log('Git server → http://localhost:3001'));
