# 🍷 Winlator PC Edition — Cloud (Render)

Déploie **Winlator PC Edition** sur [Render](https://render.com) : l'interface et l'API
de Winlator dans le cloud, avec **écran distant noVNC** dans le navigateur pour voir et
contrôler les applications Windows lancées via **Wine**.

```
Navigateur ──HTTPS──────────► Render (port unique)
                               ├─ Node server.js (API + interface + upload)
                               ├─ WebSocket /websockify → x11vnc (127.0.0.1:5900)
                               └─ Wine sous Xvfb (:99) → apps Windows
```

## Fichiers

| Fichier | Rôle |
|---|---|
| `cloud/Dockerfile` | Image Debian + Wine + Xvfb + x11vnc + Node |
| `cloud/start-cloud.sh` | Démarre Xvfb puis `server.js` (utilise `$PORT` de Render) |
| `render.yaml` | Blueprint : build Docker, token auto, disque persistant 1 Go |
| `.dockerignore` | Exclut `data/`, `tools/`, lanceurs Windows du contexte |

## Déployer en 4 étapes

1. **Pousse** le dossier `pc-edition` dans un dépôt Git (GitHub/GitLab).
2. Sur Render : **New → Blueprint**, sélectionne le dépôt — le `render.yaml` est détecté.
3. Attends le build (~5-10 min la première fois). Note le **`WINLATOR_TOKEN`** généré
   (Dashboard → ton service → **Environment**).
4. Ouvre l'URL du service. Le site demande le token une seule fois (cookie 24 h).

## Utilisation

- **Ajouter une app** : `+ Ajouter` → choisis un fichier local (`.exe`, `.msi`, `.bat`,
  `.cmd`, `.zip`, `.7z`, `.rar`, max ~25 Mo) → il est uploadé dans `/app/data/apps/`.
- **Lancer** : bouton `▶ Lancer` — sous Linux, le passage par **Wine est automatique**
  (WINEPREFIX = conteneur, affichage sur Xvfb `:99`).
- **Voir l'écran** : bouton **🖥 Écran distant** → noVNC s'ouvre sur l'écran de l'application.

### Accès API

Ajoute `x-winlator-token: <TOKEN>` (ou `?token=`) à chaque requête :

```bash
curl -H "x-winlator-token: $TOKEN" https://ton-service.onrender.com/api/state
```

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `WINLATOR_TOKEN` | — (généré par Render) | Mot de passe d'accès (API + écran VNC) |
| `VNC_ENABLED` | `1` | Active l'écran distant noVNC |
| `VNC_GEOMETRY` | `1280x720x24` | Résolution de l'écran virtuel |
| `WINEBOOT_ON_START` | `0` | `1` = initialise le préfixe Wine au démarrage |
| `WINEPREFIX` | `/app/data/containers/default` | Préfixe initialisé par `WINEBOOT_ON_START=1` |

## Limites (Render sans GPU)

- **Rendu logiciel** : pas de GPU → pas de DXVK/Vulkan. Apps bureautiques et jeux 2D
  anciens OK ; les jeux 3D récents ne tourneront pas correctement.
- **Upload ~25 Mo max** : au-delà, passe par un `.zip` découpé ou un URL direct
  (extension possible plus tard : import par URL dans `/api/upload`).
- **Instance free** : s'endort après 15 min sans trafic — la session X/Wine meurt avec.
  Utilise un plan **Starter** (7 $/mois) pour une session qui reste vivante.
- **1 seule session partagée** : tous les visiteurs authentifiés voient le même écran.

## Coût Render

| Plan | Prix | Adapté pour |
|---|---|---|
| Free | 0 $/mois | Page statique, tests |
| **Starter** | **7 $/mois** | Usage réel : session vivante + disque persistant |
| Standard | 25 $/mois | Apps Windows un peu gourmandes (2 CPU / 4 Go) |

## Tests

```bash
node test/wsproxy.test.js   # pont WebSocket→VNC (4 assertions)
node test/smoke.test.js     # serveur complet (11 assertions)
```

## Sécurité

- Token **obligatoire** pour l'API et l'upgrade WebSocket VNC (401 sinon).
- `x11vnc` écoute uniquement sur `127.0.0.1` — jamais exposé directement.
- Upload limité aux extensions `.exe/.msi/.bat/.cmd/.zip/.7z/.rar`, noms assainis.
- Charte d'utilisation : n'exécute que du contenu dont tu as le droit — pas de piratage.
