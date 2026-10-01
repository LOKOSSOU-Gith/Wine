'use strict';
// Winlator PC Edition - cli.js : lance une application par son nom depuis le terminal.
// Usage : node cli.js <nom-app> [--wine]
const store = require('./lib/store');
const runner = require('./lib/runner');

const args = process.argv.slice(2);
const forceWine = args.includes('--wine');
const name = args.filter(a => !a.startsWith('--'))[0];

if (!name) {
  console.log('Usage : node cli.js <nom-app> [--wine]');
  console.log('\nApplications enregistrées :');
  const apps = store.listApps();
  if (!apps.length) console.log('  (aucune — ajoutez-en via l\'interface http://localhost:8799)');
  for (const a of apps) console.log('  - ' + a.name + '  → ' + a.exePath);
  process.exit(0);
}

const app = store.listApps().find(a => a.name.toLowerCase() === name.toLowerCase());
if (!app) {
  console.error('Application introuvable : ' + name);
  process.exit(1);
}

const res = runner.startRun(app.id, forceWine ? { force: 'wine' } : {});
if (!res.ok) {
  console.error('Erreur : ' + res.error);
  process.exit(1);
}
console.log('Lancé : ' + app.name + ' (runId=' + res.runId + ', runner=' + res.runner + ')');
console.log('Journal : ' + res.logFile);
