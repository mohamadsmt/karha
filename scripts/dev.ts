import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  API_PORT: process.env.API_PORT ?? '3737'
};

const children = [
  spawn('tsx', ['server/index.ts'], { stdio: 'inherit', env }),
  spawn('vite', ['--host', '127.0.0.1', '--port', '5173'], {
    stdio: 'inherit',
    env
  })
];

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      shutdown();
      process.exit(code);
    }
  });
}
