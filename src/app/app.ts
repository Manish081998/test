import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SetupComponent } from './setup/setup.component';
import { ShipComponent } from './ship/ship.component';
import { MonitorComponent } from './monitor/monitor.component';

type Tab = 'setup' | 'ship' | 'monitor';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, SetupComponent, ShipComponent, MonitorComponent],
  template: `
<div class="shell">

  <!-- Header -->
  <header class="header">
    <div class="header-left">
      <div class="logo">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
        <span class="logo-text">GitDeploy</span>
        <span class="logo-tag">AI</span>
      </div>
    </div>

    <div class="header-center">
      <nav class="tabs">
        @for (tab of tabList; track tab.id) {
          <button class="tab" [class.active]="activeTab() === tab.id" (click)="activeTab.set(tab.id)">
            <span [innerHTML]="tab.icon"></span>
            {{ tab.label }}
          </button>
        }
      </nav>
    </div>

    <div class="header-right">
      <div class="token-status" [class.configured]="token()">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path fill-rule="evenodd" d="M8 0a8.1 8.1 0 00-2.56 15.79c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52 0-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.68 7.68 0 014 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0016 8a8 8 0 00-8-8z"/>
        </svg>
        @if (token()) {
          <span class="token-ok">Token configured ✓</span>
        } @else {
          <span class="token-missing">No token — add to server-config.json</span>
        }
      </div>
    </div>
  </header>

  <!-- Token Warning -->
  @if (!token()) {
    <div class="token-banner fade-in">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path fill-rule="evenodd" d="M8.22 1.754a.25.25 0 00-.44 0L1.698 13.132a.25.25 0 00.22.368h12.164a.25.25 0 00.22-.368L8.22 1.754zm-1.763-.707c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0114.082 15H1.918a1.75 1.75 0 01-1.543-2.575L6.457 1.047zM9 11a1 1 0 11-2 0 1 1 0 012 0zm-.25-5.25a.75.75 0 00-1.5 0v2.5a.75.75 0 001.5 0v-2.5z"/>
      </svg>
      GitHub token not found. Add your token to <strong>server-config.json</strong> in the GitWeb folder:
      <code>&#123; "githubToken": "ghp_..." &#125;</code>
    </div>
  }

  <!-- Main Content -->
  <main class="main">
    @if (activeTab() === 'setup') {
      <app-setup [token]="token()" class="fade-in" />
    }
    @if (activeTab() === 'ship') {
      <app-ship [token]="token()" class="fade-in" />
    }
    @if (activeTab() === 'monitor') {
      <app-monitor [token]="token()" class="fade-in" />
    }
  </main>

  <footer class="footer">
    GitDeploy AI · Built for the <strong>ai-github-ci-boilerplate</strong> workflow
  </footer>

</div>
  `,
  styles: [`
.shell { min-height: 100vh; display: flex; flex-direction: column; }

.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 24px; height: 56px; flex-shrink: 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: blur(8px);
}

.logo { display: flex; align-items: center; gap: 9px; }
.logo svg { color: var(--text-primary); }
.logo-text { font-size: 15px; font-weight: 700; letter-spacing: -.3px; }
.logo-tag {
  font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
  background: linear-gradient(135deg, var(--blue-dim), var(--purple));
  color: #fff; padding: 2px 6px; border-radius: 4px;
}

.header-center { position: absolute; left: 50%; transform: translateX(-50%); }
.tabs { display: flex; gap: 2px; background: var(--bg-primary); padding: 4px; border-radius: 10px; border: 1px solid var(--border); }
.tab {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 16px; border-radius: 7px; font-size: 13px; font-weight: 500;
  border: none; background: none; color: var(--text-muted); cursor: pointer; transition: all .15s;
  &:hover { color: var(--text-primary); background: var(--bg-tertiary); }
  &.active { background: var(--bg-secondary); color: var(--text-primary); box-shadow: 0 1px 4px rgba(0,0,0,.3); }
}

.header-right { display: flex; align-items: center; }
.token-status {
  display: flex; align-items: center; gap: 7px;
  background: var(--bg-primary); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 5px 12px; font-size: 12px;
  svg { color: var(--text-dim); flex-shrink: 0; }
  &.configured { border-color: var(--green-dim); svg { color: var(--green); } }
}
.token-ok { color: var(--green); font-weight: 600; }
.token-missing { color: var(--yellow); }

.token-banner {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: var(--yellow-bg); border-bottom: 1px solid rgba(187,128,9,.3);
  padding: 10px 24px; font-size: 13px; color: var(--yellow);
  strong { color: var(--text-primary); }
  svg { flex-shrink: 0; }
}

.main { flex: 1; padding: 24px; max-width: 1100px; width: 100%; margin: 0 auto; }

.footer {
  text-align: center; padding: 14px; font-size: 12px; color: var(--text-dim);
  border-top: 1px solid var(--border);
  strong { color: var(--text-muted); }
}
  `]
})
export class App {
  activeTab = signal<Tab>('monitor');
  token     = signal('');

  tabList = [
    { id: 'setup'   as Tab, label: 'Setup',   icon: '⚙' },
    { id: 'ship'    as Tab, label: 'Ship',     icon: '🚀' },
    { id: 'monitor' as Tab, label: 'Monitor',  icon: '◉' },
  ];

  constructor() {
    // Load token from server config (server-config.json) — never stored in browser
    fetch('http://localhost:3001/api/config')
      .then(r => r.json())
      .then(cfg => { if (cfg.githubToken) this.token.set(cfg.githubToken); })
      .catch(() => {});
  }
}
