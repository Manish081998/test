import { Component, input, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  Step, StepStatus, PrResult,
  BuildEvent, GitPushEvent, PipelineEvent, PipelineConfig,
} from '../../core/models/pipeline.models';
import { GIT_STEPS, PIPE_STEPS } from '../../core/constants/pipeline.constants';
import { GIT_SERVER_BASE } from '../../core/constants/api.constants';
import { freshSteps } from '../../shared/utils/step.utils';
import { currentTimestamp } from '../../shared/utils/time.utils';
import { GithubApiService } from '../../core/services/github-api.service';
import { GitPushService } from '../../core/services/git-push.service';
import { PipelineService } from '../../core/services/pipeline.service';

interface LogEntry {
  time: string;
  label: string;
  status: StepStatus;
  text: string;
}

@Component({
  selector: 'app-ship',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ship.component.html',
  styleUrl: './ship.component.scss',
})
export class ShipComponent {
  private readonly githubApi   = inject(GithubApiService);
  private readonly gitPushSvc  = inject(GitPushService);
  private readonly pipelineSvc = inject(PipelineService);

  token = input('');

  // ── Config fields ──────────────────────────────────────────────────────
  solutionFolder = localStorage.getItem('git_folder') || '';
  repoUrl        = localStorage.getItem('git_repo')   || '';
  description    = '';
  headBranch     = 'development';
  baseBranch     = 'main';

  // ── Repo dropdown ──────────────────────────────────────────────────────
  repos        = signal<{ full_name: string; clone_url: string }[]>([]);
  reposLoading = signal(false);

  // ── Phase 1 state (git push) ───────────────────────────────────────────
  gitStarted    = signal(false);
  gitRunning    = signal(false);
  gitDone       = signal(false);
  gitSteps      = signal<Step[]>(freshSteps(GIT_STEPS));
  terminalLines = signal<{ type: string; text: string }[]>([]);

  // ── Phase 2 state (GitHub pipeline) ───────────────────────────────────
  pipeStarted = signal(false);
  pipeRunning = signal(false);
  pipeDone    = signal(false);
  pipeSteps   = signal<Step[]>(freshSteps(PIPE_STEPS));
  selectedId  = signal<string | null>(null);
  prResult    = signal<PrResult | null>(null);

  // ── Shared log ─────────────────────────────────────────────────────────
  log = signal<LogEntry[]>([]);

  // ── Server health ──────────────────────────────────────────────────────
  serverOnline = signal(true);

  anyRunning     = computed(() => this.gitRunning() || this.pipeRunning());
  gitHasError    = computed(() => this.gitSteps().some(s => s.status === 'error'));
  pipeHasError   = computed(() => this.pipeSteps().some(s => s.status === 'error'));
  failedPipeStep = computed(() => this.pipeSteps().find(s => s.status === 'error')?.label ?? '');
  gitProgress    = computed(() => {
    const s = this.gitSteps();
    return Math.round(
      s.filter(x => x.status === 'done' || x.status === 'skipped' || x.status === 'error').length /
      s.length * 100);
  });
  pipeProgress   = computed(() => {
    const s = this.pipeSteps();
    return Math.round(
      s.filter(x => x.status === 'done' || x.status === 'skipped' || x.status === 'error').length /
      s.length * 100);
  });

  activeDetail = computed<Step | null>(() => {
    const all = this.pipeSteps();
    if (this.selectedId()) return all.find(s => s.id === this.selectedId()) ?? null;
    return (
      all.find(s => s.status === 'running') ??
      all.filter(s => s.status === 'error').at(-1) ??
      all.filter(s => s.status === 'done').at(-1) ??
      null
    );
  });

  constructor() {
    this.checkServer();
    effect(() => {
      const t = this.token();
      if (!t) return;
      this.reposLoading.set(true);
      this.githubApi.getUserRepos(t).subscribe({
        next:  rs => {
          this.repos.set(rs.map(r => ({ full_name: r.full_name, clone_url: r.clone_url })));
          this.reposLoading.set(false);
        },
        error: () => this.reposLoading.set(false),
      });
    });
  }

  async checkServer() {
    try {
      const r = await fetch(`${GIT_SERVER_BASE}/api/health`);
      this.serverOnline.set(r.ok);
    } catch {
      this.serverOnline.set(false);
    }
  }

  selectStep(id: string) {
    this.selectedId.set(this.selectedId() === id ? null : id);
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  private setGitStep(id: string, status: StepStatus, detail = '') {
    const step = this.gitSteps().find(s => s.id === id);
    this.gitSteps.update(ss => ss.map(s => s.id === id ? { ...s, status, detail } : s));
    if (step) this.addLog(step.label, status, detail || step.sublabel);
  }

  private setPipeStep(id: string, status: StepStatus, detail = '') {
    const step = this.pipeSteps().find(s => s.id === id);
    this.pipeSteps.update(ss => ss.map(s => s.id === id ? { ...s, status, detail } : s));
    if (step) this.addLog(step.label, status, detail || step.sublabel);
  }

  private addLog(label: string, status: StepStatus, text: string) {
    this.log.update(l => [...l, { time: currentTimestamp(), label, status, text }]);
  }

  private addTerminal(type: string, text: string) {
    this.terminalLines.update(l => [...l, { type, text }]);
  }

  resetAll() {
    this.gitStarted.set(false);  this.gitRunning.set(false);  this.gitDone.set(false);
    this.pipeStarted.set(false); this.pipeRunning.set(false); this.pipeDone.set(false);
    this.gitSteps.set(freshSteps(GIT_STEPS));
    this.pipeSteps.set(freshSteps(PIPE_STEPS));
    this.terminalLines.set([]);
    this.log.set([]);
    this.prResult.set(null);
    this.selectedId.set(null);
  }

  // ══ ENTRY POINT ════════════════════════════════════════════════════════
  runAll() {
    localStorage.setItem('git_folder', this.solutionFolder);
    localStorage.setItem('git_repo',   this.repoUrl);
    this.resetAll();

    this.gitStarted.set(true);
    this.gitRunning.set(true);
    this.setGitStep('build', 'running');

    this.gitPushSvc.streamBuild(this.solutionFolder).subscribe({
      next:     evt => this.handleBuildEvent(evt),
      error:    ()  => { this.gitRunning.set(false); },
      complete: ()  => {
        if (this.gitSteps().find(s => s.id === 'build')?.status === 'done') {
          this.startGitPush();
        } else {
          this.gitRunning.set(false);
        }
      },
    });
  }

  private startGitPush() {
    const message = this.description.trim() || `Update ${this.headBranch}`;
    this.gitPushSvc.streamGitPush(this.solutionFolder, this.headBranch, message, this.repoUrl).subscribe({
      next:     evt => this.handleGitPushEvent(evt),
      error:    ()  => { this.gitRunning.set(false); },
      complete: ()  => {
        this.gitRunning.set(false);
        this.gitDone.set(true);
        const allOk = this.gitSteps().every(s => s.status === 'done' || s.status === 'skipped');
        if (allOk) this.startPipeline();
      },
    });
  }

  private startPipeline() {
    const parsed = this.githubApi.parseRepoUrl(this.repoUrl);
    this.pipeStarted.set(true);
    this.pipeRunning.set(true);

    if (!parsed) {
      this.setPipeStep('validate', 'error', 'Invalid GitHub URL');
      this.pipeRunning.set(false); this.pipeDone.set(true); return;
    }

    const cfg: PipelineConfig = {
      owner:      parsed.owner,
      repo:       parsed.repo,
      token:      this.token(),
      headBranch: this.headBranch,
      baseBranch: this.baseBranch,
      description: this.description,
    };

    this.pipelineSvc.run(cfg).subscribe({
      next:     evt => this.handlePipelineEvent(evt),
      error:    ()  => { this.pipeRunning.set(false); this.pipeDone.set(true); },
      complete: ()  => { this.pipeRunning.set(false); this.pipeDone.set(true); },
    });
  }

  // ── Event handlers ──────────────────────────────────────────────────────
  private handleBuildEvent(evt: BuildEvent) {
    switch (evt.type) {
      case 'stdout':      this.addTerminal('tl-stdout', evt.text.trimEnd()); break;
      case 'stderr':      this.addTerminal('tl-stderr', evt.text.trimEnd()); break;
      case 'build-done':  this.setGitStep('build', 'done',  'Build succeeded'); break;
      case 'build-fatal': this.setGitStep('build', 'error', evt.text);          break;
    }
  }

  private handleGitPushEvent(evt: GitPushEvent) {
    switch (evt.type) {
      case 'step-start':
        this.setGitStep(evt.id, 'running');
        this.addTerminal('tl-cmd', `$ git ${evt.cmd.replace('git ', '')}`);
        break;
      case 'stdout':   this.addTerminal('tl-stdout', evt.text.trimEnd()); break;
      case 'stderr':   this.addTerminal('tl-stderr', evt.text.trimEnd()); break;
      case 'step-end':
        this.setGitStep(evt.id, evt.ok ? 'done' : 'error',
          evt.noop ? 'Nothing to commit — already up to date' : '');
        break;
      case 'fatal':    this.setGitStep(evt.id, 'error', evt.text); break;
      case 'git-done': break;
    }
  }

  private handlePipelineEvent(evt: PipelineEvent) {
    switch (evt.type) {
      case 'step-start':   this.setPipeStep(evt.id, 'running');          break;
      case 'step-running': this.setPipeStep(evt.id, 'running', evt.detail); break;
      case 'step-done':    this.setPipeStep(evt.id, 'done',    evt.detail); break;
      case 'step-skipped': this.setPipeStep(evt.id, 'skipped', evt.detail); break;
      case 'step-error':   this.setPipeStep(evt.id, 'error',   evt.detail); break;
      case 'pr-result':    this.prResult.set(evt.prResult);               break;
      case 'complete':     break;
    }
  }
}
