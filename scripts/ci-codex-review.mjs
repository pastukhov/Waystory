import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const codexBotId = 199175422;
const codexBotLogin = 'chatgpt-codex-connector[bot]';
const reviewTimeLimit = 12 * 60_000;

export function reviewAllowsMerge(comments, head, threads = []) {
  const summary = comments.findLast(({ user, body }) =>
    user?.id === codexBotId && user?.login === codexBotLogin
    && body?.includes('<!-- codex-pull-request-review-summary -->'));
  const status = summary?.body.match(/^<!-- codex-review-state:v1 (\{.*\}) -->$/m);
  if (!status) return false;

  const review = JSON.parse(status[1]).code_review;
  if (review?.commit_sha !== head || review.status !== 'completed') return false;
  const findings = threads.filter(({ comments: { nodes: [comment] } }) =>
    comment?.author?.login === 'chatgpt-codex-connector' && comment.originalCommit?.oid === head);
  if (findings.some(({ isResolved }) => !isResolved)) return false;

  return review.has_unresolved_findings === false
    || (review.has_any_findings === true && findings.length > 0);
}

async function github(url, payload) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
    ...(payload && { method: 'POST', body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return response.json();
}

async function reviewThreads(owner, repo, number) {
  const query = `query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefOid
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            comments(first: 1) { nodes { author { login } originalCommit { oid } } }
          }
        }
      }
    }
  }`;
  const threads = [];
  let cursor = null;
  let head;
  do {
    const result = await github(process.env.GITHUB_GRAPHQL_URL, {
      query, variables: { owner, repo, number, cursor },
    });
    if (result.errors) throw new Error('GitHub GraphQL failed to read review threads');
    const pr = result.data.repository.pullRequest;
    head = pr.headRefOid;
    const { nodes, pageInfo } = pr.reviewThreads;
    threads.push(...nodes);
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);
  return { head, threads };
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const { number, pull_request: { head: { sha } } } = event;
  const repository = process.env.GITHUB_REPOSITORY;
  const [owner, repo] = repository.split('/');
  const issueUrl = `${process.env.GITHUB_API_URL}/repos/${repository}/issues/${number}/comments`;
  const deadline = Date.now() + reviewTimeLimit;
  console.log(`Waiting for Codex review of PR #${number}, commit ${sha}.`);

  while (Date.now() < deadline) {
    const comments = [];
    for (let page = 1; ; page += 1) {
      const batch = await github(`${issueUrl}?per_page=100&page=${page}`);
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    const { head, threads } = await reviewThreads(owner, repo, number);
    if (head !== sha) throw new Error('PR head changed. Use the check for the new commit.');
    if (reviewAllowsMerge(comments, sha, threads)) {
      console.log('Codex reviewed this commit and its findings are resolved.');
      return;
    }
    await sleep(15_000);
  }
  throw new Error('Codex review is missing, incomplete, or has unresolved findings. After review and resolution, rerun this check if it has timed out.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
