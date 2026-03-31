const express = require('express');
const cors    = require('cors');
const { spawn } = require('child_process');
const fs      = require('fs');
const path    = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const STEPS = [
  { id: 'checkout', label: 'Checkout Branch',   args: (b)    => ['checkout', b]       },
  { id: 'add',      label: 'Stage All Changes',  args: ()     => ['add', '.']          },
  { id: 'status',   label: 'Show Status',        args: ()     => ['status']            },
  { id: 'commit',   label: 'Commit Changes',     args: (_, m) => ['commit', '-m', m]  },
  { id: 'push',     label: 'Push to Remote',     args: (b)    => ['push', 'origin', b]},
];

// Run a single git command; resolves true on success, false on failure.
// Streams stdout/stderr as plain terminal events (no step binding).
function runGitCmd(args, cwd, send, extraEnv = {}) {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extraEnv } });
    proc.stdout.on('data', d => send({ type: 'stdout', text: d.toString() }));
    proc.stderr.on('data', d => send({ type: 'stderr', text: d.toString() }));
    proc.on('close', code => resolve(code === 0));
  });
}

// Temporarily set origin to the authenticated URL, run an async action, then restore.
// This ensures 'git fetch/push origin' works correctly and populates origin/* refs.
async function withAuthRemote(folder, repoUrl, token, action) {
  const authUrl = (token && repoUrl) ? repoUrl.replace('https://', `https://oauth2:${token}@`) : null;
  if (authUrl) {
    await new Promise(resolve => {
      const p = spawn('git', ['remote', 'set-url', 'origin', authUrl], { cwd: folder });
      p.on('close', resolve);
    });
  }
  try {
    return await action();
  } finally {
    if (authUrl && repoUrl) {
      await new Promise(resolve => {
        const p = spawn('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: folder });
        p.on('close', resolve);
      });
    }
  }
}

// Resolves the string value of a git command (e.g. remote get-url), or null on failure.
function gitOutput(args, cwd) {
  return new Promise((resolve) => {
    const proc = spawn('git', args, { cwd });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', code => resolve(code === 0 ? out.trim() : null));
  });
}

// Ensure remote 'origin' points to repoUrl; add it if missing.
async function ensureRemote(folder, repoUrl, send) {
  const current = await gitOutput(['remote', 'get-url', 'origin'], folder);
  if (current === null) {
    send({ type: 'stdout', text: `  → Adding remote origin: ${repoUrl}\n` });
    return runGitCmd(['remote', 'add', 'origin', repoUrl], folder, send);
  }
  return true; // already configured
}

// Check whether folder is a git repo (.git directory exists).
function isGitRepo(folder) {
  try {
    return fs.existsSync(path.join(folder, '.git'));
  } catch { return false; }
}

// Check whether the repo has at least one commit.
function hasCommits(folder) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['log', '--oneline', '-1'], { cwd: folder });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', code => resolve(code === 0 && out.trim().length > 0));
  });
}

// Check whether a local branch exists.
function branchExists(branch, folder) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['branch', '--list', branch], { cwd: folder });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim().length > 0));
  });
}

// Check whether a remote branch exists (after fetch).
function remoteBranchExists(branch, folder) {
  return new Promise((resolve) => {
    const proc = spawn('git', ['branch', '-r', '--list', `origin/${branch}`], { cwd: folder });
    let out = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.on('close', () => resolve(out.trim().length > 0));
  });
}

// Sync local repo with remote branches that already exist (e.g. created by Setup tab).
// Returns true on success.
async function syncWithRemote(folder, token, repoUrl, send) {
  send({ type: 'stdout', text: '⚙ Remote branches detected — syncing local repo...\n' });

  // Fetch via named remote (populates origin/* refs correctly)
  send({ type: 'stdout', text: '  → git fetch origin\n' });
  await withAuthRemote(folder, repoUrl, token, () => runGitCmd(['fetch', 'origin'], folder, send));

  // Create/reset local main to track origin/main
  const localMainExists = await branchExists('main', folder);
  if (!localMainExists) {
    send({ type: 'stdout', text: '  → Create local main tracking origin/main\n' });
    const ok = await runGitCmd(['checkout', '-b', 'main', 'origin/main'], folder, send);
    if (!ok) return false;
  } else {
    send({ type: 'stdout', text: '  → Reset local main to origin/main\n' });
    await runGitCmd(['checkout', 'main'], folder, send);
    await runGitCmd(['reset', '--hard', 'origin/main'], folder, send);
  }

  // Create/sync local development to track origin/development if it exists remotely
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

// Full init for a truly empty remote: initial commit on main, push, create development.
async function initFreshRepo(folder, message, token, repoUrl, send) {
  send({ type: 'stdout', text: '⚙ Empty repository — creating initial commit + branches...\n' });

  const plainSteps = [
    { label: 'Stage all files',           args: ['add', '.']                       },
    { label: 'Create initial commit',     args: ['commit', '-m', message]          },
    { label: 'Rename branch → main',      args: ['branch', '-M', 'main']          },
  ];

  for (const step of plainSteps) {
    send({ type: 'stdout', text: `  → ${step.label}\n` });
    const ok = await runGitCmd(step.args, folder, send);
    if (!ok) {
      send({ type: 'stdout', text: `  ✗ Failed at: ${step.label}\n` });
      return false;
    }
  }

  // Push main using authenticated remote
  send({ type: 'stdout', text: '  → Push main to remote\n' });
  const pushOk = await withAuthRemote(folder, repoUrl, token, () =>
    runGitCmd(['push', '-u', 'origin', 'main'], folder, send)
  );
  if (!pushOk) {
    send({ type: 'stdout', text: '  ✗ Failed at: Push main to remote\n' });
    return false;
  }

  // Create development branch
  send({ type: 'stdout', text: '  → Create development branch\n' });
  const devOk = await runGitCmd(['checkout', '-b', 'development'], folder, send);
  if (!devOk) {
    send({ type: 'stdout', text: '  ✗ Failed at: Create development branch\n' });
    return false;
  }

  send({ type: 'stdout', text: '✓ Branches initialised (main + development)\n\n' });
  return true;
}

app.post('/api/git/push', async (req, res) => {
  const { folder, branch, message, repoUrl, token } = req.body;
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

  // ── 0. Ensure folder is a git repo (run git init if needed) ─────────────
  if (!isGitRepo(folder)) {
    send({ type: 'stdout', text: '  → git init (no .git found)\n' });
    const initOk = await runGitCmd(['init'], folder, send);
    if (!initOk) {
      send({ type: 'fatal', id: 'checkout', text: 'git init failed — check that the folder exists and git is installed' });
      res.end();
      return;
    }
  }

  // ── 1. Ensure remote origin is configured ────────────────────────────────
  if (repoUrl) {
    const remoteOk = await ensureRemote(folder, repoUrl, send);
    if (!remoteOk) {
      send({ type: 'fatal', id: 'checkout', text: 'Failed to configure remote origin' });
      res.end();
      return;
    }
  }

  // ── 2. Branch setup: sync with remote if it has history, else init fresh ──
  const repoHasCommits = await hasCommits(folder);
  if (!repoHasCommits) {
    // Fetch via named remote so origin/* refs are populated
    await withAuthRemote(folder, repoUrl, token, () => runGitCmd(['fetch', 'origin'], folder, send));
    const remoteHasMain = await remoteBranchExists('main', folder);
    if (remoteHasMain) {
      const syncOk = await syncWithRemote(folder, token, repoUrl, send);
      if (!syncOk) {
        send({ type: 'fatal', id: 'checkout', text: 'Failed to sync with remote branches' });
        res.end();
        return;
      }
    } else {
      const initOk = await initFreshRepo(folder, message, token, repoUrl, send);
      if (!initOk) {
        send({ type: 'fatal', id: 'checkout', text: 'Failed to initialise repository branches' });
        res.end();
        return;
      }
    }
  }

  // ── 3. Source branch guard: create it if it doesn't exist yet ───────────
  const sourceBranchExists = await branchExists(branch, folder);
  if (!sourceBranchExists) {
    send({ type: 'stdout', text: `  → Branch '${branch}' not found — creating it\n` });
    const created = await runGitCmd(['checkout', '-b', branch], folder, send);
    if (!created) {
      send({ type: 'fatal', id: 'checkout', text: `Failed to create branch: ${branch}` });
      res.end();
      return;
    }
  }

  // ── Normal git push steps (async loop) ───────────────────────────────────
  for (const step of STEPS) {
    const args = step.args(branch, message);
    send({ type: 'step-start', id: step.id, label: step.label, cmd: `git ${args.join(' ')}` });

    let output = '';
    let ok;

    if (step.id === 'push') {
      // Use withAuthRemote + --force-with-lease so local code always wins.
      // --force-with-lease is safe: it only force-pushes if no one else pushed
      // since our last fetch, preventing accidental overwrites of others' work.
      ok = await withAuthRemote(folder, repoUrl, token, () =>
        new Promise(resolve => {
          const proc = spawn('git', ['push', '-u', 'origin', branch, '--force-with-lease'],
            { cwd: folder, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
          proc.stdout.on('data', d => { const t = d.toString(); output += t; send({ type: 'stdout', id: step.id, text: t }); });
          proc.stderr.on('data', d => { const t = d.toString(); output += t; send({ type: 'stderr', id: step.id, text: t }); });
          proc.on('close', code => resolve(code === 0));
        })
      );
    } else {
      ok = await new Promise(resolve => {
        const proc = spawn('git', args, { cwd: folder, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        proc.stdout.on('data', d => { const t = d.toString(); output += t; send({ type: 'stdout', id: step.id, text: t }); });
        proc.stderr.on('data', d => { const t = d.toString(); output += t; send({ type: 'stderr', id: step.id, text: t }); });
        proc.on('close', code => resolve(code === 0));
      });
    }

    const noop = step.id === 'commit' && (output.includes('nothing to commit') || output.includes('nothing added'));
    const stepOk = ok || noop;
    send({ type: 'step-end', id: step.id, ok: stepOk, noop });
    if (!stepOk) {
      send({ type: 'fatal', id: step.id, text: `Exit code — see terminal for details` });
      res.end();
      return;
    }
  }

  send({ type: 'done' });
  res.end();
});

// dotnet build — auto-detects project type; skips build for non-.NET folders
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

  // Detect whether this is a .NET project
  let hasDotnet = false;
  try {
    const entries = fs.readdirSync(folder);
    hasDotnet = entries.some(f => f.endsWith('.sln') || f.endsWith('.csproj'));
  } catch (e) {
    send({ type: 'fatal', text: `Cannot read folder: ${e.message}` });
    res.end();
    return;
  }

  if (!hasDotnet) {
    send({ type: 'stdout', text: 'No .sln / .csproj found — skipping dotnet build (Angular/Node project detected)\n' });
    send({ type: 'done', ok: true });
    res.end();
    return;
  }

  const proc = spawn('dotnet', ['build'], { cwd: folder });

  proc.stdout.on('data', d => send({ type: 'stdout', text: d.toString() }));
  proc.stderr.on('data', d => send({ type: 'stderr', text: d.toString() }));

  proc.on('close', code => {
    if (code === 0) send({ type: 'done',  ok: true });
    else            send({ type: 'fatal', text: `dotnet build failed — exit code ${code}` });
    res.end();
  });
});

// Health check
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.listen(3001, () => console.log('Git server → http://localhost:3001'));
