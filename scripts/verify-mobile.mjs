import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const required = [
  'ios/App/App.xcodeproj/project.pbxproj',
  'ios/App/App/capacitor.config.json',
  'ios/App/App/Info.plist',
  'android/app/build.gradle',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/res/xml/network_security_config.xml',
  'android/app/src/debug/res/xml/network_security_config.xml',
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

const androidManifest = readFileSync(resolve(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
if (!androidManifest.includes('android:networkSecurityConfig="@xml/network_security_config"')) {
  throw new Error('Android manifest must use the restricted network security config');
}
if (/android:usesCleartextTraffic\s*=\s*["']true["']/.test(androidManifest)) {
  throw new Error('Android manifest must not enable cleartext traffic globally');
}

const androidNetworkSecurity = readFileSync(
  resolve(root, 'android/app/src/main/res/xml/network_security_config.xml'),
  'utf8'
);
if (!/<base-config\s+cleartextTrafficPermitted=["']false["']\s*\/>/.test(androidNetworkSecurity)) {
  throw new Error('Android cleartext traffic must be denied by default');
}
if (/cleartextTrafficPermitted=["']true["']/.test(androidNetworkSecurity)) {
  throw new Error('Android production network security config must not allow cleartext exceptions');
}

const androidDebugNetworkSecurity = readFileSync(
  resolve(root, 'android/app/src/debug/res/xml/network_security_config.xml'),
  'utf8'
);
if (!/<base-config\s+cleartextTrafficPermitted=["']false["']\s*\/>/.test(androidDebugNetworkSecurity)) {
  throw new Error('Android debug cleartext traffic must still be denied by default');
}
if (!/<domain-config\s+cleartextTrafficPermitted=["']true["']>/.test(androidDebugNetworkSecurity)) {
  throw new Error('Android debug local development hosts must have an explicit cleartext exception');
}
const cleartextHosts = [...androidDebugNetworkSecurity.matchAll(
  /<domain\s+includeSubdomains=["']false["']>([^<]+)<\/domain>/g
)].map((match) => match[1].trim()).sort();
const expectedCleartextHosts = ['10.0.2.2', '127.0.0.1', 'localhost'].sort();
if (JSON.stringify(cleartextHosts) !== JSON.stringify(expectedCleartextHosts)) {
  throw new Error(`Android cleartext allowlist must contain only local development hosts: ${cleartextHosts.join(', ')}`);
}
if ((androidDebugNetworkSecurity.match(/<domain(?:\s|>)/g) ?? []).length !== expectedCleartextHosts.length) {
  throw new Error('Android network security config contains an unexpected domain exception');
}
if ((androidDebugNetworkSecurity.match(/cleartextTrafficPermitted=["']true["']/g) ?? []).length !== 1) {
  throw new Error('Android network security config must have exactly one scoped cleartext exception');
}
if (/includeSubdomains=["']true["']/.test(androidDebugNetworkSecurity)) {
  throw new Error('Android local cleartext exceptions must not include subdomains');
}

const iosInfo = readFileSync(resolve(root, 'ios/App/App/Info.plist'), 'utf8');
if (!/<key>NSAppTransportSecurity<\/key>[\s\S]*?<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/.test(iosInfo)) {
  throw new Error('iOS must allow local networking without disabling ATS globally');
}
if (/NSAllowsArbitraryLoads/.test(iosInfo)) {
  throw new Error('iOS ATS must not allow arbitrary network loads');
}

console.log('mobile platform verification passed');
