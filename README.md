# 🍷 Winlator PC Edition

Fork **PC** de [Winlator-CMOD](https://github.com/Stredohori/Winlator-CMOD) : l'application Android réinventée pour Windows, en **Node.js pur (zéro dépendance)**.

Là où Winlator Android fait tourner Wine + Box86/64 dans un conteneur PRoot pour exécuter des `.exe` sur mobile, cette édition PC apporte les **mêmes concepts** (conteneurs, couches de variables d'environnement, presets, journaux par exécution) à ton bureau Windows — où les `.exe` se lancent nativement.

## 🚀 Démarrage rapide

1. **Lancer** : double-cliquez sur `start.bat`
   → démarre le serveur local et ouvre l'interface sur `http://localhost:8799`
2. **Ajouter une application** : bouton **« + Ajouter »** → indiquez le chemin du `.exe`
3. **Lancer** : bouton **▶ Lancer** (natif) ou **🍷** (force le passage par Wine si installé)

Prérequis : **Node.js 18+** (testé avec Node 22). Aucun `npm install`.

## 🧩 Concepts (repris de Winlator)

| Winlator Android | Winlator PC Edition |
|---|---|
| Conteneur (rootfs + préfixe Wine) | **Conteneur** : dossier `data/containers/<id>/` avec `drive_c/`, utilisé comme `WINEPREFIX` sous Wine |
| Presets Box86/Box64 | **Couches ENV** : `global` < `conteneur` < `app` (la dernière gagne) |
| `MESA_EXTENSION_MAX_YEAR=2003` pour vieux jeux | Mettez `ENABLE_MESA_LEGACY=1` (ou la variable directement) dans les ENV |
| Raccourcis par jeu avec réglages individuels | **Applications** : chaque app a ses args + ENV + conteneur |
| Logcat | **Journaux** par exécution dans `data/logs/<runId>.log` |

## 🖥️ Raccourcis & démarrage automatique

```powershell
# Créer le raccourci bureau + démarrage auto de session (icône vin incluse) :
powershell -NoProfile -ExecutionPolicy Bypass -File install-shortcuts.ps1

# Raccourci bureau seulement :
powershell -NoProfile -ExecutionPolicy Bypass -File install-shortcuts.ps1 -NoAutostart

# Tout retirer :
powershell -NoProfile -ExecutionPolicy Bypass -File install-shortcuts.ps1 -Remove
```

- **`Winlator PC.lnk`** (bureau) : ouvre le serveur + l'interface, sans fenêtre noire.
- **`Winlator PC (auto).lnk`** (dossier Démarrage) : lance le serveur en arrière-plan à l'ouverture de session ; ouvre l'interface avec `http://localhost:8799` quand tu veux.
- **`stop-winlator.bat`** : arrête le serveur proprement.
- Icône régénérable : `node tools/make-icon.js`.

## ⌨️ CLI

```cmd
winelorun.cmd                    \rem liste les applications
winelorun.cmd "Mon Jeu"          \rem lance par nom
winelorun.cmd "Mon Jeu" --wine   \rem force Wine
```

## 📁 Structure

```
pc-edition/
├── server.js          # Serveur HTTP + API REST (sans dépendance)
├── cli.js             # Lancement en ligne de commande
├── lib/store.js       # Persistance JSON (conteneurs, apps, runs, réglages)
├── lib/runner.js      # Exécuteur : env en couches, natif/Wine, logs
├── www/index.html     # Interface (HTML/CSS/JS autonome)
├── start.bat          # Lanceur Windows
├── winelorun.cmd      # CLI Windows
└── data/              # Créé au premier lancement (jamais versionné)
```

## 🔧 API REST

| Méthode | Route | Description |
|---|---|---|
| GET | `/api/state` | Tout l'état (conteneurs, apps, runs, réglages) |
| POST | `/api/containers` | Créer un conteneur `{name, wineBin, env}` |
| DELETE | `/api/containers/:id` | Supprimer (refus si des apps y sont liées) |
| POST | `/api/apps` | Ajouter `{name, exePath, args, containerId, env}` |
| POST | `/api/apps/:id/run` | Lancer (natif) |
| POST | `/api/apps/:id/run-wine` | Lancer via Wine |
| POST | `/api/runs/:id/stop` | Arrêter une exécution |
| GET | `/api/runs/:id/log` | Journal (200 dernières lignes) |

## 🔒 Sécurité

- Le serveur n'écoute que sur `127.0.0.1` — inaccessible depuis le réseau.
- Les chemins statiques sont normalisés (pas de traversée `../`).
- Le port est modifiable : `WINLATOR_PC_PORT=9000 node server.js` ou fichier `data/settings.json`.

## 🧪 Wine (optionnel)

Sur Windows, Wine n'est nécessaire **que** pour des cas spécifiques (ex : tester un préfixe). Sans Wine, tout se lance en **natif** — ce qui est le comportement normal sur PC. Sous Linux, installez `wine` et l'édition PC l'utilisera automatiquement avec `WINEPREFIX` pointant vers le conteneur.

## 📜 Remerciements

Projet original : **Winlator** par brunodev85, fork **CMOD** par Stredohori et la communauté.
Cette édition PC : adaptation desktop Node.js générée avec [Freebuff](https://freebuff.com).
