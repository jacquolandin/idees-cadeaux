# 🎁 Idées Cadeaux

Site gratuit où la famille et les amis déclarent leurs listes de cadeaux, les partagent par événement (Noël, anniversaire…) et se répartissent les achats **sans doublon ni spoiler**.

- Pas de mot de passe : on tape son prénom, le téléphone s'en souvient.
- Le secret (idées ajoutées par d'autres, réservations, anniversaires surprise) est garanti **par la base de données**, pas seulement caché à l'écran.
- Hébergement gratuit : GitHub Pages + Supabase (plan gratuit).

---

## Mise en ligne pas à pas (≈ 30 minutes)

### 1. Créer le projet Supabase

1. Créez un compte gratuit sur [supabase.com](https://supabase.com).
2. **New project** : donnez un nom (ex. `idees-cadeaux`), choisissez une région en Europe (**Paris** ou **Frankfurt**), notez le mot de passe de la base dans un endroit sûr.
3. Patientez une à deux minutes pendant la création.

### 2. Activer les connexions anonymes

1. Menu **Authentication** → **Sign In / Providers** (ou **Providers** selon la version).
2. Activez **Allow anonymous sign-ins** et enregistrez.
3. Toujours dans Authentication → **URL Configuration** :
   - **Site URL** : l'adresse de votre site GitHub Pages (étape 5), par exemple `https://votre-identifiant.github.io/idees-cadeaux/`
   - **Redirect URLs** : ajoutez cette même adresse.

   > Vous pouvez revenir faire ce réglage après l'étape 5, quand vous connaîtrez l'adresse exacte.

### 3. Créer la base

1. Menu **SQL Editor** → **New query**.
2. Ouvrez le fichier `supabase/schema.sql`, copiez **tout** son contenu, collez-le, cliquez **Run**. Le message « Success. No rows returned » s'affiche.
3. Nouvelle requête : collez le contenu de `supabase/recettes.sql`, cliquez **Run**.
   Le résultat doit afficher **« Toutes les recettes sont passées »**. Ce script teste les règles de secret puis annule tout : il ne laisse aucune donnée.

> `schema.sql` s'exécute **une seule fois**, sur un projet neuf.

### 4. Récupérer les clés et compléter `config.js`

1. Menu **Project Settings** → **API** (ou **Data API** / **API Keys**).
2. Copiez le **Project URL** (ex. `https://abcdefgh.supabase.co`) et la clé **anon public** (ou **publishable**).
3. Ouvrez `config.js` et remplacez les deux valeurs :
   ```js
   export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
   Cette clé est faite pour être publique. **Ne copiez jamais la clé `service_role` (ou `secret`)**.

### 5. Publier sur GitHub Pages

1. Sur GitHub, le dépôt doit être **public** et contenir tous les fichiers (`index.html` à la racine).
2. Dans le dépôt : **Settings** → **Pages** → *Source* : **Deploy from a branch** → branche **main**, dossier **/ (root)** → **Save**.
3. Au bout d'une minute, l'adresse du site apparaît en haut de la page (ex. `https://votre-identifiant.github.io/idees-cadeaux/`). Reportez-la dans Supabase (étape 2.3).

Pour modifier `config.js` directement sur GitHub : ouvrez le fichier, cliquez sur le crayon ✏️, modifiez, puis **Commit changes**. Le site se met à jour en une minute.

### 6. Empêcher la mise en pause

Le plan gratuit de Supabase met en pause un projet inactif depuis environ une semaine. Le fichier `.github/workflows/keepalive.yml` l'interroge **tous les trois jours** automatiquement (il lit l'adresse et la clé dans `config.js`).

- Vérifiez qu'il fonctionne : onglet **Actions** du dépôt → **Keepalive Supabase** → **Run workflow**. Une coche verte = OK.
- GitHub peut désactiver les tâches planifiées d'un dépôt resté inactif 60 jours : il suffit alors de les réactiver dans l'onglet Actions.
- Si le projet se met quand même en pause, un clic sur **Restore project** dans Supabase le relance **sans perte de données**.

### 7. E-mail de récupération (facultatif)

Chacun peut ajouter son e-mail (écran Profil) pour retrouver son compte sur un autre téléphone. Le service d'e-mail intégré à Supabase est très limité (quelques e-mails par heure) : suffisant pour une famille. Si le site grandit, branchez un SMTP gratuit (Brevo, Resend) dans **Authentication → SMTP Settings**.

Vous pouvez aussi traduire les modèles d'e-mail en français dans **Authentication → Email Templates** (« Confirm signup », « Magic Link », « Change Email Address »).

### 8. Tester sur téléphone

1. Ouvrez le site, tapez votre prénom, créez un événement.
2. Copiez le lien d'invitation et ouvrez-le dans **un autre navigateur** (ou en navigation privée) : vous jouez le rôle d'un invité.
3. Vérifiez que l'invité peut réserver une idée, et que vous ne le voyez pas dans votre propre liste.

---

## Utilisation en bref

| Écran | À quoi il sert |
|---|---|
| **Événements** | Les événements en cours (et les archives). Bouton « Créer un événement ». |
| **Détail d'un événement** | Onglets *Listes* (une liste par personne), *Participants*, *Invitation* (lien à partager). |
| **Liste d'une personne** | Réserver (« Je l'offre »), ouvrir un cadeau groupé, ajouter une idée secrète pour elle. |
| **Mes idées** | Ma liste permanente, avec pour chaque idée : tous mes événements, certains, ou gardée pour moi. « Agir pour » bascule vers un profil géré. |
| **Réservations** | Ce que j'offre, par événement puis par personne. |
| **Profil** | Prénom, e-mail de récupération, « J'ai déjà un compte », profils gérés, installation, suppression du compte. |

**Installer comme une application** : sur iPhone, Safari → bouton Partager → « Sur l'écran d'accueil ». Sur Android, Chrome → menu ⋮ → « Installer l'application ».

---

## Contenu du dépôt

```
index.html               page unique de l'application
styles.css               mise en page (thème clair et sombre automatique)
config.js                adresse et clé publique Supabase — À COMPLÉTER
manifest.webmanifest     installation sur téléphone (PWA)
sw.js                    mise en cache de l'application (pas des données)
icons/                   icônes
js/app.js                démarrage, navigation (#/...), barre du bas
js/api.js                accès à Supabase
js/lib.js                échappement HTML, dates, messages, boîtes de dialogue
js/screens/*.js          un fichier par écran
supabase/schema.sql      tables, règles de sécurité (RLS), fonctions
supabase/recettes.sql    tests des règles de secret (annulés à la fin)
.github/workflows/keepalive.yml   ping tous les trois jours
```

Aucune étape de compilation : on modifie un fichier, on le publie, c'est en ligne.

---

## Sécurité

- Toutes les tables ont des politiques **RLS**. Le rôle non connecté n'a accès à rien.
- Les réservations (`claims`) et les cadeaux groupés (`idea_groups`) ne sont **jamais lisibles directement** : on passe par les vues `v_claims` / `v_groups`, qui masquent l'identité des réservants anonymes et cachent toute réservation au propriétaire tant que l'événement n'est pas clôturé.
- Les actions sensibles (rejoindre, réserver, annuler, ouvrir un cadeau groupé, régénérer le lien…) passent par des fonctions SQL qui vérifient chaque règle.
- Le jeton d'invitation fait 64 caractères aléatoires ; il est vérifié côté base.
- Tout texte saisi est échappé avant affichage (protection XSS) ; seuls les liens `http`/`https` sont acceptés (vérifié aussi par la base). Une politique de sécurité de contenu (CSP) limite les scripts au site et au CDN de supabase-js.
- Clôture **sans tâche planifiée** : un événement est clôturé si `closed_at` est rempli ou si sa date est passée (minuit, heure de Paris).

Les recettes 1 à 9 du cahier des charges sont dans `supabase/recettes.sql`. La recette 10 (e-mail de récupération) se vérifie sur le site : la conversion d'un compte anonyme garde le même identifiant, donc toutes les données restent rattachées.

---

## Hypothèses et choix (là où le cahier des charges laissait une marge)

1. **Cadeau groupé** : le drapeau est rangé dans une table `idea_groups` plutôt que dans une colonne `ideas.is_group`, pour que le propriétaire ne puisse pas le lire par l'API (il trahirait qu'un cadeau se prépare).
2. **Événement d'une réservation** : on réserve depuis la liste d'un événement, et la réservation est enregistrée pour **cet événement**. Pas de choix d'un autre événement dans la boîte de dialogue (plus simple).
3. **Événement « pour une personne »** : seules les listes des concernés sont lisibles, y compris par l'API (les idées des simples donneurs ne fuient pas via cet événement).
4. **Profils gérés** : un gestionnaire peut inscrire ses profils gérés à un **échange collectif** dont il est membre (l'enfant a sa liste dans Noël). Le gestionnaire voit aussi les événements où figure un profil qu'il gère.
5. **Ouvrir aux participations** n'est possible que si l'idée est libre, ou réservée par soi-même (on ne transforme pas la réservation de quelqu'un d'autre en cadeau groupé).
6. **Surprise** : réservée aux événements « pour une personne ». On ne peut pas organiser sa propre surprise, ni désigner comme concerné quelqu'un qui participe déjà à l'événement.
7. **Clôture** : définitive. Un événement clôturé ne se modifie plus (sauf suppression par un organisateur) et ne se rouvre pas.
8. **Dernier organisateur qui part** : le participant le plus ancien ayant un compte devient organisateur automatiquement.
9. **Auteur d'une idée secrète qui supprime son compte** : l'idée reste (secrète) dans la liste, pour ne pas faire disparaître une réservation faite par un autre.
10. **Alerte de doublon** : comparaison simple (titres identiques ou l'un contenu dans l'autre, sans accents ni majuscules). Si l'idée proche est secrète et que vous ne pouvez pas la voir, l'alerte le dit sans révéler son titre ; le propriétaire n'est jamais alerté à propos d'une idée secrète.
11. **« J'ai déjà un compte »** sur un téléphone où un profil existe déjà : le profil local est abandonné au profit du compte retrouvé (un avertissement le signale).
12. Les liens saisis sans `https://` (ex. `amazon.fr/...`) sont complétés automatiquement.

## Limites connues (v1)

Pas de notification, pas de photo, pas d'aperçu automatique des liens, français uniquement, pas de mode hors ligne complet (seule l'application est en cache, pas les données). Voir la section 12 du cahier des charges pour les évolutions envisagées.
