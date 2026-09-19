# Jiyi · 记忆

**500 mots de mandarin à apprendre depuis ton navigateur, avec une progression sauvegardée sur ton serveur.**

Jiyi (« mémoire » en chinois) est une petite application personnelle de cartes mémoire, en chinois → français. Elle s’utilise sur ordinateur ou sur iPhone via Safari, et peut être ajoutée à l’écran d’accueil. Aucun abonnement applicatif ni application iOS payante n’est nécessaire ; l’hébergement reste à ta charge.

Le projet fonctionne avec **Python et sa bibliothèque standard**, du HTML, du CSS et du JavaScript. Pas de framework, de dépendances Python ou de compilation du frontend.

## Ce qui est inclus

- **500 cartes** en caractères chinois simplifiés.
- Au verso : **pinyin avec les tons, sens en français, phrase d’exemple traduite**, mot surligné et notes d’usage lorsque c’est utile.
- **Audio du mot et de la phrase**, avec 992 fichiers MP3 embarqués pour 1 000 références audio ; quelques exemples sont partagés.
- 287 pictogrammes pour accompagner les mots concrets.
- Révisions espacées avec **À revoir / Difficile / Bien / Facile** et délai annoncé avant le prochain passage.
- **10 nouveaux mots par jour** par défaut, réglable entre 1 et 50.
- Un explorateur des 500 mots avec recherche en caractères, pinyin ou français.
- Progression enregistrée en **SQLite**, commune aux appareils utilisant la même installation.
- Export JSON de la progression depuis le menu de l’application.

Il s’agit d’une application à **un seul profil**, avec un algorithme simple de répétition espacée. Ce n’est ni Anki, ni son moteur FSRS, ni un serveur de synchronisation Anki. L’interface porte actuellement le nom « Mandarin ».

## Essayer en local

Prérequis : **Python 3.10 ou plus récent** et les données de fuseaux horaires du système (`tzdata` sur les distributions Linux qui ne les fournissent pas déjà).

```sh
git clone https://github.com/STOOOKEEE/jiyi.git
cd jiyi
python3 server.py
```

Ouvrir **http://127.0.0.1:8766**. La base `data/progress.sqlite3` est créée automatiquement. Les cartes et les MP3 sont déjà dans le dépôt.

Si le port est occupé :

```sh
PORT=8767 python3 server.py
# Ouvrir http://127.0.0.1:8767
```

Pour un essai avec une base distincte :

```sh
PORT=8767 MANDARIN_DB=/tmp/jiyi-dev.sqlite3 python3 server.py
```

Le serveur écoute uniquement sur **127.0.0.1**. Pour l’utiliser sur ton téléphone, suivre la section Tailscale ci-dessous.

## Réviser

1. Lire le caractère et essayer de retrouver sa prononciation et son sens.
2. Toucher **Voir la réponse**.
3. Écouter le mot et la phrase, puis répéter à voix haute.
4. Choisir une évaluation selon la facilité à retrouver le mot.

Les cartes dues passent avant les nouveaux mots. Les journées et la limite quotidienne suivent le fuseau **Europe/Paris**.

| Évaluation | Comportement |
| --- | --- |
| À revoir | Retour à 1 minute et reprise de l’apprentissage. |
| Difficile | 10 minutes pendant l’apprentissage ; ensuite un intervalle légèrement augmenté. |
| Bien | 1 jour si la carte est connue dès le premier passage. Après un oubli : 10 minutes, puis 1 jour, 6 jours et des intervalles croissants. |
| Facile | 4 jours pour une carte en apprentissage ; ensuite un délai toujours supérieur à « Bien ». |

Les boutons affichent le délai réellement calculé pour la carte. L’onglet **Les 500 mots** permet de consulter les réponses librement sans modifier la progression.

Une réponse en attente de sauvegarde est conservée dans le navigateur. En cas de coupure, utiliser **Réessayer la connexion** : le serveur reconnaît les renvois de la même réponse et évite de la compter deux fois. Une modification concurrente depuis un autre appareil provoque une actualisation plutôt qu’un écrasement silencieux.

**La connexion au serveur reste nécessaire**, y compris pour les audios. L’application ne propose pas de mode de révision hors ligne complet et ne met pas les MP3 en cache via un service worker.

## Héberger sur un serveur avec Tailscale

### 1. Installer le projet

Sur le serveur Linux, avec l’utilisateur qui exécutera l’application :

```sh
mkdir -p ~/dev/STOOOKEEE
git clone https://github.com/STOOOKEEE/jiyi.git ~/dev/STOOOKEEE/jiyi
cd ~/dev/STOOOKEEE/jiyi
python3 test.py
```

Installer et connecter **Tailscale sur le serveur et l’iPhone**, avec le même compte. Récupérer le nom DNS Tailscale du serveur, par exemple `your-server.your-tailnet.ts.net`. Voir la [documentation Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve).

### 2. Configurer le service

```sh
mkdir -p ~/.config/jiyi ~/.config/systemd/user
cp .env.example ~/.config/jiyi/env
chmod 600 ~/.config/jiyi/env
```

Éditer `~/.config/jiyi/env` et remplacer les valeurs d’exemple :

```ini
PORT=8766
PUBLIC_ORIGIN=https://your-server.your-tailnet.ts.net:9443
TAILSCALE_LOGIN=you@example.com
```

- `PUBLIC_ORIGIN` doit être l’adresse HTTPS exacte, **sans slash final**.
- `TAILSCALE_LOGIN` doit correspondre au compte Tailscale personnel autorisé.
- Choisir un port local libre et reporter le même port dans la commande Serve.
- Le programme ne charge pas automatiquement les fichiers `.env` : ici, **systemd** charge `~/.config/jiyi/env`.

```sh
cp jiyi.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now jiyi
```

Le fichier fourni suppose un clone dans `~/dev/STOOOKEEE/jiyi`. Si tu choisis un autre dossier ou un autre Python, adapter `WorkingDirectory` et `ExecStart` dans le service.

Pour démarrer le service utilisateur au démarrage du serveur, même sans connexion SSH, activer le *linger* si nécessaire avec les droits administrateur :

```sh
sudo loginctl enable-linger "$USER"
```

### 3. Donner une adresse HTTPS privée à l’application

Vérifier d’abord les services Tailscale existants :

```sh
tailscale serve status
```

Si le port HTTPS 9443 est libre :

```sh
tailscale serve --bg --https=9443 http://127.0.0.1:8766
```

La commande affiche l’adresse à ouvrir. Tailscale peut demander d’activer HTTPS pour ton réseau lors de la première utilisation. Selon la configuration du serveur, la commande peut nécessiter `sudo` ou un utilisateur opérateur Tailscale.

**Utiliser Serve, sans Funnel.** Le service est destiné au réseau privé Tailscale. Le backend contrôle l’identité `Tailscale-User-Login` transmise par Serve, vérifie l’origine des écritures et conserve sa base en dehors des fichiers publics. Ne pas exposer directement le backend sur Internet et ne pas laisser `TAILSCALE_LOGIN` vide pour ce déploiement.

### 4. Ajouter l’app sur iPhone

1. Activer Tailscale sur l’iPhone.
2. Ouvrir l’adresse HTTPS dans Safari.
3. Ouvrir le menu de la page, puis **Partager → Sur l’écran d’accueil**.
4. Activer **Ouvrir comme app web** si l’option apparaît, puis toucher **Ajouter**.

L’icône et le manifeste sont inclus. [Instructions Apple](https://support.apple.com/fr-fr/guide/iphone/iphea86e5236/ios).

## Configuration

| Variable | Valeur par défaut | Utilité |
| --- | --- | --- |
| `PORT` | `8766` | Port local du serveur, qui reste lié à `127.0.0.1`. |
| `PUBLIC_ORIGIN` | `http://127.0.0.1:<PORT>` | Origine exacte autorisée pour les requêtes du navigateur. |
| `TAILSCALE_LOGIN` | vide | Compte Tailscale autorisé ; vide uniquement pour un usage local. |
| `MANDARIN_DB` | `data/progress.sqlite3` dans le projet | Chemin de la base de progression ; préférer un chemin absolu si personnalisé. |

## Sauvegarder et restaurer la progression

Le menu de l’app propose **Exporter ma progression** : un fichier JSON contenant les cartes apprises, les révisions et le réglage quotidien. Il n’existe pas encore d’import JSON dans l’interface.

Pour une sauvegarde SQLite complète à chaud, depuis le dossier du projet et avec le même `MANDARIN_DB` que le service s’il est personnalisé :

```sh
python3 - <<'PY'
import datetime
import pathlib
import sqlite3
import server

folder = pathlib.Path('backups')
folder.mkdir(exist_ok=True)
target = folder / ('progress-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.sqlite3')
if not server.DATABASE.is_file():
    raise SystemExit('Base introuvable : vérifier le chemin MANDARIN_DB.')
source = sqlite3.connect(server.DATABASE)
dest = sqlite3.connect(target)
try:
    source.backup(dest)
finally:
    dest.close()
    source.close()
print(target)
PY
```

SQLite utilise WAL : **ne pas copier uniquement le fichier principal pendant que l’app tourne**. L’API `backup()` ci-dessus produit une copie cohérente. Aucune sauvegarde périodique automatique n’est configurée par le projet.

Pour restaurer une sauvegarde avec le chemin par défaut, arrêter l’app et conserver l’ancien dossier avant le remplacement :

```sh
systemctl --user stop jiyi
mv data "data-before-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 data
cp backups/progress-YYYYMMDD-HHMMSS.sqlite3 data/progress.sqlite3
chmod 600 data/progress.sqlite3
systemctl --user start jiyi
```

Adapter le chemin si `MANDARIN_DB` est personnalisé. Les dossiers `data/` et `backups/`, les bases SQLite et les configurations privées sont ignorés par Git.

## Reprendre le développement

```text
server.py                 HTTP, contrôle d’accès, SQLite et planification
test.py                   Vérifications fonctionnelles avec une base temporaire
public/index.html         Structure de l’interface
public/app.js             Cartes, audio, recherche et sauvegarde des réponses
public/style.css          Présentation mobile et ordinateur
public/deck.json          Les 500 mots et les chemins vers leurs audios
public/media/             Les 992 fichiers MP3
public/manifest.webmanifest  Installation sur l’écran d’accueil
jiyi.service              Exemple de service systemd utilisateur
.env.example              Exemple de configuration du service
```

Commandes utiles :

```sh
python3 test.py
node --check public/app.js  # Facultatif : nécessite Node, qui n’est pas requis pour l’app.
systemctl --user status jiyi
journalctl --user -u jiyi -n 50 --no-pager
```

Les tests vérifient la planification, la limite quotidienne, la persistance, les réponses dupliquées ou obsolètes, l’accès Tailscale, la protection CSRF, les fichiers privés, les requêtes audio partielles utilisées par Safari et l’export.

Pour modifier une carte, éditer `public/deck.json`. **Garder son `id` stable** : la progression utilise cet identifiant. Chaque carte référence `audio_word` et `audio_sentence`, relatifs au dossier `public/`. Modifier un texte ne régénère pas automatiquement son audio. Le serveur autorise actuellement les fichiers MP3 nommés `zhfr_<20 caractères hexadécimaux>.mp3`.

Après modification du deck, redémarrer le serveur car il charge les cartes au démarrage. L’interface et les compteurs comportent encore quelques libellés « 500 » : les adapter si le nombre de cartes change. Il n’y a actuellement ni import de decks Anki, ni éditeur de cartes intégré, ni gestion de plusieurs profils.

### Mettre à jour une installation

Après avoir sauvegardé la progression, et depuis le clone utilisé par le service :

```sh
git pull --ff-only
python3 test.py
systemctl --user restart jiyi
```

Les fichiers de progression ne sont pas suivis par Git. Si l’installation active utilise un dossier de déploiement distinct du clone, recopier uniquement le code et les fichiers publics, **sans écraser `data/` ni la configuration privée**.

### Arrêter l’application

```sh
systemctl --user disable --now jiyi
tailscale serve --https=9443 off
```

Éviter `tailscale serve reset` : cette commande supprimerait aussi les autres services configurés sur la machine.

## Contenu et crédits

Le vocabulaire est une **sélection pédagogique de mots courants pour débutants**, issue des niveaux 1 à 3 de l’ancien HSK. Ce n’est pas un classement universel des 500 mots les plus fréquents ni une liste officielle d’un examen HSK actuel.

- Liste source : [Complete HSK Vocabulary](https://github.com/jelleverheyen/hsk-vocabulary), travail dérivé de Yanis Zafirópulos / Dr. Kameleon. Sa [licence MIT](public/LICENSE-vocabulary.txt) est conservée.
- Référence lexicale : [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cedict), sous [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Les adaptations lexicales concernées restent soumises à cette licence.
- Traductions françaises, exemples et cartes préparés pour ce projet avec une assistance IA ; pas de relecture complète par un enseignant natif.
- Audios synthétiques générés avec la voix mandarine Tingting de macOS ; ce ne sont pas des enregistrements de locuteurs humains.
- Les pictogrammes sont des emojis et leur rendu dépend de l’appareil.

Le pinyin indique principalement les tons lexicaux ; la prononciation peut changer dans une phrase. Les définitions courtes ne couvrent pas tous les sens d’un mot.
