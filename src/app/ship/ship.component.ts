import { Component, input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { GithubService } from '../github.service';

// ── Types ──────────────────────────────────────────────────────────────────
export type StepStatus = 'idle' | 'running' | 'done' | 'error' | 'skipped';

export interface Step {
  id: string;
  label: string;
  sublabel: string;
  status: StepStatus;
  detail: string;
}

interface LogEntry {
  time: string;
  label: string;
  status: StepStatus;
  text: string;
}

// ── Git push steps (6 — build gates the push) ─────────────────────────────
const GIT_STEPS: Omit<Step, 'status' | 'detail'>[] = [
  { id: 'build',    label: 'Build Solution',  sublabel: 'dotnet build — must pass before push' },
  { id: 'checkout', label: 'Checkout Branch', sublabel: 'Switch to source branch'              },
  { id: 'add',      label: 'Stage Changes',   sublabel: 'git add . — all files'               },
  { id: 'status',   label: 'Show Status',     sublabel: 'Confirm staged files'                },
  { id: 'commit',   label: 'Commit',          sublabel: 'Save snapshot with message'          },
  { id: 'push',     label: 'Push to GitHub',  sublabel: 'Upload to remote branch'             },
];

// ── GitHub pipeline steps (6) ──────────────────────────────────────────────
const PIPE_STEPS: Omit<Step, 'status' | 'detail'>[] = [
  { id: 'validate',   label: 'Validate Repo',  sublabel: 'Check token & repo access'     },
  { id: 'branches',   label: 'Check Branches', sublabel: 'Verify source & target exist'  },
  { id: 'check-pr',   label: 'Detect PR',      sublabel: 'Find open pull request'        },
  { id: 'create-pr',  label: 'Create PR',      sublabel: 'Open or reuse pull request'    },
  { id: 'auto-merge', label: 'Auto-merge',     sublabel: 'Enable merge on CI pass'       },
  { id: 'monitor-ci', label: 'Monitor CI',     sublabel: 'Poll GitHub Actions status'    },
  { id: 'pr-merge',   label: 'PR Merged',      sublabel: 'Confirm merge into target branch' },
];

function fresh(defs: Omit<Step, 'status' | 'detail'>[]): Step[] {
  return defs.map(d => ({ ...d, status: 'idle', detail: '' }));
}

function ts(): string {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

@Component({
  selector: 'app-ship',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="ship fade-in">

  <!-- ══ CONFIG ══════════════════════════════════════════════════════════ -->
  <div class="card cfg-card">
    <div class="cfg-top">
      <div class="card-title">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8.878.392a1.75 1.75 0 00-1.756 0l-5.25 3.045A1.75 1.75 0 001 4.951v6.098c0 .624.332 1.2.872 1.514l5.25 3.045a1.75 1.75 0 001.756 0l5.25-3.045c.54-.313.872-.89.872-1.514V4.951c0-.624-.332-1.2-.872-1.514L8.878.392z"/>
        </svg>
        Deploy Pipeline
      </div>
      <div class="btn-group">
        <button class="btn-primary"
          [disabled]="anyRunning() || !repoUrl || !solutionFolder || !description"
          (click)="runAll()">
          @if (anyRunning()) { <span class="spin">⟳</span> Running… }
          @else {
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M1.5 8a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0zM8 0a8 8 0 100 16A8 8 0 008 0zM6.379 5.227A.25.25 0 006 5.442v5.117a.25.25 0 00.379.214l4.264-2.559a.25.25 0 000-.428L6.379 5.227z"/>
            </svg>
            Push &amp; Ship
          }
        </button>
        @if ((gitDone() || pipeDone()) && !anyRunning()) {
          <button class="btn-ghost" (click)="resetAll()">↺ Reset</button>
        }
      </div>
    </div>

    <div class="cfg-grid">
      <div class="field span2">
        <label>Solution Folder <span class="hint">(where your .NET project lives)</span></label>
        <input [(ngModel)]="solutionFolder" [disabled]="anyRunning()"
          placeholder="c:\Users\you\Projects\ClaudeDotNetCoreAPIExample" />
      </div>
      <div class="field span2">
        <label>Repository URL</label>
        <input [(ngModel)]="repoUrl" [disabled]="anyRunning()"
          placeholder="https://github.com/username/repo.git" />
      </div>
      <div class="field span4">
        <label>What did you change? <span class="hint">(becomes commit message &amp; PR title)</span></label>
        <input [(ngModel)]="description" [disabled]="anyRunning()"
          placeholder="e.g. Added InsertTicket POST endpoint with DTOs, service, and repository layers" />
      </div>
      <div class="field">
        <label>Source branch</label>
        <input [(ngModel)]="headBranch" placeholder="development" [disabled]="anyRunning()" />
      </div>
      <div class="field">
        <label>Target branch</label>
        <input [(ngModel)]="baseBranch" placeholder="main" [disabled]="anyRunning()" />
      </div>
    </div>

    @if (!serverOnline()) {
      <div class="server-warn">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z"/>
        </svg>
        Git server not running — start it with <span class="mono-hi">npm start</span> in the GitWeb folder, then refresh.
      </div>
    }
  </div>

  <!-- ══ PHASE 1: PUSH TO DEVELOPMENT ════════════════════════════════════ -->
  @if (gitStarted()) {
    <div class="card chart-card fade-in">
      <div class="chart-header">
        <span class="chart-title phase-label">
          <span class="phase-num">1</span> Push to Development
        </span>
        <div class="chart-badges">
          @if (gitRunning()) {
            <span class="badge info"><span class="pdot blue"></span> Running</span>
          } @else if (gitHasError()) {
            <span class="badge error"><span class="pdot red"></span> Failed</span>
          } @else if (gitDone()) {
            <span class="badge success"><span class="pdot green"></span> Pushed</span>
          }
        </div>
      </div>
      <div class="phase-track">
        <div class="phase-fill" [class.fill-done]="gitDone()" [class.fill-err]="gitHasError()" [style.width.%]="gitProgress()"></div>
      </div>

      <div class="pipeline-row">
        @for (step of gitSteps(); track step.id; let last = $last) {
          <div class="node" [class]="'node-' + step.status">
            <div class="node-scan"></div>
            <div class="node-top">
              <span class="node-num">{{ $index + 1 }}</span>
              <ng-container *ngTemplateOutlet="iconTpl; context: { $implicit: step.status }"></ng-container>
            </div>
            <div class="node-label">{{ step.label }}</div>
            <div class="node-sublabel">{{ step.sublabel }}</div>
            <div class="node-badge" [class]="'nb-' + step.status">{{ step.status | uppercase }}</div>
          </div>
          @if (!last) { <div class="connector" [class]="'conn-' + step.status">
            <div class="conn-line"></div>
            <svg class="conn-arrow" width="7" height="11" viewBox="0 0 7 11"><path d="M0 0l7 5.5L0 11V0z" fill="currentColor"/></svg>
          </div> }
        }
      </div>

    </div>
  }

  <!-- ══ PHASE 2: GITHUB PIPELINE ════════════════════════════════════════ -->
  @if (pipeStarted()) {
    <div class="card chart-card fade-in">
      <div class="chart-header">
        <span class="chart-title phase-label">
          <span class="phase-num">2</span> GitHub Pipeline
        </span>
        <div class="chart-badges">
          @if (pipeRunning()) {
            <span class="badge info"><span class="pdot blue"></span> Running</span>
          } @else if (pipeHasError()) {
            <span class="badge error"><span class="pdot red"></span> Failed at {{ failedPipeStep() }}</span>
          } @else if (pipeDone()) {
            <span class="badge success"><span class="pdot green"></span> Complete</span>
          }
        </div>
      </div>
      <div class="phase-track">
        <div class="phase-fill" [class.fill-done]="pipeDone()" [class.fill-err]="pipeHasError()" [style.width.%]="pipeProgress()"></div>
      </div>

      <div class="pipeline-row">
        @for (step of pipeSteps(); track step.id; let last = $last) {
          <div class="node" [class]="'node-' + step.status" (click)="selectStep(step.id)">
            <div class="node-scan"></div>
            <div class="node-top">
              <span class="node-num">{{ $index + 1 }}</span>
              <ng-container *ngTemplateOutlet="iconTpl; context: { $implicit: step.status }"></ng-container>
            </div>
            <div class="node-label">{{ step.label }}</div>
            <div class="node-sublabel">{{ step.sublabel }}</div>
            <div class="node-badge" [class]="'nb-' + step.status">{{ step.status | uppercase }}</div>
          </div>
          @if (!last) { <div class="connector" [class]="'conn-' + step.status">
            <div class="conn-line"></div>
            <svg class="conn-arrow" width="7" height="11" viewBox="0 0 7 11"><path d="M0 0l7 5.5L0 11V0z" fill="currentColor"/></svg>
          </div> }
        }
      </div>

      <!-- Detail panel -->
      @if (activeDetail(); as s) {
        <div class="detail-panel" [class]="'dp-' + s.status">
          <span class="dp-name">{{ s.label }}</span>
          <span class="dp-sep">·</span>
          <span class="dp-status">{{ s.status }}</span>
          @if (s.detail) { <span class="dp-text mono-inline">{{ s.detail }}</span> }
        </div>
      }
    </div>
  }


  <!-- ══ PR RESULT ════════════════════════════════════════════════════════ -->
  @if (prResult()) {
    <div class="card pr-card fade-in">
      <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" class="pr-svg">
        <path fill-rule="evenodd" d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
      </svg>
      <div class="pr-body">
        <div class="pr-title-row">
          <strong>{{ prResult()!.title }}</strong>
          <span class="badge" [class]="prResult()!.status === 'created' ? 'success' : 'info'">
            {{ prResult()!.status === 'created' ? 'PR Created' : 'PR Found' }}
          </span>
          <span class="badge success">auto-merge on</span>
          <span class="badge neutral">{{ headBranch }} → {{ baseBranch }}</span>
        </div>
        <a [href]="prResult()!.url" target="_blank" class="pr-link">{{ prResult()!.url }}</a>
      </div>
    </div>
  }

</div>

<!-- ── Shared icon template ───────────────────────────────────────────── -->
<ng-template #iconTpl let-status>
  @if (status === 'running') { <span class="spin ni blue">⟳</span> }
  @else if (status === 'done') {
    <svg class="ni green" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path fill-rule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 111.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
    </svg>
  } @else if (status === 'error') {
    <svg class="ni red" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path fill-rule="evenodd" d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/>
    </svg>
  } @else if (status === 'skipped') {
    <svg class="ni muted" width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path fill-rule="evenodd" d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z"/>
    </svg>
  } @else { <span class="idle-dot"></span> }
</ng-template>
  `,
  styles: [`

/* ══ Layout ══════════════════════════════════════════════════════════════ */
.ship { display: flex; flex-direction: column; gap: 14px; }

.card {
  background: rgba(13, 17, 23, 0.97);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px;
  padding: 20px;
}

/* ══ Config card ════════════════════════════════════════════════════════ */
.cfg-card { display: flex; flex-direction: column; gap: 16px; }
.cfg-top  { display: flex; align-items: center; justify-content: space-between; }
.card-title {
  display: flex; align-items: center; gap: 9px;
  font-weight: 600; font-size: 14px; color: var(--text-primary); letter-spacing: -.1px;
  svg { color: rgba(139,148,158,.45); }
}
.btn-group { display: flex; gap: 8px; }

.cfg-grid {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 12px; align-items: end;
}
.span2 { grid-column: span 2; }
.span4 { grid-column: span 4; }

.field { display: flex; flex-direction: column; gap: 5px; }
label { font-size: 11px; font-weight: 600; color: rgba(139,148,158,.7); letter-spacing: .2px; text-transform: uppercase; }
.hint { font-weight: 400; text-transform: none; color: rgba(139,148,158,.4); }
input {
  background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08);
  border-radius: 8px; color: var(--text-primary);
  padding: 8px 12px; font-size: 12.5px; outline: none;
  font-family: 'JetBrains Mono', monospace; width: 100%;
  transition: border-color .15s, box-shadow .15s;
  &:focus { border-color: rgba(56,139,253,.5); box-shadow: 0 0 0 3px rgba(31,111,235,.1); }
  &:disabled { opacity: .35; cursor: not-allowed; }
  &::placeholder { color: rgba(139,148,158,.25); }
}

/* Buttons */
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  background: linear-gradient(160deg, #1f8a38, #1a7f37);
  color: #fff; border: 1px solid rgba(63,185,80,.25);
  border-radius: 8px; padding: 9px 20px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  transition: all .2s cubic-bezier(.4,0,.2,1); white-space: nowrap;
  box-shadow: 0 1px 0 rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.06);
  &:hover:not(:disabled) {
    background: linear-gradient(160deg, #238636, #2ea043);
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(35,134,54,.28), inset 0 1px 0 rgba(255,255,255,.08);
  }
  &:active:not(:disabled) { transform: translateY(0); }
  &:disabled { opacity: .3; cursor: not-allowed; transform: none; }
}
.btn-ghost {
  background: rgba(255,255,255,.04); color: rgba(139,148,158,.8);
  border: 1px solid rgba(255,255,255,.08); border-radius: 8px;
  padding: 8px 14px; font-size: 12.5px; cursor: pointer; white-space: nowrap;
  transition: all .15s;
  &:hover { background: rgba(255,255,255,.08); color: var(--text-primary); }
}

/* Server warning */
.server-warn {
  display: flex; align-items: center; gap: 8px;
  background: rgba(187,128,9,.07); border: 1px solid rgba(187,128,9,.2);
  border-radius: 8px; padding: 10px 14px;
  font-size: 12px; color: rgba(210,153,34,.9);
  svg { flex-shrink: 0; }
}
.mono-hi {
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  background: rgba(187,128,9,.12); padding: 1px 6px; border-radius: 4px;
}

/* ══ Chart card ════════════════════════════════════════════════════════ */
.chart-card { padding: 18px 20px 0; overflow: hidden; }

.chart-header {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 0;
}
.chart-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; color: rgba(139,148,158,.75); letter-spacing: .2px;
}
.phase-label { gap: 10px; }
.phase-num {
  display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.09);
  font-size: 10px; font-weight: 700; color: rgba(139,148,158,.55);
  font-family: 'JetBrains Mono', monospace;
}
.chart-badges { display: flex; gap: 6px; }

/* Phase progress track */
.phase-track {
  height: 1.5px; background: rgba(255,255,255,.05);
  border-radius: 2px; margin: 12px 0 18px; overflow: hidden;
}
.phase-fill {
  height: 100%; background: rgba(56,139,253,.55);
  border-radius: 2px; transition: width .7s cubic-bezier(.4,0,.2,1);
}
.fill-done { background: rgba(63,185,80,.65) !important; }
.fill-err  { background: rgba(248,81,73,.55) !important; }

/* ══ Pipeline row ════════════════════════════════════════════════════ */
.pipeline-row {
  display: flex; align-items: stretch; overflow-x: auto; padding-bottom: 18px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.08) transparent;
}

/* ══ Node ════════════════════════════════════════════════════════════ */
.node {
  flex: 1; min-width: 108px; max-width: 158px;
  border-radius: 10px; padding: 14px 11px 11px;
  display: flex; flex-direction: column; gap: 4px;
  cursor: pointer; position: relative; overflow: hidden;
  border: 1px solid rgba(255,255,255,.06);
  background: rgba(22, 27, 34, 0.85);
  transition: border-color .2s ease, background .2s ease, box-shadow .2s ease;
  &:hover { border-color: rgba(255,255,255,.13); }
}

/* Scan line — top accent that animates when running */
.node-scan {
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: rgba(255,255,255,.04); transition: background .3s;
}
.node-running .node-scan {
  background: linear-gradient(90deg, transparent 0%, #388bfd 50%, transparent 100%);
  background-size: 200% 100%;
  animation: scan 1.8s ease-in-out infinite;
}
.node-done    .node-scan { background: linear-gradient(90deg, #3fb950, rgba(63,185,80,.25)); }
.node-error   .node-scan { background: #f85149; }
.node-skipped .node-scan { background: rgba(255,255,255,.04); }

@keyframes scan {
  0%   { background-position: -100% 0; }
  100% { background-position: 200% 0; }
}

/* Node state backgrounds */
.node-idle    { }
.node-running {
  border-color: rgba(56,139,253,.3);
  background: rgba(31,111,235,.06);
  box-shadow: 0 0 24px rgba(31,111,235,.07);
}
.node-done    { border-color: rgba(63,185,80,.28); background: rgba(35,134,54,.05); }
.node-error   {
  border-color: rgba(248,81,73,.32); background: rgba(218,54,51,.07);
  box-shadow: 0 0 18px rgba(248,81,73,.06);
}
.node-skipped { border-color: rgba(255,255,255,.05); opacity: .6; }

.node-top {
  display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;
}
.node-num {
  width: 18px; height: 18px; border-radius: 50%;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08);
  font-size: 9px; font-weight: 700; color: rgba(139,148,158,.5);
  display: flex; align-items: center; justify-content: center;
  font-family: 'JetBrains Mono', monospace;
}
.node-running .node-num { border-color: rgba(56,139,253,.4);  color: #388bfd; background: rgba(56,139,253,.12); }
.node-done    .node-num { border-color: rgba(63,185,80,.4);   color: #3fb950; background: rgba(35,134,54,.14); }
.node-error   .node-num { border-color: rgba(248,81,73,.4);   color: #f85149; background: rgba(218,54,51,.14); }

.node-label   { font-size: 11.5px; font-weight: 700; color: rgba(139,148,158,.6); line-height: 1.2; }
.node-sublabel{ font-size: 10px;   color: rgba(139,148,158,.38); line-height: 1.3; }
.node-running .node-label { color: var(--text-primary); }
.node-done    .node-label { color: var(--text-primary); }
.node-error   .node-label { color: #f85149; }

/* Status chip */
.node-badge {
  margin-top: 7px; font-size: 9px; font-weight: 700; letter-spacing: .8px;
  padding: 2px 7px; border-radius: 20px; width: fit-content; border: 1px solid;
}
.nb-idle    { color: rgba(139,148,158,.35); background: transparent;            border-color: rgba(255,255,255,.05); }
.nb-running { color: #388bfd;               background: rgba(56,139,253,.1);    border-color: rgba(56,139,253,.22); }
.nb-done    { color: #3fb950;               background: rgba(63,185,80,.1);     border-color: rgba(63,185,80,.22); }
.nb-error   { color: #f85149;               background: rgba(248,81,73,.1);     border-color: rgba(248,81,73,.22); }
.nb-skipped { color: rgba(139,148,158,.35); background: transparent;            border-color: rgba(255,255,255,.05); }

/* Icons */
.ni       { display: block; }
.ni.green { color: #3fb950; }
.ni.blue  { color: #388bfd; font-size: 14px; }
.ni.red   { color: #f85149; }
.ni.muted { color: rgba(139,148,158,.35); }
.idle-dot { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,.1); display: block; }

/* ══ Connector ════════════════════════════════════════════════════════ */
.connector  { display: flex; align-items: center; flex-shrink: 0; width: 20px; }
.conn-line  { height: 1px; flex: 1; background: rgba(255,255,255,.08); transition: background .5s; }
.conn-arrow { color: rgba(255,255,255,.12); flex-shrink: 0; transition: color .5s; }
.conn-done    .conn-line  { background: rgba(63,185,80,.35); }
.conn-done    .conn-arrow { color: rgba(63,185,80,.45); }
.conn-running .conn-line  { background: rgba(56,139,253,.3); }
.conn-running .conn-arrow { color: rgba(56,139,253,.4); }
.conn-error   .conn-line  { background: rgba(248,81,73,.3); }
.conn-error   .conn-arrow { color: rgba(248,81,73,.4); }

/* ══ Detail panel ═════════════════════════════════════════════════════ */
.detail-panel {
  margin: 0 -20px; border-top: 1px solid rgba(255,255,255,.05);
  padding: 10px 20px; background: rgba(0,0,0,.25);
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  font-size: 11.5px; min-height: 38px;
}
.dp-running { border-top-color: rgba(56,139,253,.2); }
.dp-done    { border-top-color: rgba(63,185,80,.2); }
.dp-error   { border-top-color: rgba(248,81,73,.2); }
.dp-name    { font-weight: 700; color: var(--text-primary); }
.dp-sep     { color: rgba(255,255,255,.12); }
.dp-status  { color: rgba(139,148,158,.55); text-transform: capitalize; }
.dp-text    { color: rgba(139,148,158,.65); word-break: break-all; font-family: 'JetBrains Mono', monospace; font-size: 11px; }

/* ══ Badges ═══════════════════════════════════════════════════════════ */
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 20px;
  font-size: 11px; font-weight: 600; letter-spacing: .15px; border: 1px solid;
}
.badge.success { color: #3fb950; background: rgba(63,185,80,.1);  border-color: rgba(63,185,80,.2); }
.badge.info    { color: #388bfd; background: rgba(56,139,253,.1); border-color: rgba(56,139,253,.2); }
.badge.error   { color: #f85149; background: rgba(248,81,73,.1);  border-color: rgba(248,81,73,.2); }
.badge.neutral { color: rgba(139,148,158,.75); background: rgba(255,255,255,.04); border-color: rgba(255,255,255,.08); }

/* ══ PR card ══════════════════════════════════════════════════════════ */
.pr-card {
  border-color: rgba(63,185,80,.18); background: rgba(35,134,54,.04);
  display: flex; gap: 14px; align-items: flex-start;
}
.pr-svg { color: #a371f7; flex-shrink: 0; margin-top: 2px; }
.pr-body { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.pr-title-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; strong { font-size: 13px; color: var(--text-primary); } }
.pr-link {
  color: #388bfd; font-size: 11.5px; font-family: 'JetBrains Mono', monospace;
  text-decoration: none; word-break: break-all; opacity: .75;
  &:hover { opacity: 1; text-decoration: underline; }
}

/* ══ Pulse dots ═══════════════════════════════════════════════════════ */
.pdot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.pdot.blue  { background: #388bfd; animation: pb 1.4s infinite; }
.pdot.green { background: #3fb950; animation: pg 1.4s infinite; }
.pdot.red   { background: #f85149; }
@keyframes pb { 0%,100% { box-shadow: 0 0 0 0 rgba(88,166,255,.5); } 50% { box-shadow: 0 0 0 4px rgba(88,166,255,0); } }
@keyframes pg { 0%,100% { box-shadow: 0 0 0 0 rgba(63,185,80,.5);  } 50% { box-shadow: 0 0 0 4px rgba(63,185,80,0); } }

/* ══ Utilities ════════════════════════════════════════════════════════ */
.mono-inline { font-family: 'JetBrains Mono', monospace; font-size: 11px; }
.spin        { display: inline-block; animation: sp .8s linear infinite; }
@keyframes sp { to { transform: rotate(360deg); } }
@keyframes fi { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
.fade-in { animation: fi .3s ease; }
  `]
})
export class ShipComponent {
  token = input('');

  // ── Config fields ──────────────────────────────────────────────────────
  solutionFolder = localStorage.getItem('git_folder') || '';
  repoUrl        = localStorage.getItem('git_repo')   || '';
  description    = '';
  headBranch     = 'development';
  baseBranch     = 'main';

  // ── Phase 1 state (git push) ───────────────────────────────────────────
  gitStarted  = signal(false);
  gitRunning  = signal(false);
  gitDone     = signal(false);
  gitSteps    = signal<Step[]>(fresh(GIT_STEPS));
  terminalLines = signal<{ type: string; text: string }[]>([]);

  // ── Phase 2 state (GitHub pipeline) ───────────────────────────────────
  pipeStarted = signal(false);
  pipeRunning = signal(false);
  pipeDone    = signal(false);
  pipeSteps   = signal<Step[]>(fresh(PIPE_STEPS));
  selectedId  = signal<string | null>(null);
  prResult    = signal<{ title: string; url: string; status: 'created' | 'exists'; number: number } | null>(null);

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
    return Math.round(s.filter(x => x.status === 'done' || x.status === 'skipped' || x.status === 'error').length / s.length * 100);
  });
  pipeProgress   = computed(() => {
    const s = this.pipeSteps();
    return Math.round(s.filter(x => x.status === 'done' || x.status === 'skipped' || x.status === 'error').length / s.length * 100);
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

  constructor(private gh: GithubService) {
    this.checkServer();
  }

  async checkServer() {
    try {
      const r = await fetch('http://localhost:3001/api/health');
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
    this.log.update(l => [...l, { time: ts(), label, status, text }]);
  }

  private addTerminal(type: string, text: string) {
    this.terminalLines.update(l => [...l, { type, text }]);
  }

  resetAll() {
    this.gitStarted.set(false);   this.gitRunning.set(false);   this.gitDone.set(false);
    this.pipeStarted.set(false);  this.pipeRunning.set(false);  this.pipeDone.set(false);
    this.gitSteps.set(fresh(GIT_STEPS));
    this.pipeSteps.set(fresh(PIPE_STEPS));
    this.terminalLines.set([]);
    this.log.set([]);
    this.prResult.set(null);
    this.selectedId.set(null);
  }

  // ══ ENTRY POINT ════════════════════════════════════════════════════════
  async runAll() {
    // Persist inputs
    localStorage.setItem('git_folder', this.solutionFolder);
    localStorage.setItem('git_repo',   this.repoUrl);

    this.resetAll();

    // Phase 1: Push
    const pushOk = await this.runGitPush();
    if (!pushOk) return;

    // Phase 2: Pipeline
    await this.runPipeline();
  }

  // ── dotnet build (must pass before any git step) ──────────────────────
  private async runDotnetBuild(): Promise<boolean> {
    this.setGitStep('build', 'running');
    let response: Response;
    try {
      response = await fetch('http://localhost:3001/api/dotnet/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: this.solutionFolder }),
      });
    } catch {
      this.setGitStep('build', 'error', 'Cannot reach server');
      return false;
    }

    const reader  = response.body!.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        let evt: any;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }

        switch (evt.type) {
          case 'stdout': this.addTerminal('tl-stdout', evt.text.trimEnd()); break;
          case 'stderr': this.addTerminal('tl-stderr', evt.text.trimEnd()); break;
          case 'done':
            this.setGitStep('build', 'done', 'Build succeeded');
            return true;
          case 'fatal':
            this.setGitStep('build', 'error', evt.text);
            return false;
        }
      }
    }
    this.setGitStep('build', 'error', 'Build stream ended unexpectedly');
    return false;
  }

  // ══ PHASE 1 — Git Push (via local server) ══════════════════════════════
  private async runGitPush(): Promise<boolean> {
    this.gitStarted.set(true);
    this.gitRunning.set(true);

    // ── Gate: build must succeed before we touch git ──────────────────────
    const buildOk = await this.runDotnetBuild();
    if (!buildOk) {
      this.gitRunning.set(false);
      return false;
    }

    const message = this.description.trim() || `Update ${this.headBranch}`;

    let response: Response;
    try {
      response = await fetch('http://localhost:3001/api/git/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: this.solutionFolder, branch: this.headBranch, message, repoUrl: this.repoUrl }),
      });
    } catch {
      this.addTerminal('tl-info', '✗ Cannot reach git server — make sure you started with: npm start');
      this.serverOnline.set(false);
      this.gitRunning.set(false);
      return false;
    }

    const reader  = response.body!.getReader();
    const decoder = new TextDecoder();
    let   buffer  = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';

      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data: ')) continue;
        let evt: any;
        try { evt = JSON.parse(line.slice(6)); } catch { continue; }

        switch (evt.type) {
          case 'step-start':
            this.setGitStep(evt.id, 'running');
            this.addTerminal('tl-cmd', `$ git ${evt.cmd?.replace('git ', '') ?? ''}`);
            break;
          case 'stdout':
            this.addTerminal('tl-stdout', evt.text.trimEnd());
            break;
          case 'stderr':
            this.addTerminal('tl-stderr', evt.text.trimEnd());
            break;
          case 'step-end':
            this.setGitStep(evt.id, evt.ok ? 'done' : 'error', evt.noop ? 'Nothing to commit — already up to date' : '');
            break;
          case 'fatal':
            this.setGitStep(evt.id, 'error', evt.text);
            this.gitRunning.set(false);
            return false;
          case 'done':
            break;
        }
      }
    }

    this.gitRunning.set(false);
    this.gitDone.set(true);

    const allOk = this.gitSteps().every(s => s.status === 'done' || s.status === 'skipped');
    return allOk;
  }

  // ══ PHASE 2 — GitHub Pipeline ══════════════════════════════════════════
  private async runPipeline() {
    const parsed = this.gh.parseRepoUrl(this.repoUrl);
    this.pipeStarted.set(true);
    this.pipeRunning.set(true);

    if (!parsed) {
      this.setPipeStep('validate', 'error', 'Invalid GitHub URL');
      this.pipeRunning.set(false); this.pipeDone.set(true); return;
    }
    const { owner, repo } = parsed;
    const tok = this.token();

    // 1. Validate
    this.setPipeStep('validate', 'running');
    try {
      const info = await firstValueFrom(this.gh.getRepo(owner, repo, tok)) as any;
      this.setPipeStep('validate', 'done', `${info.full_name}  ·  ${info.visibility}  ·  default: ${info.default_branch}`);
    } catch (e: any) {
      this.setPipeStep('validate', 'error', e?.error?.message || 'Cannot access repository — check token');
      this.pipeRunning.set(false); this.pipeDone.set(true); return;
    }

    // 2. Branches
    this.setPipeStep('branches', 'running');
    try {
      const branches = await firstValueFrom(this.gh.getBranches(owner, repo, tok)) as any[];
      const hasHead  = branches?.some(b => b.name === this.headBranch);
      const hasBase  = branches?.some(b => b.name === this.baseBranch);
      if (!hasHead || !hasBase) {
        const missing = [!hasHead && this.headBranch, !hasBase && this.baseBranch].filter(Boolean).join(', ');
        this.setPipeStep('branches', 'error', `Branch(es) not found: ${missing}`);
        this.pipeRunning.set(false); this.pipeDone.set(true); return;
      }
      this.setPipeStep('branches', 'done', `${this.headBranch} ✓   ${this.baseBranch} ✓`);
    } catch (e: any) {
      this.setPipeStep('branches', 'error', e?.error?.message || 'Failed to list branches');
      this.pipeRunning.set(false); this.pipeDone.set(true); return;
    }

    // 3. Detect PR
    this.setPipeStep('check-pr', 'running');
    let existingPR: any = null;
    try {
      const prs  = await firstValueFrom(this.gh.getOpenPRs(owner, repo, tok)) as any[];
      existingPR = prs?.find(p => p.head.ref === this.headBranch && p.base.ref === this.baseBranch) ?? null;
      this.setPipeStep('check-pr', 'done',
        existingPR ? `Found PR #${existingPR.number} — "${existingPR.title}"` : 'No open PR — a new one will be created');
    } catch (e: any) {
      this.setPipeStep('check-pr', 'error', e?.error?.message || 'Failed to query PRs');
      this.pipeRunning.set(false); this.pipeDone.set(true); return;
    }

    // 4. Create PR
    this.setPipeStep('create-pr', 'running');
    let pr: any; let prStatus: 'created' | 'exists';
    const title = this.description.trim() || `Merge ${this.headBranch} into ${this.baseBranch}`;
    const body  = this.description.trim() || `Automated PR: ${this.headBranch} → ${this.baseBranch}`;
    try {
      if (existingPR) {
        pr = existingPR; prStatus = 'exists';
        this.setPipeStep('create-pr', 'done', `Reusing existing PR #${pr.number}`);
      } else {
        pr = await firstValueFrom(this.gh.createPR(owner, repo, title, body, this.headBranch, this.baseBranch, tok));
        prStatus = 'created';
        this.setPipeStep('create-pr', 'done', `PR #${pr.number} created — "${pr.title}"`);
      }
      this.prResult.set({ title: pr.title, url: pr.html_url, status: prStatus, number: pr.number });
    } catch (e: any) {
      const ghMsg     = e?.error?.message || 'Failed to create PR';
      const ghDetails = (e?.error?.errors as any[])?.map(x => x.message).filter(Boolean).join('  ·  ');
      this.setPipeStep('create-pr', 'error', ghDetails ? `${ghMsg} — ${ghDetails}` : ghMsg);
      this.pipeRunning.set(false); this.pipeDone.set(true); return;
    }

    // 5. Auto-merge
    this.setPipeStep('auto-merge', 'running');
    if (pr?.node_id) {
      try {
        await firstValueFrom(this.gh.enablePRAutoMerge(pr.node_id, tok));
        this.setPipeStep('auto-merge', 'done', 'Auto-merge enabled — merges when CI passes');
      } catch {
        this.setPipeStep('auto-merge', 'skipped', 'Auto-merge unavailable — enable in repo settings');
      }
    } else {
      this.setPipeStep('auto-merge', 'skipped', 'PR node ID not available');
    }

    // 6. Monitor CI — poll up to 20 times (60s) until CI completes
    this.setPipeStep('monitor-ci', 'running', 'Waiting for GitHub Actions…');
    let ciHandled = false;
    for (let i = 0; i < 20; i++) {
      await new Promise<void>(r => setTimeout(r, i === 0 ? 2000 : 3000));
      try {
        const res = await firstValueFrom(this.gh.getWorkflowRuns(owner, repo, tok)) as any;
        const run = res?.workflow_runs?.[0];
        if (run) {
          ciHandled = true;
          const detail = `${run.name}  ·  ${run.status}${run.conclusion ? ' / ' + run.conclusion : ''}  ·  branch: ${run.head_branch}`;
          if (run.status === 'completed') {
            this.setPipeStep('monitor-ci', run.conclusion === 'success' ? 'done' : 'error', detail);
            break;
          } else {
            this.setPipeStep('monitor-ci', 'running', detail);
          }
        }
      } catch { }
    }
    if (!ciHandled) {
      this.setPipeStep('monitor-ci', 'skipped', 'No workflow runs — verify .github/workflows/ci.yml is committed');
    } else {
      // Loop exhausted but CI never reached 'completed' — mark as timed out
      const step = this.pipeSteps().find(s => s.id === 'monitor-ci');
      if (step?.status === 'running') {
        this.setPipeStep('monitor-ci', 'skipped', 'CI still in progress after 60s — check GitHub Actions for status');
      }
    }

    // 7. Poll PR merge status — poll up to 48 times (120s) for approval + auto-merge
    this.setPipeStep('pr-merge', 'running', 'Waiting for approval and auto-merge…');
    let merged = false;
    for (let i = 0; i < 48; i++) {
      await new Promise<void>(r => setTimeout(r, i === 0 ? 3000 : 2500));
      try {
        const prs = await firstValueFrom(this.gh.getOpenPRs(owner, repo, tok)) as any[];
        const stillOpen = prs?.find((p: any) => p.number === pr.number);

        if (!stillOpen) {
          // PR is no longer open — fetch PR directly to read its true merged state
          const prRes  = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`,
            { headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json' } }
          );
          const prData = await prRes.json();
          if (prData.merged) {
            this.setPipeStep('pr-merge', 'done', `PR #${pr.number} successfully merged into ${this.baseBranch} ✓`);
            this.prResult.update(r => r ? { ...r, merged: true } as any : r);
            merged = true;
            break;
          } else if (prData.state === 'closed') {
            this.setPipeStep('pr-merge', 'error', `PR #${pr.number} was closed without merging`);
            merged = true;
            break;
          }
          // state still 'open' but not in list yet — GitHub mid-processing, keep polling
        } else {
          const needsReview = !stillOpen.auto_merge;
          const detail = needsReview
            ? `PR #${pr.number} open · awaiting approval from reviewer`
            : `PR #${pr.number} open · auto-merge queued · waiting for CI + approval`;
          this.setPipeStep('pr-merge', 'running', detail);
        }
      } catch { }
    }

    if (!merged) {
      this.setPipeStep('pr-merge', 'skipped', `PR #${pr.number} still open — approve it on GitHub to trigger auto-merge`);
    }

    this.pipeRunning.set(false);
    this.pipeDone.set(true);
  }
}
