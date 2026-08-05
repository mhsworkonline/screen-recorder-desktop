'use strict';
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const releaseDir = path.join(root, 'release');

console.log('Building release (npx electron-builder --win portable)...');
const build = spawnSync('npx', ['electron-builder', '--win', 'portable'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) {
  console.error('Build failed.');
  process.exit(build.status || 1);
}

fs.rmSync(path.join(releaseDir, 'win-unpacked'), { recursive: true, force: true });
fs.rmSync(path.join(releaseDir, 'builder-debug.yml'), { force: true });
fs.rmSync(path.join(releaseDir, 'builder-effective-config.yaml'), { force: true });

// Portable build: a single self-contained .exe that runs the app directly —
// no installer wizard, nothing written outside itself.
const portableExe = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).find(f => f.toLowerCase().endsWith('.exe') && !f.includes('(Test Build)'))
  : null;

if (!portableExe) {
  console.error(`No portable .exe found in ${releaseDir}`);
  process.exit(1);
}

const exePath = path.join(releaseDir, portableExe);
console.log('Launching app:', exePath);
spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref();
