import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewAllowsMerge } from '../scripts/ci-codex-review.mjs';

const head = 'current-head';
const review = { commit_sha: head, status: 'completed', has_any_findings: false, has_unresolved_findings: false };
const bot = { id: 199175422, login: 'chatgpt-codex-connector[bot]' };
const summary = (state, user = bot) => ({
  user,
  body: '<!-- codex-pull-request-review-summary -->\n'
    + '<!-- codex-review-state:v1 ' + JSON.stringify({ code_review: state }) + ' -->',
});
const finding = (isResolved, sha = head) => ({
  isResolved,
  comments: { nodes: [{ author: { login: 'chatgpt-codex-connector' }, originalCommit: { oid: sha } }] },
});

test('requires an authentic, complete review of the exact head', () => {
  assert.equal(reviewAllowsMerge([], head), false);
  assert.equal(reviewAllowsMerge([summary(review, { ...bot, id: 1 })], head), false);
  assert.equal(reviewAllowsMerge([summary({ ...review, commit_sha: 'old' })], head), false);
  assert.equal(reviewAllowsMerge([summary(review), summary({ ...review, status: 'running' })], head), false);
  assert.equal(reviewAllowsMerge([summary(review)], head), true);
});

test('requires findings to be resolved even when the summary is stale', () => {
  const comments = [summary({ ...review, has_any_findings: true, has_unresolved_findings: true })];
  assert.equal(reviewAllowsMerge(comments, head, []), false);
  assert.equal(reviewAllowsMerge(comments, head, [finding(true, 'old')]), false);
  assert.equal(reviewAllowsMerge(comments, head, [finding(true), finding(false)]), false);
  assert.equal(reviewAllowsMerge(comments, head, [finding(true), finding(true)]), true);
  assert.equal(reviewAllowsMerge([summary(review)], head, [finding(false)]), false);
});
