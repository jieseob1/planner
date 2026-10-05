import ts from 'typescript-ast';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { join } from 'node:path';
const source = JSON.parse(readFileSync('src/i18n/source.json', 'utf8'));
const keys = new Set(source);
assert.equal(keys.size, source.length, 'Duplicate translation keys');
const variables = text => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]).sort();
for (const language of ['en', 'es']) {
  const messages = JSON.parse(readFileSync(`src/i18n/${language}.json`, 'utf8'));
  assert.equal(messages.length, source.length, `${language} catalog is incomplete`);
  messages.forEach((message, id) => {
    assert.ok(typeof message === 'string' && message.trim(), `Empty ${language} translation: ${source[id]}`);
    assert.deepEqual(variables(message), variables(source[id]), `Interpolation mismatch: ${language}: ${source[id]}`);
    assert.ok(!/[가-힣]/.test(message), `Untranslated ${language}: ${source[id]}`);
  });
}
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : []);
const unlocalized = [];
for (const file of files('src').filter(f => !/\.test\.|\/test\/|\/i18n\/|\/data\//.test(f) && !['src/state/PlannerProvider.tsx', 'src/state/saveProblem.ts'].includes(f))) {
  const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const checkInitialization = node => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'tr') assert.fail(`Frozen startup translation: ${file}: ${node.getText(ast)}`);
    ts.forEachChild(node, checkInitialization);
  };
  checkInitialization(ast);
  const visit = node => {
    if ((ts.isStringLiteral(node) || ts.isJsxText(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /[가-힣]/.test(node.text)) {
      const parent = node.parent;
      if (ts.isCallExpression(parent) && parent.expression.getText(ast) === 'tr' && parent.arguments[0] === node) assert.ok(keys.has(node.text), `Missing translation: ${file}: ${node.text}`);
      else unlocalized.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1} ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
assert.deepEqual(unlocalized, [], 'Unlocalized application copy (user snapshots are excluded)');
console.log(`Internationalization verified: ${source.length} messages, catalog parity and app-copy coverage.`);
