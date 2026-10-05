import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const source = JSON.parse(readFileSync('src/i18n/source.json', 'utf8'));
const catalogs = { en: Array(source.length), es: Array(source.length) };
let input = readFileSync('src/i18n/translations.tsv', 'utf8');
if (process.argv.includes('--normalize')) {
  input = input.replace(/ +(?=\t|$)/gm, spaces => '\\u0020'.repeat(spaces.length));
  writeFileSync('src/i18n/translations.tsv', input);
}
for (const line of input.trim().split('\n')) {
  const [index, english, spanish] = line.split('\t');
  const id = Number(index);
  assert.ok(Number.isInteger(id) && source[id], `Unknown message ID: ${index}`);
  assert.ok(english && spanish && !catalogs.en[id], `Empty or duplicate translation: ${index}`);
  catalogs.en[id] = english.replaceAll('\\n', '\n').replaceAll('\\u0020', ' ');
  catalogs.es[id] = spanish.replaceAll('\\n', '\n').replaceAll('\\u0020', ' ');
}
for (const [language, messages] of Object.entries(catalogs)) {
  for (let id = 0; id < source.length; id++) assert.ok(messages[id], `Missing ${language} message ${id}: ${source[id]}`);
  const contents = JSON.stringify(messages, null, 2) + '\n';
  if (process.argv.includes('--check')) assert.equal(readFileSync(`src/i18n/${language}.json`, 'utf8'), contents, `${language} catalog must be rebuilt`);
  else writeFileSync(`src/i18n/${language}.json`, contents);
}
console.log(`Built ${source.length} translations in English and Spanish.`);
