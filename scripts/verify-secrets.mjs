import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);

const detectors = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g]
];

const findings = [];
for (const file of files) {
  const absolutePath = resolve(root, file);
  if (!existsSync(absolutePath)) continue;
  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) continue;
  const source = buffer.toString('utf8');
  for (const [label, pattern] of detectors) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const line = source.slice(0, match.index).split('\n').length;
      findings.push(`${file}:${line} ${label}`);
    }
  }
}

if (findings.length > 0) {
  throw new Error(`Potential secrets found in tracked files:\n${findings.join('\n')}`);
}

console.log(`tracked-file secret scan passed (${files.length} files, ${detectors.length} detector classes)`);
