import { Component, Input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GithubService } from '../github.service';

interface Step { label: string; status: 'idle'|'running'|'done'|'error'; detail?: string; }

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="setup fade-in">

  <!-- Inputs -->
  <div class="card">
    <div class="card-title">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      One-Time Repository Setup
    </div>
    <div class="card-sub">Configure your GitHub repo — branch protection, auto-merge, and CI all set automatically.</div>

    <div class="field-row">
      <div class="field">
        <label>GitHub Repo URL</label>
        <input [(ngModel)]="repoUrl" placeholder="https://github.com/username/repo.git"
               [class.error]="urlError" />
        @if (urlError) { <span class="field-error">{{ urlError }}</span> }
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Developer Setup</label>
        <div class="radio-group">
          <label class="radio" [class.active]="devType() === 'solo'" (click)="devType.set('solo')">
            <span class="radio-dot" [class.checked]="devType() === 'solo'"></span>
            <div>
              <strong>Sole Developer</strong>
              <span>No approval required — CI must pass</span>
            </div>
          </label>
          <label class="radio" [class.active]="devType() === 'team'" (click)="devType.set('team')">
            <span class="radio-dot" [class.checked]="devType() === 'team'"></span>
            <div>
              <strong>Team / Manager Reviews</strong>
              <span>1 approval required + CI must pass</span>
            </div>
          </label>
        </div>
      </div>
    </div>

    <button class="btn-primary" [disabled]="running() || !canRun" (click)="runSetup()">
      @if (running()) {
        <span class="spin">⟳</span> Configuring...
      } @else {
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z"/>
        </svg>
        Configure Repository
      }
    </button>
  </div>

  <!-- Progress Steps -->
  @if (steps().length > 0) {
    <div class="card fade-in">
      <div class="card-title">Setup Progress</div>
      <div class="steps">
        @for (step of steps(); track $index) {
          <div class="step" [class]="step.status">
            <div class="step-icon">
              @if (step.status === 'done')    { <span class="icon-done">✓</span> }
              @if (step.status === 'error')   { <span class="icon-error">✕</span> }
              @if (step.status === 'running') { <span class="spin" style="color:var(--blue)">⟳</span> }
              @if (step.status === 'idle')    { <span class="icon-idle">○</span> }
            </div>
            <div class="step-body">
              <span class="step-label">{{ step.label }}</span>
              @if (step.detail) { <span class="step-detail">{{ step.detail }}</span> }
            </div>
          </div>
        }
      </div>
    </div>
  }

  <!-- Result -->
  @if (done()) {
    <div class="card result-card fade-in" [class.result-success]="!hasError()" [class.result-error]="hasError()">
      <div class="result-icon">{{ hasError() ? '✕' : '✓' }}</div>
      <div class="result-body">
        <strong>{{ hasError() ? 'Setup encountered an error' : 'Repository fully configured!' }}</strong>
        <span>{{ hasError() ? 'Check the steps above for details.' : 'Auto-merge enabled · Branch protection set · CI workflow active' }}</span>
      </div>
    </div>
  }

</div>
  `,
  styles: [`
.setup { display: flex; flex-direction: column; gap: 16px; }

.card {
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 20px;
}
.card-title {
  display: flex; align-items: center; gap: 8px;
  font-weight: 600; font-size: 15px; margin-bottom: 4px; color: var(--text-primary);
  svg { color: var(--text-muted); }
}
.card-sub { color: var(--text-muted); margin-bottom: 20px; font-size: 13px; }

.field-row { display: flex; gap: 12px; margin-bottom: 16px; }
.field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
label { font-size: 13px; font-weight: 500; color: var(--text-muted); }
input {
  background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text-primary); padding: 8px 12px; font-size: 13px; outline: none;
  transition: border-color .15s;
  font-family: 'JetBrains Mono', monospace;
  &:focus { border-color: var(--blue-dim); box-shadow: 0 0 0 3px rgba(31,111,235,.15); }
  &.error { border-color: var(--red-dim); }
}
.field-error { color: var(--red); font-size: 12px; }

.radio-group { display: flex; gap: 10px; }
.radio {
  flex: 1; display: flex; align-items: flex-start; gap: 10px; cursor: pointer;
  background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 12px; transition: all .15s;
  &:hover { border-color: var(--bg-hover); }
  &.active { border-color: var(--blue-dim); background: var(--blue-bg); }
  div { display: flex; flex-direction: column; gap: 2px; }
  strong { font-size: 13px; font-weight: 600; }
  span { font-size: 12px; color: var(--text-muted); }
}
.radio-dot {
  width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--border);
  flex-shrink: 0; margin-top: 1px; transition: all .15s;
  &.checked { border-color: var(--blue); background: var(--blue); box-shadow: inset 0 0 0 3px var(--bg-primary); }
}

.btn-primary {
  display: inline-flex; align-items: center; gap: 7px; margin-top: 4px;
  background: var(--green-dim); color: #fff; border: none; border-radius: var(--radius);
  padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s;
  &:hover:not(:disabled) { background: var(--green); }
  &:disabled { opacity: .5; cursor: not-allowed; }
}

.steps { display: flex; flex-direction: column; gap: 0; }
.step {
  display: flex; align-items: flex-start; gap: 12px; padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  &:last-child { border-bottom: none; }
  &.done .step-label   { color: var(--text-primary); }
  &.error .step-label  { color: var(--red); }
  &.running .step-label{ color: var(--blue); }
  &.idle .step-label   { color: var(--text-dim); }
}
.step-icon { width: 20px; text-align: center; padding-top: 1px; flex-shrink: 0; font-size: 13px; }
.icon-done  { color: var(--green); }
.icon-error { color: var(--red); }
.icon-idle  { color: var(--text-dim); }
.step-body  { display: flex; flex-direction: column; gap: 2px; }
.step-label { font-size: 13px; font-weight: 500; }
.step-detail{ font-size: 12px; color: var(--text-muted); font-family: 'JetBrains Mono', monospace; }

.result-card {
  display: flex; align-items: center; gap: 14px;
  &.result-success { border-color: var(--green-dim); background: var(--green-bg); }
  &.result-error   { border-color: var(--red-dim);   background: var(--red-bg); }
}
.result-icon { font-size: 22px; }
.result-success .result-icon { color: var(--green); }
.result-error   .result-icon { color: var(--red); }
.result-body { display: flex; flex-direction: column; gap: 2px;
  strong { font-size: 14px; }
  span   { font-size: 12px; color: var(--text-muted); }
}
  `]
})
export class SetupComponent {
  @Input() token = '';

  repoUrl = '';
  devType  = signal<'solo'|'team'>('solo');
  running  = signal(false);
  done     = signal(false);
  steps    = signal<Step[]>([]);

  // Effective token: prefer parent-supplied, fall back to server config
  private serverToken = signal('');
  get effectiveToken(): string { return this.token || this.serverToken(); }

  get urlError(): string {
    if (!this.repoUrl) return '';
    return this.gh.parseRepoUrl(this.repoUrl) ? '' : 'Invalid GitHub URL';
  }

  get canRun(): boolean {
    return !!this.repoUrl && !this.urlError && !!this.effectiveToken;
  }

  hasError = computed(() => this.steps().some(s => s.status === 'error'));

  constructor(private gh: GithubService) {
    // Load token directly from server config so button works even before
    // the parent app finishes its own fetch
    fetch('http://localhost:3001/api/config')
      .then(r => r.json())
      .then(cfg => { if (cfg.githubToken) this.serverToken.set(cfg.githubToken); })
      .catch(() => {});
  }

  async runSetup() {
    const parsed = this.gh.parseRepoUrl(this.repoUrl);
    if (!parsed) return;
    const { owner, repo } = parsed;

    this.running.set(true);
    this.done.set(false);
    this.steps.set([
      { label: 'Verifying repository access',          status: 'idle' },
      { label: 'Creating main & development branches', status: 'idle' },
      { label: 'Adding CI workflow (Build check)',     status: 'idle' },
      { label: 'Enabling auto-merge on repository',   status: 'idle' },
      { label: 'Configuring branch protection',       status: 'idle' },
      { label: 'Verifying final configuration',       status: 'idle' },
    ]);

    const setStep = (i: number, status: Step['status'], detail?: string) => {
      this.steps.update(s => s.map((x, idx) => idx === i ? { ...x, status, detail } : x));
    };

    try {
      // Step 0 — verify repo
      setStep(0, 'running');
      const repoInfo = await this.gh.getRepo(owner, repo, this.effectiveToken).toPromise();
      setStep(0, 'done', `${repoInfo!.full_name} · ${repoInfo!.visibility}`);

      // Step 1 — create branches if repo is empty
      setStep(1, 'running');
      let mainSha: string | null = null;

      // Try to get main branch SHA
      mainSha = await this.gh.getBranchSha(owner, repo, 'main', this.effectiveToken).toPromise() ?? null;
      if (!mainSha) {
        // Repo is empty — create initial commit which establishes main
        const created = await this.gh.createInitialCommit(owner, repo, this.effectiveToken).toPromise();
        mainSha = created!.commit.sha;
      }

      // Create development branch if it doesn't exist
      const devRef = await this.gh.getBranchSha(owner, repo, 'development', this.effectiveToken).toPromise();
      if (!devRef) {
        await this.gh.createBranch(owner, repo, 'development', mainSha!, this.effectiveToken).toPromise();
        setStep(1, 'done', 'main ✓  development ✓  (created)');
      } else {
        setStep(1, 'done', 'main ✓  development ✓  (already existed)');
      }

      // Step 2 — push CI workflow file so the "Build" check can run
      setStep(2, 'running');
      await this.gh.createWorkflowFile(owner, repo, this.effectiveToken).toPromise();
      setStep(2, 'done', '.github/workflows/build.yml ✓');

      // Step 3 — enable auto-merge
      setStep(3, 'running');
      await this.gh.enableAutoMerge(owner, repo, this.effectiveToken).toPromise();
      setStep(3, 'done', 'allow_auto_merge: true · allow_merge_commit: true');

      // Step 4 — branch protection on main
      setStep(4, 'running');
      await this.gh.setProtection(owner, repo, 'main', this.devType() === 'team', this.effectiveToken).toPromise();
      setStep(4, 'done', this.devType() === 'solo'
        ? 'CI Build required · No approval (sole developer)'
        : 'CI Build required · 1 approval required');

      // Step 5 — verify
      setStep(5, 'running');
      const final = await this.gh.getRepo(owner, repo, this.effectiveToken).toPromise();
      setStep(5, 'done', `auto_merge: ${final!.allow_auto_merge} · default: ${final!.default_branch}`);

    } catch (e: any) {
      const idx = this.steps().findIndex(s => s.status === 'running');
      if (idx >= 0) setStep(idx, 'error', e?.error?.message || e?.message || 'API error');
    }

    this.running.set(false);
    this.done.set(true);
  }
}
