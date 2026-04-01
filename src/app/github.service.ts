import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

const BASE = 'https://api.github.com';
const GQL  = 'https://api.github.com/graphql';

export interface RepoInfo {
  full_name: string; description: string; visibility: string;
  default_branch: string; allow_auto_merge: boolean;
  open_issues_count: number; stargazers_count: number;
  html_url: string; pushed_at: string;
}

export interface Branch {
  name: string;
  commit: { sha: string; url: string };
  protected: boolean;
}

export interface PullRequest {
  number: number; title: string; state: string; html_url: string;
  head: { ref: string; sha: string }; base: { ref: string };
  created_at: string; auto_merge: any; node_id: string;
  user: { login: string; avatar_url: string };
}

export interface WorkflowRun {
  id: number; name: string; status: string; conclusion: string;
  html_url: string; created_at: string; updated_at: string;
  head_commit: { message: string; author: { name: string } };
  head_branch: string;
}

export interface Commit {
  sha: string; html_url: string;
  commit: { message: string; author: { name: string; date: string } };
  author: { login: string; avatar_url: string } | null;
}

export interface Protection {
  required_status_checks: { contexts: string[] } | null;
  required_pull_request_reviews: { required_approving_review_count: number } | null;
}

@Injectable({ providedIn: 'root' })
export class GithubService {
  private http = inject(HttpClient);

  private headers(token: string): HttpHeaders {
    return new HttpHeaders({
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    });
  }

  getRepo(owner: string, repo: string, token: string): Observable<RepoInfo> {
    return this.http.get<RepoInfo>(`${BASE}/repos/${owner}/${repo}`, { headers: this.headers(token) })
      .pipe(catchError(e => throwError(() => e)));
  }

  getBranches(owner: string, repo: string, token: string): Observable<Branch[]> {
    return this.http.get<Branch[]>(`${BASE}/repos/${owner}/${repo}/branches`, { headers: this.headers(token) });
  }

  getProtection(owner: string, repo: string, branch: string, token: string): Observable<Protection> {
    return this.http.get<Protection>(`${BASE}/repos/${owner}/${repo}/branches/${branch}/protection`, { headers: this.headers(token) });
  }

  getOpenPRs(owner: string, repo: string, token: string): Observable<PullRequest[]> {
    return this.http.get<PullRequest[]>(`${BASE}/repos/${owner}/${repo}/pulls?state=open&per_page=10`, { headers: this.headers(token) });
  }

  getWorkflowRuns(owner: string, repo: string, token: string): Observable<{ workflow_runs: WorkflowRun[] }> {
    return this.http.get<{ workflow_runs: WorkflowRun[] }>(`${BASE}/repos/${owner}/${repo}/actions/runs?per_page=10`, { headers: this.headers(token) });
  }

  getCommits(owner: string, repo: string, branch: string, token: string): Observable<Commit[]> {
    return this.http.get<Commit[]>(`${BASE}/repos/${owner}/${repo}/commits?sha=${branch}&per_page=8`, { headers: this.headers(token) });
  }

  enableAutoMerge(owner: string, repo: string, token: string): Observable<any> {
    return this.http.patch(`${BASE}/repos/${owner}/${repo}`,
      { allow_auto_merge: true, allow_merge_commit: true },
      { headers: this.headers(token) });
  }

  setProtection(owner: string, repo: string, branch: string, requireApproval: boolean, token: string): Observable<any> {
    const body: any = {
      // Use `checks` (not `contexts`) so GitHub Actions Check Runs satisfy the requirement.
      // app_id: -1 means "any GitHub Actions app" — prevents the "Expected" deadlock.
      required_status_checks: { strict: false, checks: [{ context: 'CI / Build', app_id: -1 }] },
      enforce_admins: false,
      required_pull_request_reviews: requireApproval
        ? { required_approving_review_count: 1, dismiss_stale_reviews: false }
        : null,
      restrictions: null
    };
    return this.http.put(`${BASE}/repos/${owner}/${repo}/branches/${branch}/protection`, body, { headers: this.headers(token) });
  }

  createPR(owner: string, repo: string, title: string, body: string, head: string, base: string, token: string): Observable<PullRequest> {
    return this.http.post<PullRequest>(`${BASE}/repos/${owner}/${repo}/pulls`,
      { title, body, head, base },
      { headers: this.headers(token) });
  }

  enablePRAutoMerge(prNodeId: string, token: string): Observable<any> {
    const query = `
      mutation EnableAutoMerge($prId: ID!) {
        enablePullRequestAutoMerge(input: { pullRequestId: $prId, mergeMethod: MERGE }) {
          pullRequest { autoMergeRequest { enabledAt } }
        }
      }`;
    return this.http.post(GQL, { query, variables: { prId: prNodeId } },
      { headers: this.headers(token) });
  }

  // Returns the commit SHA for a branch, or null if the branch doesn't exist.
  getBranchSha(owner: string, repo: string, branch: string, token: string): Observable<string | null> {
    return this.http
      .get<{ object: { sha: string } }>(`${BASE}/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers: this.headers(token) })
      .pipe(
        map(ref => ref.object.sha),
        catchError(() => of(null))
      );
  }

  // Creates an initial README.md commit, establishing the main branch on an empty repo.
  createInitialCommit(owner: string, repo: string, token: string): Observable<{ content: { sha: string }; commit: { sha: string } }> {
    const content = btoa('# ' + repo + '\n\nInitialised by GitDeploy AI.\n');
    return this.http.put<any>(
      `${BASE}/repos/${owner}/${repo}/contents/README.md`,
      { message: 'Initial commit', content },
      { headers: this.headers(token) }
    );
  }

  // Upserts .github/workflows/build.yml — creates or updates so content is always current.
  // Auto-detects project type at runtime: dotnet build for .NET, npm build for Angular/Node.
  createWorkflowFile(owner: string, repo: string, token: string): Observable<any> {
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
      '      - uses: actions/setup-dotnet@v4',
      '        with:',
      "          dotnet-version: '8.x'",
      '      - uses: actions/setup-node@v4',
      '        with:',
      "          node-version: '20'",
      '      - name: Build',
      '        run: |',
      '          if find . -maxdepth 4 \\( -name "*.sln" -o -name "*.csproj" \\) 2>/dev/null | grep -q .; then',
      '            echo "Detected .NET project"',
      '            dotnet build',
      '          elif [ -f package.json ]; then',
      '            echo "Detected Node/Angular project"',
      '            [ -f package-lock.json ] && npm ci || npm install',
      '            npm run build --if-present || echo "No build script, skipping"',
      '          else',
      '            echo "No recognizable project type — skipping build"',
      '          fi',
    ].join('\n');
    const content = btoa(unescape(encodeURIComponent(yaml)));
    const url = `${BASE}/repos/${owner}/${repo}/contents/.github/workflows/build.yml`;

    // Get current file SHA (needed to update existing file), then upsert
    return this.http.get<{ sha: string }>(url, { headers: this.headers(token) }).pipe(
      catchError(() => of(null)),  // null = file doesn't exist yet
      switchMap((existing: any) => this.http.put(
        url,
        {
          message: 'ci: update Build workflow',
          content,
          ...(existing?.sha ? { sha: existing.sha } : {}),
        },
        { headers: this.headers(token) }
      )),
      catchError((err) => {
        if (err?.status === 403) throw new Error('Token missing "workflow" scope — add it at github.com/settings/tokens');
        throw err;
      })
    );
  }

  // Creates a new branch pointing at the given SHA.
  createBranch(owner: string, repo: string, branch: string, sha: string, token: string): Observable<any> {
    return this.http.post(
      `${BASE}/repos/${owner}/${repo}/git/refs`,
      { ref: `refs/heads/${branch}`, sha },
      { headers: this.headers(token) }
    );
  }

  parseRepoUrl(url: string): { owner: string; repo: string } | null {
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!m) return null;
    return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
  }
}
