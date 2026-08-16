import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const scriptNames = ['watch:extension', 'watch:webview'];
const children = scriptNames.map((scriptName) =>
  spawn(npmCommand, ['run', scriptName], { stdio: 'inherit' }),
);
let stopping = false;

const stopChildren = (signal = 'SIGTERM') => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopChildren(signal));
}

const exitCodes = await Promise.all(
  children.map(
    (child) =>
      new Promise((resolve) => {
        child.once('exit', (code, signal) => {
          if (!stopping && (code !== 0 || signal !== null)) stopChildren();
          resolve(code ?? (signal === null ? 0 : 1));
        });
      }),
  ),
);

process.exitCode = exitCodes.find((code) => code !== 0) ?? 0;
