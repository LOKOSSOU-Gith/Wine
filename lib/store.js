'use strict';
// Winlator PC Edition - store.js : persistance JSON simple, sans dépendance.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOGS_DIR = path.join(DATA_DIR, 'logs');

const FILES = {
  containers: path.join(DATA_DIR, 'containers.json'),
  apps: path.join(DATA_DIR, 'apps.json'),
  runs: path.join(DATA_DIR, 'runs.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
};

const DEFAULT_SETTINGS = {
  port: 8799,
  globalEnv: {},
  preferWine: false,
  wineBin: 'wine',
};

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function newId(prefix) {
  return prefix + '-' + crypto.randomBytes(4).toString('hex');
}

const store = {
  ensureDirs,
  LOGS_DIR,
  DATA_DIR,

  listContainers() { ensureDirs(); return readJson(FILES.containers, []); },
  saveContainers(list) { writeJson(FILES.containers, list); },

  listApps() { ensureDirs(); return readJson(FILES.apps, []); },
  saveApps(list) { writeJson(FILES.apps, list); },

  listRuns() { ensureDirs(); return readJson(FILES.runs, []); },
  saveRuns(list) { writeJson(FILES.runs, list.slice(-50)); },

  getSettings() {
    ensureDirs();
    return Object.assign({}, DEFAULT_SETTINGS, readJson(FILES.settings, {}));
  },
  saveSettings(patch) {
    const next = Object.assign({}, store.getSettings(), patch || {});
    writeJson(FILES.settings, next);
    return next;
  },

  logPath(runId) { return path.join(LOGS_DIR, runId + '.log'); },

  appendLog(runId, line) {
    try { fs.appendFileSync(store.logPath(runId), line + '\n', 'utf8'); } catch (_) {}
  },

  createContainer({ name, env, wineBin, notes }) {
    const list = store.listContainers();
    const id = newId('ctr');
    const root = path.join(DATA_DIR, 'containers', id);
    // Structure façon "prefix" Wine : drive_c + games + temp
    for (const sub of ['drive_c', 'drive_c/Program Files', 'games', 'temp']) {
      fs.mkdirSync(path.join(root, sub), { recursive: true });
    }
    const container = {
      id, name: name || 'Conteneur ' + (list.length + 1),
      root,
      env: env || {},
      wineBin: wineBin || '',
      notes: notes || '',
      createdAt: new Date().toISOString(),
    };
    list.push(container);
    store.saveContainers(list);
    return container;
  },

  updateContainer(id, patch) {
    const list = store.listContainers();
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch, { id }); // id non modifiable
    store.saveContainers(list);
    return list[idx];
  },

  deleteContainer(id) {
    const apps = store.listApps();
    if (apps.some(a => a.containerId === id)) {
      return { ok: false, error: 'Supprimez d\'abord les applications liées à ce conteneur.' };
    }
    store.saveContainers(store.listContainers().filter(c => c.id !== id));
    return { ok: true };
  },

  createApp({ name, exePath, args, containerId, env }) {
    const list = store.listApps();
    if (!exePath) return { ok: false, error: 'Chemin de l\'exécutable requis.' };
    const app = {
      id: newId('app'),
      name: name || path.basename(exePath),
      exePath,
      args: args || '',
      containerId: containerId || null,
      env: env || {},
      createdAt: new Date().toISOString(),
    };
    list.push(app);
    store.saveApps(list);
    return { ok: true, app };
  },

  updateApp(id, patch) {
    const list = store.listApps();
    const idx = list.findIndex(a => a.id === id);
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch, { id });
    store.saveApps(list);
    return list[idx];
  },

  deleteApp(id) {
    store.saveApps(store.listApps().filter(a => a.id !== id));
    return { ok: true };
  },
};

module.exports = store;
