const { spawn } = require('child_process');
const path = require('path');

process.chdir(__dirname);
require('dotenv').config();

console.log('Starting Aegix Gateway...');
console.log('PayAI Facilitator:', process.env.FACILITATOR_URL || 'https://facilitator.payai.network');
console.log('Network:', process.env.PAYAI_NETWORK || 'solana');

const child = spawn('node', ['--import', 'tsx', 'src/index.ts'], {
  stdio: 'inherit',
  shell: true,
  cwd: __dirname
});

child.on('error', (err) => console.error('Failed to start:', err));
child.on('exit', (code) => console.log('Process exited with code:', code));

