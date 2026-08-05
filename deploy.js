'use strict';
// Manual GitHub sync: stage all local changes, commit, and push to origin.
// Run whenever you want — nothing here runs automatically.
//
// Usage:
//   node deploy.js                  (auto-generated timestamped commit message)
//   node deploy.js "your message"   (custom commit message)
//   npm run deploy -- "your message"

const { spawnSync } = require('child_process');

const root = __dirname;

function git(args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}
function gitInherit(args) {
  return spawnSync('git', args, { cwd: root, stdio: 'inherit' });
}

const remote = git(['remote', 'get-url', 'origin']);
if (remote.status !== 0) {
  console.error('No "origin" remote configured — nothing to deploy to.');
  process.exit(1);
}

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
if (!branch || branch === 'HEAD') {
  console.error('Detached HEAD — checkout a branch before deploying.');
  process.exit(1);
}

const status = git(['status', '--porcelain']).stdout;
if (status.trim()) {
  console.log('Changes to commit:\n' + status.trim());

  const message = process.argv.slice(2).join(' ').trim()
    || `Update ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

  console.log(`\nStaging and committing: "${message}"`);
  if (gitInherit(['add', '-A']).status !== 0) process.exit(1);
  if (gitInherit(['commit', '-m', message]).status !== 0) process.exit(1);
} else {
  console.log('No local changes to commit — checking for unpushed commits...');
}

console.log(`\nPushing ${branch} to origin...`);
const push = gitInherit(['push', '-u', 'origin', branch]);
if (push.status !== 0) {
  console.error('Push failed.');
  process.exit(push.status || 1);
}

console.log('\nDone — GitHub is up to date.');
