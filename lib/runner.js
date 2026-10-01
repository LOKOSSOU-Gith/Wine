'use strict';
// Winlator PC Edition - runner.js : exécution des applications (natif Windows ou Wine).
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const store = require('./store');

// Processus actifs : runId -> { proc, appId, startedAt }
const active = new Map();

const IS_LINUX = process.platform !== 'win32';

// Sous Linux il n'y a pas d'exécutables natifs Windows : Wine est obligatoire.
function effectiveRunner(app, settings, opts) {
  const wantWine = opts.force === 'wine' || settings.preferWine || app.runner === 'wine';
  if (IS_LINUX) return { useWine: true, reason: wantWine ? 'wine demandé' : 'linux → wine auto' };
  return { useWine: wantWine, reason: '' };
}

// Initialise le préfixe Wine d'un conteneur une seule fois (wineboot -i).
const bootedPrefixes = new Set();
function ensurePrefix(container, env, logger) {
  if (!container || !container.root || bootedPrefixes.has(container.root)) return;
  try {
    execFileSync('wineboot', ['-i'], { env, cwd: container.root, stdio: 'ignore', timeout: 120000 });
    bootedPrefixes.add(container.root);
    if (logger) logger('[runner] Préfixe Wine initialisé : ' + container.root);
  } catch (e) {
    if (logger) logger('[runner] wineboot a échoué : ' + e.message);
  }
}

function buildEnv(container, app, settings) {
  const env = Object.assign({}, process.env);
  // Ordre de priorité : global < conteneur < application
  const layers = [settings.globalEnv || {}, (container && container.env) || {}, (app && app.env) || {}];
  for (const layer of layers) {
    for (const [k, v] of Object.entries(layer)) env[k] = String(v);
  }
  // Comportement proche des presets Box64 de Winlator : variable MESA pour vieux jeux
  if (env.WINE_MESA_EXTENSION_MAX_YEAR === undefined && env.ENABLE_MESA_LEGACY === '1') {
    env.MESA_EXTENSION_MAX_YEAR = '2003';
  }
  return env;
}

function resolveExe(app) {
  let p = app.exePath || '';
  // Accepte les chemins Windows même si lancé depuis bash
  p = p.replace(/^\~(?=\/|\\|$)/, process.env.USERPROFILE || '');
  return p;
}

function startRun(appId, opts = {}) {
  const app = store.listApps().find(a => a.id === appId);
  if (!app) return { ok: false, error: 'Application introuvable : ' + appId };
  const settings = store.getSettings();
  const container = app.containerId
    ? store.listContainers().find(c => c.id === app.containerId) || null
    : null;

  const exePath = resolveExe(app);
  if (!fs.existsSync(exePath)) {
    return { ok: false, error: 'Exécutable introuvable : ' + exePath };
  }
  if (IS_LINUX && !/\.(exe|msi|bat|cmd|msp|scr)$/i.test(exePath)) {
    return { ok: false, error: 'Sous Linux, seuls des exécutables Windows peuvent être lancés (.exe, .msi, …).' };
  }

  const runId = 'run-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const logFile = store.logPath(runId);
  const env = buildEnv(container, app, settings);

  let bin, args;
  const pick = effectiveRunner(app, settings, opts);
  const useWine = pick.useWine;
  if (useWine) {
    const wineBin = (container && container.wineBin) || settings.wineBin || 'wine';
    bin = wineBin;
    args = [exePath].concat((app.args || '').split(' ').filter(Boolean));
    if (container && container.root) {
      env.WINEPREFIX = container.root; // le conteneur joue le rôle de préfixe Wine
      if (env.WINEDEBUG === undefined) env.WINEDEBUG = '-all';
    }
    if (IS_LINUX && env.DISPLAY === undefined) env.DISPLAY = process.env.VNC_DISPLAY || ':99';
  } else {
    bin = exePath;
    args = (app.args || '').split(' ').filter(Boolean);
  }

  if (container && container.root) {
    // Répertoire de travail : dossier du conteneur façon Winlator
    env.WORKDIR = container.root;
  }

  const cwd = (container && container.root) || path.dirname(exePath);
  if (useWine && container && container.root) ensurePrefix(container, env, (l) => store.appendLog(runId, l));
  let proc;
  try {
    proc = spawn(bin, args, { env, cwd, detached: false, windowsHide: !IS_LINUX });
  } catch (e) {
    return { ok: false, error: 'Échec du lancement : ' + e.message };
  }

  const meta = { appId, app: app.name, startedAt: new Date().toISOString(), runner: useWine ? 'wine' : 'native', pid: proc.pid };
  active.set(runId, { proc, meta });

  store.appendLog(runId, `[winlator-pc] Démarrage: ${app.name} (${meta.runner}${pick.reason ? ' — ' + pick.reason : ''}) pid=${proc.pid}`);
  store.appendLog(runId, `[winlator-pc] Exécutable: ${exePath}`);
  if (useWine && env.WINEPREFIX) store.appendLog(runId, `[winlator-pc] WINEPREFIX: ${env.WINEPREFIX}`);

  const stamp = (ch, tag) => (data) => {
    store.appendLog(runId, data.toString());
    if (opts.onOutput) opts.onOutput(runId, tag, data.toString());
  };
  proc.stdout.on('data', stamp('out', 'stdout'));
  proc.stderr.on('data', stamp('err', 'stderr'));

  proc.on('error', (e) => {
    store.appendLog(runId, `[winlator-pc] ERREUR: ${e.message}`);
  });
  proc.on('exit', (code, signal) => {
    store.appendLog(runId, `[winlator-pc] Fin (code=${code}${signal ? ', signal=' + signal : ''})`);
    const entry = active.get(runId);
    if (entry) {
      const runs = store.listRuns();
      runs.push(Object.assign({}, meta, { runId, endedAt: new Date().toISOString(), exitCode: code }));
      store.saveRuns(runs);
      active.delete(runId);
    }
    if (opts.onExit) opts.onExit(runId, code);
  });

  return { ok: true, runId, pid: proc.pid, runner: meta.runner, logFile };
}

function stopRun(runId) {
  const entry = active.get(runId);
  if (!entry) return { ok: false, error: 'Exécution non active.' };
  try { entry.proc.kill(); } catch (_) {}
  return { ok: true };
}

function listActive() {
  const out = [];
  for (const [runId, entry] of active) {
    out.push(Object.assign({ runId, running: true }, entry.meta));
  }
  return out;
}

module.exports = { startRun, stopRun, listActive, buildEnv };
