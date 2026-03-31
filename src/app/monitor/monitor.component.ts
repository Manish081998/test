import { Component, Input, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GithubService, WorkflowRun, PullRequest, Commit, Branch } from '../github.service';
import { Subscription, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="monitor fade-in">

  <!-- Header bar -->
  <div class="monitor-bar">
    <div class="field-inline">
      <input [(ngModel)]="repoUrl" placeholder="https://github.com/username/repo.git"
             (ngModelChange)="onUrlChange()" />
    </div>
    <div class="bar-right">
      @if (loading()) { <span class="spin" style="color:var(--blue)">⟳</span> }
      @if (lastRefresh()) {
        <span class="refresh-time">Updated {{ lastRefresh() }}</span>
      }
      <button class="btn-refresh" (click)="load()" [disabled]="loading() || !canLoad()">Refresh</button>
      <div class="auto-toggle" [class.on]="autoRefresh()" (click)="toggleAuto()">
        <span class="toggle-dot"></span>
        <span>Auto {{ autoRefresh() ? 'ON' : 'OFF' }}</span>
      </div>
    </div>
  </div>

  @if (!canLoad()) {
    <div class="empty-state">
      <div class="empty-icon">⬡</div>
      <strong>Enter a repo URL and GitHub token to start monitoring</strong>
      <span>Real-time CI status, PRs, and commits — all in one view</span>
    </div>
  }

  @if (canLoad() && !loading() && !repoInfo()) {
    <div class="empty-state">
      <div class="empty-icon spin" style="color:var(--blue)">⟳</div>
      <strong>Loading repository data...</strong>
    </div>
  }

  @if (repoInfo()) {
    <!-- Repo Header -->
    <div class="repo-header fade-in">
      <div class="repo-name">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8z"/>
        </svg>
        <a [href]="repoInfo()!.html_url" target="_blank">{{ repoInfo()!.full_name }}</a>
      </div>
      <div class="repo-badges">
        <span class="badge" [class]="repoInfo()!.visibility === 'public' ? 'info' : 'neutral'">
          {{ repoInfo()!.visibility }}
        </span>
        <span class="badge" [class]="repoInfo()!.allow_auto_merge ? 'success' : 'neutral'">
          auto-merge {{ repoInfo()!.allow_auto_merge ? 'on' : 'off' }}
        </span>
        <span class="badge neutral">default: {{ repoInfo()!.default_branch }}</span>
      </div>
    </div>

    <!-- Stats Row -->
    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-val">{{ openPRs().length }}</span>
        <span class="stat-label">Open PRs</span>
      </div>
      <div class="stat-card">
        <span class="stat-val" [class]="latestRunColor()">{{ latestRunStatus() }}</span>
        <span class="stat-label">Latest CI</span>
      </div>
      <div class="stat-card">
        <span class="stat-val">{{ branches().length }}</span>
        <span class="stat-label">Branches</span>
      </div>
      <div class="stat-card">
        <span class="stat-val">{{ ciRuns().length }}</span>
        <span class="stat-label">Recent Runs</span>
      </div>
    </div>

    <div class="grid-2">

      <!-- CI Runs -->
      <div class="panel">
        <div class="panel-title">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zM8 0a8 8 0 100 16A8 8 0 008 0zM6.379 5.227A.25.25 0 006 5.442v5.117a.25.25 0 00.379.214l4.264-2.559a.25.25 0 000-.428L6.379 5.227z"/>
          </svg>
          CI Runs
          @if (hasRunningCI()) { <span class="pulse yellow"></span> }
        </div>
        @for (run of ciRuns(); track run.id) {
          <div class="run-row fade-in">
            <span class="pulse" [class]="runPulse(run)"></span>
            <div class="run-body">
              <div class="run-top">
                <span class="run-name">{{ run.name }}</span>
                <span class="badge" [class]="runBadge(run)">{{ runLabel(run) }}</span>
              </div>
              <div class="run-meta">
                <span class="mono">{{ run.head_branch }}</span>
                <span>·</span>
                <span>{{ run.head_commit?.message | slice:0:50 }}</span>
              </div>
              <div class="run-time">{{ run.created_at | date:'MMM d, h:mm a' }}</div>
            </div>
            <a [href]="run.html_url" target="_blank" class="ext-link" title="View on GitHub">↗</a>
          </div>
        }
        @if (!ciRuns().length && !loading()) {
          <div class="empty-panel">No CI runs found</div>
        }
      </div>

      <!-- Open PRs -->
      <div class="panel">
        <div class="panel-title">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
          </svg>
          Open Pull Requests
        </div>
        @for (pr of openPRs(); track pr.number) {
          <div class="pr-row fade-in">
            <div class="pr-num">#{{ pr.number }}</div>
            <div class="pr-body">
              <div class="pr-top">
                <a [href]="pr.html_url" target="_blank" class="pr-title-link">{{ pr.title }}</a>
              </div>
              <div class="pr-meta">
                <span class="mono">{{ pr.head.ref }} → {{ pr.base.ref }}</span>
                @if (pr.auto_merge) { <span class="badge success">auto-merge</span> }
              </div>
              <div class="run-time">{{ pr.created_at | date:'MMM d, h:mm a' }}</div>
            </div>
          </div>
        }
        @if (!openPRs().length && !loading()) {
          <div class="empty-panel">No open pull requests</div>
        }
      </div>

      <!-- Recent Commits -->
      <div class="panel">
        <div class="panel-title">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M10.5 7.75a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zm1.43.75a4.002 4.002 0 01-7.86 0H.75a.75.75 0 110-1.5h3.32a4.001 4.001 0 017.86 0h3.32a.75.75 0 110 1.5h-3.32z"/>
          </svg>
          Recent Commits · <span class="mono" style="font-size:11px">development</span>
        </div>
        @for (c of commits(); track c.sha) {
          <div class="commit-row fade-in">
            @if (c.author?.avatar_url) {
              <img [src]="c.author!.avatar_url" class="avatar" />
            } @else {
              <div class="avatar-placeholder">{{ c.commit.author.name[0] }}</div>
            }
            <div class="commit-body">
              <a [href]="c.html_url" target="_blank" class="commit-msg">{{ c.commit.message | slice:0:60 }}</a>
              <div class="run-time">
                <span>{{ c.commit.author.name }}</span>
                <span>·</span>
                <span class="mono">{{ c.sha | slice:0:7 }}</span>
                <span>·</span>
                <span>{{ c.commit.author.date | date:'MMM d' }}</span>
              </div>
            </div>
          </div>
        }
        @if (!commits().length && !loading()) {
          <div class="empty-panel">No commits found</div>
        }
      </div>

      <!-- Branches -->
      <div class="panel">
        <div class="panel-title">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
            <path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
          </svg>
          Branches
        </div>
        @for (b of branches(); track b.name) {
          <div class="branch-row fade-in">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
            </svg>
            <span class="branch-name">{{ b.name }}</span>
            @if (b.protected) { <span class="badge success">protected</span> }
            @if (b.name === repoInfo()!.default_branch) { <span class="badge info">default</span> }
            <span class="mono sha-tag">{{ b.commit.sha | slice:0:7 }}</span>
          </div>
        }
        @if (!branches().length && !loading()) {
          <div class="empty-panel">No branches found</div>
        }
      </div>

    </div>
  }

</div>
  `,
  styles: [`
.monitor { display: flex; flex-direction: column; gap: 16px; }

.monitor-bar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 12px 16px;
}
.field-inline { flex: 1; min-width: 200px;
  input {
    width: 100%; background: var(--bg-primary); border: 1px solid var(--border);
    border-radius: var(--radius); color: var(--text-primary); padding: 7px 12px;
    font-size: 13px; font-family: 'JetBrains Mono', monospace; outline: none;
    &:focus { border-color: var(--blue-dim); }
  }
}
.bar-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.refresh-time { font-size: 11px; color: var(--text-dim); }
.btn-refresh {
  background: var(--bg-tertiary); color: var(--text-muted); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 6px 14px; font-size: 12px; cursor: pointer;
  &:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  &:disabled { opacity: .4; cursor: not-allowed; }
}
.auto-toggle {
  display: flex; align-items: center; gap: 6px; cursor: pointer; padding: 6px 10px;
  border-radius: var(--radius); border: 1px solid var(--border); font-size: 12px; color: var(--text-muted);
  transition: all .15s;
  &.on { border-color: var(--green-dim); color: var(--green); background: var(--green-bg); }
  &:hover { background: var(--bg-hover); }
}
.toggle-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim);
  .on & { background: var(--green); box-shadow: 0 0 0 0 rgba(63,185,80,.4); animation: pulse-green 1.5s infinite; }
}

.empty-state {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 60px 20px; text-align: center;
  .empty-icon { font-size: 32px; color: var(--text-dim); margin-bottom: 8px; }
  strong { font-size: 15px; color: var(--text-muted); }
  span { font-size: 13px; color: var(--text-dim); }
}

.repo-header {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 14px 16px;
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;
}
.repo-name { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600;
  a { color: var(--text-primary); text-decoration: none; &:hover { color: var(--blue); } }
  svg { color: var(--text-muted); }
}
.repo-badges { display: flex; gap: 6px; flex-wrap: wrap; }

.stats-row {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
}
.stat-card {
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: 16px; display: flex; flex-direction: column; gap: 4px; align-items: center;
}
.stat-val { font-size: 22px; font-weight: 700; font-family: 'JetBrains Mono', monospace;
  &.green { color: var(--green); } &.red { color: var(--red); } &.yellow { color: var(--yellow); }
}
.stat-label { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .5px; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

.panel {
  background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius-lg);
  padding: 16px; display: flex; flex-direction: column; gap: 0;
}
.panel-title {
  display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 600;
  color: var(--text-muted); margin-bottom: 12px; padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

.run-row, .pr-row, .commit-row, .branch-row {
  display: flex; align-items: flex-start; gap: 10px; padding: 9px 0;
  border-bottom: 1px solid var(--border-light);
  &:last-child { border-bottom: none; }
}
.run-body, .pr-body, .commit-body { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.run-top, .pr-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.run-name { font-size: 13px; font-weight: 500; }
.run-meta { font-size: 12px; color: var(--text-muted); display: flex; gap: 6px; flex-wrap: wrap; }
.run-time { font-size: 11px; color: var(--text-dim); }
.ext-link { color: var(--text-dim); font-size: 13px; text-decoration: none; flex-shrink: 0;
  &:hover { color: var(--blue); } }
.pr-num { font-size: 12px; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0; padding-top: 2px; }
.pr-title-link { font-size: 13px; font-weight: 500; color: var(--text-primary); text-decoration: none;
  &:hover { color: var(--blue); } }
.pr-meta { display: flex; gap: 6px; align-items: center; }

.avatar { width: 24px; height: 24px; border-radius: 50%; flex-shrink: 0; }
.avatar-placeholder {
  width: 24px; height: 24px; border-radius: 50%; background: var(--bg-tertiary);
  display: flex; align-items: center; justify-content: center; font-size: 11px;
  color: var(--text-muted); flex-shrink: 0; font-weight: 600; text-transform: uppercase;
}
.commit-msg { font-size: 13px; font-weight: 500; color: var(--text-primary); text-decoration: none;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;
  &:hover { color: var(--blue); } }
.branch-row { align-items: center; padding: 8px 0;
  svg { color: var(--text-dim); flex-shrink: 0; }
}
.branch-name { flex: 1; font-size: 13px; font-weight: 500; }
.sha-tag { color: var(--text-dim); margin-left: auto; }
.empty-panel { color: var(--text-dim); font-size: 13px; padding: 12px 0; text-align: center; }
.pulse { flex-shrink: 0; margin-top: 6px; }
  `]
})
export class MonitorComponent implements OnInit, OnDestroy {
  @Input() token = '';

  repoUrl     = '';
  loading     = signal(false);
  autoRefresh = signal(false);
  lastRefresh = signal('');
  repoInfo    = signal<any>(null);
  ciRuns      = signal<WorkflowRun[]>([]);
  openPRs     = signal<PullRequest[]>([]);
  commits     = signal<Commit[]>([]);
  branches    = signal<Branch[]>([]);

  private sub?: Subscription;

  ngOnInit() {}

  ngOnDestroy() { this.sub?.unsubscribe(); }

  canLoad() { return !!this.repoUrl && !!this.token; }

  onUrlChange() {
    if (this.canLoad()) this.load();
  }

  toggleAuto() {
    this.autoRefresh.update(v => !v);
    this.sub?.unsubscribe();
    if (this.autoRefresh()) {
      this.sub = interval(10000).subscribe(() => this.load());
    }
  }

  load() {
    const parsed = this.gh.parseRepoUrl(this.repoUrl);
    if (!parsed || !this.token) return;
    const { owner, repo } = parsed;
    this.loading.set(true);

    Promise.all([
      this.gh.getRepo(owner, repo, this.token).toPromise().catch(() => null),
      this.gh.getWorkflowRuns(owner, repo, this.token).toPromise().catch(() => ({ workflow_runs: [] })),
      this.gh.getOpenPRs(owner, repo, this.token).toPromise().catch(() => []),
      this.gh.getCommits(owner, repo, 'development', this.token).toPromise().catch(() => []),
      this.gh.getBranches(owner, repo, this.token).toPromise().catch(() => []),
    ]).then(([repo, runs, prs, commits, branches]) => {
      this.repoInfo.set(repo);
      this.ciRuns.set((runs as any)?.workflow_runs || []);
      this.openPRs.set((prs as any) || []);
      this.commits.set((commits as any) || []);
      this.branches.set((branches as any) || []);
      this.lastRefresh.set(new Date().toLocaleTimeString());
      this.loading.set(false);
    });
  }

  latestRunStatus() {
    const r = this.ciRuns()[0];
    if (!r) return '—';
    if (r.status === 'in_progress' || r.status === 'queued') return 'Running';
    return r.conclusion ? r.conclusion.charAt(0).toUpperCase() + r.conclusion.slice(1) : r.status;
  }

  latestRunColor() {
    const r = this.ciRuns()[0];
    if (!r) return '';
    if (r.status === 'in_progress') return 'yellow';
    if (r.conclusion === 'success') return 'green';
    if (r.conclusion === 'failure') return 'red';
    return '';
  }

  hasRunningCI() { return this.ciRuns().some(r => r.status === 'in_progress' || r.status === 'queued'); }

  runPulse(r: WorkflowRun) {
    if (r.status === 'in_progress' || r.status === 'queued') return 'yellow';
    if (r.conclusion === 'success') return 'green';
    if (r.conclusion === 'failure') return 'red';
    return 'gray';
  }

  runBadge(r: WorkflowRun) {
    if (r.status === 'in_progress' || r.status === 'queued') return 'pending';
    if (r.conclusion === 'success') return 'success';
    if (r.conclusion === 'failure') return 'error';
    return 'neutral';
  }

  runLabel(r: WorkflowRun) {
    if (r.status === 'in_progress') return 'Running';
    if (r.status === 'queued') return 'Queued';
    return r.conclusion || r.status;
  }

  constructor(private gh: GithubService) {}
}
