import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const APP_ID = 'com.jieseob.planner';
const VERSION = /^(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,1})\.(?:0|[1-9][0-9]{0,1})$/;
const BUILD = /^[1-9][0-9]{0,3}$/;
const REQUIRED_SECRETS = {
  android: ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'],
  ios: ['APPLE_TEAM_ID', 'APPLE_DISTRIBUTION_P12_BASE64', 'APPLE_DISTRIBUTION_P12_PASSWORD', 'APPLE_PROVISIONING_PROFILE_BASE64'],
};

function validateRelease(env) {
  assert.match(env.MOBILE_VERSION ?? '', VERSION, 'MOBILE_VERSION must be MAJOR.MINOR.PATCH: major 0-9999, minor/patch 0-99, no leading zeros');
  assert.match(env.MOBILE_BUILD_NUMBER ?? '', BUILD, 'MOBILE_BUILD_NUMBER must be 1-9999; check both stores for an unused increasing number');
  assert.ok(['android', 'ios', 'both'].includes(env.MOBILE_PLATFORM), 'MOBILE_PLATFORM must be android, ios, or both');
  assert.ok(['true', 'false'].includes(env.VITE_NATIVE_PUSH_ENABLED ?? 'false'), 'VITE_NATIVE_PUSH_ENABLED must be true or false');
}

function decodeSecret(value, name) {
  const compact = value?.replace(/\s/g, '') ?? '';
  assert.ok(compact && /^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.length % 4 === 0, `${name} must contain valid base64`);
  const result = Buffer.from(compact, 'base64');
  assert.equal(result.toString('base64'), compact, `${name} must contain canonical base64`);
  return result;
}

function preflight(platform, env) {
  validateRelease(env);
  assert.ok(REQUIRED_SECRETS[platform], 'Unknown signing platform');
  const required = [...REQUIRED_SECRETS[platform]];
  if (platform === 'android' && env.VITE_NATIVE_PUSH_ENABLED === 'true') required.push('GOOGLE_SERVICES_JSON_BASE64');
  const missing = required.filter(key => !env[key]?.trim());
  assert.equal(missing.length, 0, `Missing mobile-production secrets: ${missing.join(', ')}`);
  for (const key of required.filter(key => key.endsWith('_BASE64'))) decodeSecret(env[key], key);
  if (platform === 'ios') assert.match(env.APPLE_TEAM_ID, /^[A-Z0-9]{10}$/, 'APPLE_TEAM_ID must be the 10-character team identifier');
  if (platform === 'android' && env.VITE_NATIVE_PUSH_ENABLED === 'true') {
    let config;
    try { config = JSON.parse(decodeSecret(env.GOOGLE_SERVICES_JSON_BASE64, 'GOOGLE_SERVICES_JSON_BASE64').toString()); }
    catch { throw new Error('GOOGLE_SERVICES_JSON_BASE64 must encode valid JSON'); }
    assert.ok(config.client?.some(client => client.client_info?.android_client_info?.package_name === APP_ID), 'Firebase configuration must contain the production Android application ID');
  }
}

function validateProfile(profile, team, now = Date.now()) {
  assert.match(team ?? '', /^[A-Z0-9]{10}$/, 'Valid APPLE_TEAM_ID required');
  assert.match(profile.UUID ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid profile UUID');
  assert.ok(profile.TeamIdentifier?.includes(team), 'Provisioning profile team mismatch');
  assert.ok(profile.Platform?.includes('iOS'), 'Provisioning profile must support iOS');
  assert.ok(Date.parse(profile.ExpirationDate) > now, 'Provisioning profile is expired or has no valid expiration');
  assert.equal(profile.Entitlements?.['com.apple.developer.team-identifier'], team, 'Profile entitlement team mismatch');
  assert.match(profile.Entitlements?.['application-identifier'] ?? '', /^[A-Z0-9]{10}\.com\.jieseob\.planner$/, 'Profile must match the exact production bundle ID');
  assert.equal(profile.Entitlements?.['get-task-allow'], false, 'App Store profile must not allow debugging');
  assert.equal(profile.Entitlements?.['aps-environment'], 'production', 'The app has push entitlements: the App Store profile must enable production APNs');
  assert.equal(profile.ProvisionedDevices, undefined, 'Development/ad hoc profiles cannot export an App Store IPA');
  assert.notEqual(profile.ProvisionsAllDevices, true, 'Enterprise profiles cannot export an App Store IPA');
}

function readProfilePlist(path) {
  // Read only selected keys; plutil cannot convert an entire profile containing dates to JSON.
  const extract = (key, format = 'json', optional = false) => {
    const result = spawnSync('plutil', ['-extract', key, format, '-o', '-', path], { encoding: 'utf8' });
    if (result.status !== 0) {
      if (optional) return undefined;
      throw new Error(`Provisioning profile is missing ${key}`);
    }
    return format === 'json' ? JSON.parse(result.stdout) : result.stdout.trim();
  };
  return {
    UUID: extract('UUID', 'raw'), TeamIdentifier: extract('TeamIdentifier'), Platform: extract('Platform'),
    ExpirationDate: extract('ExpirationDate', 'raw'), Entitlements: extract('Entitlements'),
    ProvisionedDevices: extract('ProvisionedDevices', 'json', true),
    ProvisionsAllDevices: extract('ProvisionsAllDevices', 'json', true),
  };
}

function selectXcode() {
  assert.equal(process.platform, 'darwin', 'Xcode requires macOS');
  assert.ok(process.env.GITHUB_ENV, 'Xcode selection is restricted to a GitHub hosted build');
  const candidates = readdirSync('/Applications')
    .filter(name => /^Xcode(?:_\d+(?:\.\d+)*)?\.app$/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const candidate of candidates) {
    const developer = `/Applications/${candidate}/Contents/Developer`;
    const env = { ...process.env, DEVELOPER_DIR: developer };
    const version = spawnSync('xcodebuild', ['-version'], { env, encoding: 'utf8' });
    if (version.status !== 0 || Number(version.stdout.match(/Xcode (\d+)/)?.[1] ?? 0) < 26) continue;
    const sdk = execFileSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version'], { env, encoding: 'utf8' }).trim();
    assert.ok(Number(sdk.split('.')[0]) >= 26, 'iOS simulator SDK 26 or later required');
    appendFileSync(process.env.GITHUB_ENV, `DEVELOPER_DIR=${developer}\n`);
    console.log(`${version.stdout.trim()}\niOS simulator SDK ${sdk}`);
    return;
  }
  throw new Error('No stable Xcode 26+ is installed on this runner; update the macOS runner image');
}

function checkWorkflows(ci, release) {
  assert.deepEqual(ci.on.push.branches, ['main']);
  assert.ok(Object.hasOwn(ci.on, 'pull_request'), 'Mobile builds must run on PRs');
  assert.deepEqual(Object.keys(release.on), ['workflow_dispatch'], 'Signed artifacts must be manually dispatched');
  for (const workflow of [ci, release]) {
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    assert.equal(workflow.env.VITE_API_BASE_URL, 'https://goalstotoday.com');
    assert.equal(workflow.env.VITE_OIDC_AUTHORITY, 'https://goalstotoday.com/idp/realms/nowline');
    assert.equal(workflow.env.VITE_OIDC_CLIENT_ID, 'nowline-mobile');
    assert.equal(workflow.env.VITE_AUTH_MODE, 'oidc');
    assert.equal(workflow.env.VITE_OIDC_NATIVE_REDIRECT_URI, `${APP_ID}://auth/callback`);
    assert.equal(workflow.env.VITE_OIDC_NATIVE_POST_LOGOUT_REDIRECT_URI, `${APP_ID}://auth/logout`);
    for (const [platform, job] of Object.entries(workflow.jobs).filter(([key]) => key !== 'validate')) {
      assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 45, 'Native jobs need bounded timeouts');
      const commands = job.steps.map(step => step.run ?? '').join('\n');
      assert.ok(commands.includes('npm ci') && commands.includes('npm run build') && commands.includes(`npx cap sync ${platform}`));
      assert.ok(job.steps.some(step => step.uses?.startsWith('actions/upload-artifact@') && step.with['if-no-files-found'] === 'error'), 'Build artifacts must fail when missing');
      if (platform === 'android') {
        const java = job.steps.find(step => step.uses?.startsWith('actions/setup-java@'));
        assert.equal(String(java?.with['java-version']), '21', 'Gradle wrapper uses Java 21');
        assert.ok(commands.includes('sdkmanager') && commands.includes('platforms;android-36'), 'Native Android jobs must provision their compile SDK');
      } else {
        assert.match(job['runs-on'], /^macos-/);
        assert.ok(commands.includes('--select-xcode'), 'Capacitor 8 requires Xcode 26+');
      }
      assert.ok(!/\$\{\{\s*inputs\./.test(commands), 'User inputs must enter commands through quoted environment variables');
    }
  }
  assert.equal(ci.env.VITE_NATIVE_PUSH_ENABLED, 'false');
  assert.ok(!JSON.stringify(ci).includes('secrets.'), 'Account-free mobile CI cannot require secrets');
  assert.ok(ci.jobs.android.steps.some(step => step.run?.includes('assembleDebug')), 'CI must compile an APK');
  assert.ok(ci.jobs.ios.steps.some(step => /xcodebuild[\s\S]*CODE_SIGNING_ALLOWED=NO[\s\S]*build/.test(step.run ?? '')), 'CI must compile an unsigned simulator app');
  assert.ok(ci.jobs.ios.steps.some(step => step.run?.includes('ditto -c -k --keepParent')), 'Preserve the .app bundle in a zip artifact');
  assert.ok(release.jobs.validate.steps.some(step => step.run?.includes('refs/heads/main') && step.run.includes('--validate-release')));
  for (const platform of ['android', 'ios']) {
    const job = release.jobs[platform];
    assert.equal(job.needs, 'validate');
    assert.equal(job.environment, 'mobile-production');
    assert.ok(job.if.includes(`inputs.platform == '${platform}'`));
    const preflightIndex = job.steps.findIndex(step => step.run === `node scripts/verify-mobile-readiness.mjs --preflight ${platform}`);
    assert.ok(preflightIndex >= 0 && preflightIndex < job.steps.findIndex(step => step.run === 'npm ci'), 'Secret preflight must precede dependency install and signing');
    const preflightEnv = job.steps[preflightIndex].env;
    for (const key of REQUIRED_SECRETS[platform]) assert.equal(preflightEnv[key], '${{ secrets.' + key + ' }}');
    const cleanup = job.steps.find(step => step.name?.startsWith(`Remove ${platform === 'ios' ? 'iOS' : 'Android'} signing files`));
    assert.equal(cleanup?.if, 'always()', 'Signing files must be cleaned up on failures too');
    assert.ok(cleanup.run.includes('rm -f'));
    if (platform === 'ios') assert.ok(cleanup.run.includes('security delete-keychain'));
  }
  const android = release.jobs.android.steps.map(step => step.run ?? '').join('\n');
  const ios = release.jobs.ios.steps.map(step => step.run ?? '').join('\n');
  assert.ok(android.includes('-PnowlineRequireSigning=true') && android.includes('jarsigner -verify'));
  assert.ok(android.includes("VITE_NATIVE_PUSH_ENABLED === 'true'"), 'FCM configuration must remain optional when push is disabled');
  assert.ok(ios.includes('--validate-profile') && ios.includes('CODE_SIGN_STYLE=Manual') && ios.includes('-exportArchive') && ios.includes('codesign --verify'));
  assert.ok(!/upload-app|upload_to_app_store|supply\s|altool.*upload|destination=upload/.test(ios + android), 'Artifact workflow must not submit to stores');
}

async function verifyRepository() {
  const { parse } = await import('yaml');
  const read = path => readFileSync(resolve(path), 'utf8');
  const ci = parse(read('.github/workflows/mobile-ci.yml'));
  const release = parse(read('.github/workflows/mobile-release.yml'));
  checkWorkflows(ci, release);
  const capacitor = read('capacitor.config.ts');
  assert.match(capacitor, /appId: 'com\.jieseob\.planner'/);
  assert.match(capacitor, /appName: 'Goals to Today'/);
  assert.match(capacitor, /webDir: 'dist'/);
  assert.ok(!/server\s*:|cleartext\s*:\s*true/.test(capacitor), 'Production apps must package assets and keep HTTPS defaults');
  const android = read('android/app/src/main/AndroidManifest.xml');
  for (const path of ['/callback', '/logout']) assert.ok(android.includes(`android:scheme="${APP_ID}" android:host="auth" android:path="${path}"`), `Exact Android ${path} deep link required`);
  assert.ok(!/usesCleartextTraffic="true"/.test(android));
  assert.match(read('android/app/src/main/res/xml/network_security_config.xml'), /base-config cleartextTrafficPermitted="false"/);
  const gradle = read('android/app/build.gradle');
  assert.ok(gradle.includes(`applicationId "${APP_ID}"`) && gradle.includes('nowlineRequireSigning') && gradle.includes('missingSigningVariables'));
  assert.match(read('android/variables.gradle'), /targetSdkVersion = 36/);
  assert.match(read('android/app/src/main/res/values/strings.xml'), /name="app_name">Goals to Today</);
  const info = read('ios/App/App/Info.plist');
  assert.match(info, /CFBundleDisplayName<\/key>\s*<string>Goals to Today<\/string>/);
  assert.ok(info.includes(`<string>${APP_ID}</string>`) && !info.includes('NSAllowsArbitraryLoads'));
  const project = read('ios/App/App.xcodeproj/project.pbxproj');
  assert.equal((project.match(/PRODUCT_BUNDLE_IDENTIFIER = com\.jieseob\.planner;/g) ?? []).length, 2);
  assert.equal((project.match(/MARKETING_VERSION = 1\.0\.0;/g) ?? []).length, 2);
  assert.ok(project.includes('PrivacyInfo.xcprivacy in Resources'));
  assert.ok(project.includes('PROVISIONING_PROFILE_SPECIFIER = "$(MOBILE_PROFILE_SPECIFIER)";'), 'Scope manual provisioning to the app target, not Swift package dependencies');
  const scene = read('ios/App/App/SceneDelegate.swift');
  assert.ok(scene.includes('SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)'));
  assert.ok(scene.includes('SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)'));
  const delegate = read('ios/App/App/AppDelegate.swift');
  assert.ok(delegate.includes('name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken'));
  assert.ok(delegate.includes('name: .capacitorDidFailToRegisterForRemoteNotifications, object: error'));
  const privacy = read('ios/App/App/PrivacyInfo.xcprivacy');
  assert.match(privacy, /NSPrivacyTracking<\/key>\s*<false\/>/);
  for (const value of ['EmailAddress', 'UserID', 'OtherUserContent', 'ProductInteraction']) assert.ok(privacy.includes(`NSPrivacyCollectedDataType${value}`));
  const exportOptions = read('ios/AppStoreExportOptions.plist');
  assert.match(exportOptions, /<key>destination<\/key><string>export<\/string>/);
  assert.match(exportOptions, /<key>method<\/key><string>app-store-connect<\/string>/);
  assert.ok(exportOptions.includes('PROFILE_UUID_PLACEHOLDER') && exportOptions.includes('TEAM_ID_PLACEHOLDER'));
  const icon = readFileSync('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  assert.equal(icon.subarray(1, 4).toString(), 'PNG');
  assert.equal(icon.readUInt32BE(16), 1024);
  assert.equal(icon.readUInt32BE(20), 1024);
  // Store icons must not contain an alpha channel or transparency chunk.
  assert.ok(![4, 6].includes(icon[25]), 'iOS icon must be opaque RGB/grayscale');
  assert.ok(!icon.includes(Buffer.from('tRNS')), 'iOS icon cannot declare PNG transparency');
  for (const path of ['android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png', 'docs/MOBILE_RELEASE.md', 'docs/store/METADATA.md']) assert.ok(existsSync(path), `Missing mobile asset/document ${path}`);

  let controls = 0;
  const rejects = (operation, label) => { assert.throws(operation, undefined, `Negative control accepted: ${label}`); controls += 1; };
  const valid = { MOBILE_VERSION: '1.0.0', MOBILE_BUILD_NUMBER: '1', MOBILE_PLATFORM: 'both', VITE_NATIVE_PUSH_ENABLED: 'false' };
  validateRelease(valid);
  for (const version of ['1.0', '01.0.0', '1.0.0-beta', '1.0.0; echo BAD', '$(id)', '1.100.0', '']) rejects(() => validateRelease({ ...valid, MOBILE_VERSION: version }), 'version');
  for (const number of ['0', '-1', '01', '10000', '2.1', '1\n2', '']) rejects(() => validateRelease({ ...valid, MOBILE_BUILD_NUMBER: number }), 'build number');
  rejects(() => validateRelease({ ...valid, MOBILE_PLATFORM: 'web' }), 'platform');
  const secrets = Object.fromEntries(Object.values(REQUIRED_SECRETS).flat().map(key => [key, key.endsWith('_BASE64') ? 'dGVzdA==' : 'example']));
  const configured = { ...valid, ...secrets, APPLE_TEAM_ID: 'ABCDE12345' };
  preflight('android', configured); // Positive control: no Firebase secret when push is off.
  preflight('ios', configured);
  for (const platform of ['android', 'ios']) for (const key of REQUIRED_SECRETS[platform]) rejects(() => preflight(platform, { ...configured, [key]: '' }), `missing ${key}`);
  rejects(() => preflight('android', { ...configured, ANDROID_KEYSTORE_BASE64: '!!!' }), 'malformed base64');
  rejects(() => preflight('android', { ...configured, VITE_NATIVE_PUSH_ENABLED: 'true' }), 'push without Firebase');
  const firebase = packageName => Buffer.from(JSON.stringify({ client: [{ client_info: { android_client_info: { package_name: packageName } } }] })).toString('base64');
  preflight('android', { ...configured, VITE_NATIVE_PUSH_ENABLED: 'true', GOOGLE_SERVICES_JSON_BASE64: firebase(APP_ID) });
  rejects(() => preflight('android', { ...configured, VITE_NATIVE_PUSH_ENABLED: 'true', GOOGLE_SERVICES_JSON_BASE64: firebase('wrong.app') }), 'wrong Firebase app');
  const profile = { UUID: '11111111-1111-1111-1111-111111111111', TeamIdentifier: ['ABCDE12345'], Platform: ['iOS'], ExpirationDate: new Date(Date.now() + 86400000).toISOString(), Entitlements: { 'com.apple.developer.team-identifier': 'ABCDE12345', 'application-identifier': `ABCDE12345.${APP_ID}`, 'get-task-allow': false, 'aps-environment': 'production' } };
  validateProfile(profile, configured.APPLE_TEAM_ID);
  for (const changes of [{ UUID: '../unsafe' }, { TeamIdentifier: ['WRONG12345'] }, { ExpirationDate: '2000-01-01' }, { ProvisionedDevices: ['device'] }, { ProvisionsAllDevices: true }, { Entitlements: { ...profile.Entitlements, 'get-task-allow': true } }, { Entitlements: { ...profile.Entitlements, 'application-identifier': 'ABCDE12345.*' } }, { Entitlements: { ...profile.Entitlements, 'aps-environment': 'development' } }]) rejects(() => validateProfile({ ...profile, ...changes }, configured.APPLE_TEAM_ID), 'invalid signing profile');
  for (const mutate of [
    (ci) => { delete ci.on.pull_request; },
    (ci) => { ci.env.VITE_OIDC_CLIENT_ID = 'nowline-web'; },
    (ci) => { ci.env.EXTRA = '${{ secrets.BAD }}'; },
    (ci) => { ci.jobs.android.steps = ci.jobs.android.steps.filter(step => !step.run?.includes('assembleDebug')); },
    (ci, release) => { release.on.push = {}; },
    (ci, release) => { release.jobs.android.steps.find(step => step.name?.startsWith('Remove Android')).if = 'success()'; },
    (ci, release) => { release.jobs.ios.environment = 'unprotected'; },
  ]) {
    const a = structuredClone(ci); const b = structuredClone(release); mutate(a, b);
    rejects(() => checkWorkflows(a, b), 'unsafe workflow');
  }
  console.log(`mobile store readiness configuration verified (${controls} negative controls; native build execution is separate)`);
}

try {
  const [mode, argument] = process.argv.slice(2);
  if (!mode) await verifyRepository();
  else if (mode === '--validate-release') { validateRelease(process.env); console.log('mobile release inputs verified'); }
  else if (mode === '--preflight') { preflight(argument, process.env); console.log(`${argument} signing secret preflight passed (signing validity is checked during the build)`); }
  else if (mode === '--validate-profile') { validateProfile(readProfilePlist(argument), process.env.APPLE_TEAM_ID); console.log('App Store provisioning profile verified'); }
  else if (mode === '--select-xcode') selectXcode();
  else throw new Error(`Unknown mode: ${mode}`);
} catch (error) {
  // Assertion objects can contain actual secret values; never print their object or stack.
  console.error(error.message.split('\n')[0]);
  process.exitCode = 1;
}
