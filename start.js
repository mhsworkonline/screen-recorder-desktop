'use strict';
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const releaseDir = path.join(root, 'release');

console.log('Building release (npx electron-builder --win nsis)...');
const build = spawnSync('npx', ['electron-builder', '--win', 'nsis'], {
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

const installer = fs.existsSync(releaseDir)
  ? fs.readdirSync(releaseDir).find(f => f.toLowerCase().endsWith('.exe') && !f.includes('(Test Build)'))
  : null;

if (!installer) {
  console.error(`No installer .exe found in ${releaseDir}`);
  process.exit(1);
}

const installerPath = path.join(releaseDir, installer);
console.log('Launching installer:', installerPath);
spawn(installerPath, [], { detached: true, stdio: 'ignore' }).unref();
