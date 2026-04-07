#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const toolsDir = path.join(rootDir, 'tools');
const assetsDir = path.join(toolsDir, 'assets');

const vueRuntimeSrc = path.join(rootDir, 'node_modules', 'vue', 'dist', 'vue.global.prod.js');
const vueRuntimeDest = path.join(assetsDir, 'vue.global.prod.js');

const requiredFiles = [
  'tools/alarm-panel.html',
  'tools/alarm-json-mapper.html',
  'tools/alarm-settings.html',
  'tools/assets/alarm-vue-shell.js',
  'tools/assets/alarm-vue-shell.css',
  'tools/assets/alarm-tools-pages.css',
];

function assertExists(absPath, message) {
  if (!fs.existsSync(absPath)) {
    throw new Error(message || `Missing file: ${absPath}`);
  }
}

function copyIfChanged(src, dest) {
  const srcBuf = fs.readFileSync(src);
  let same = false;
  if (fs.existsSync(dest)) {
    const dstBuf = fs.readFileSync(dest);
    same = Buffer.compare(srcBuf, dstBuf) === 0;
  }

  if (!same) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, srcBuf);
  }

  return !same;
}

function main() {
  assertExists(toolsDir, 'Missing tools directory.');
  fs.mkdirSync(assetsDir, { recursive: true });

  assertExists(
    vueRuntimeSrc,
    'Vue runtime not found at node_modules/vue/dist/vue.global.prod.js. Run "npm install" first.'
  );

  const copied = copyIfChanged(vueRuntimeSrc, vueRuntimeDest);

  for (const relPath of requiredFiles) {
    const absPath = path.join(rootDir, relPath);
    assertExists(absPath, `Missing required Vue tool file: ${relPath}`);
  }

  const status = copied ? 'updated' : 'already up-to-date';
  console.log(`[build:vue-tools] vue.global.prod.js ${status}`);
  console.log('[build:vue-tools] Vue tool pages validated');
}

try {
  main();
} catch (error) {
  console.error(`[build:vue-tools] ${error.message || error}`);
  process.exit(1);
}
