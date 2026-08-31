import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const required = [
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/capacitor.config.json',
  'android/app/build.gradle',
  'android/app/src/main/assets/capacitor.config.json',
  'android/app/src/main/assets/public/index.html'
];

for (const file of required) {
  if (!existsSync(resolve(root, file))) throw new Error(`Mobile platform artifact missing: ${file}`);
}

const iosConfig = readFileSync(resolve(root, 'ios/App/App/capacitor.config.json'), 'utf8');
const androidConfig = readFileSync(resolve(root, 'android/app/src/main/assets/capacitor.config.json'), 'utf8');
for (const config of [iosConfig, androidConfig]) {
  if (!config.includes('com.jieseob.planner')) throw new Error('Mobile app id was not synchronized');
}

console.log('mobile platform verification passed');
