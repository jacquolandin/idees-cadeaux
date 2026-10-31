// =============================================================================
//  Démarrage de l'application, état global et navigation par fragment (#/...)
// =============================================================================
import { sb, configured, getMyPerson, listManaged } from './api.js';
import { html, render, raw, ICONS, errorMessage, toast } from './lib.js';
import { APP_NAME } from '../config.js';

import { welcomeScreen, joinScreen } from './screens/welcome.js';
import { eventsScreen } from './screens/events.js';
import { eventFormScreen } from './screens/event-form.js';
import { eventDetailScreen } from './screens/event-detail.js';
import { personListScreen } from './screens/person-list.js';
import { myIdeasScreen } from './screens/my-ideas.js';
import { ideaFormScreen } from './screens/idea-form.js';
import { myClaimsScreen } from './screens/my-claims.js';
import { profileScreen } from './screens/profile.js';

// État partagé entre les écrans
export const state = {
  user: null,        // utilisateur Supabase (session anonyme ou permanente)
  me: null,          // ma ligne dans « persons »
  managed: [],       // mes profils gérés
  installPrompt: null,
};

const main = document.getElementById('main');
const nav = document.getElementById('tabbar');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const ID = '([0-9a-f-]{36})';
const routes = [
  { re: /^\/$/, screen: eventsScreen, tab: 'events' },
  { re: /^\/rejoindre\/([A-Za-z0-9_-]{16,})$/, screen: joinScreen, tab: 'events', public: true },
  { re: /^\/evenement\/nouveau$/, screen: eventFormScreen, tab: 'events' },
  { re: new RegExp(`^/evenement/${ID}/modifier$`), screen: eventFormScreen, tab: 'events' },
  { re: new RegExp(`^/evenement/${ID}/liste/${ID}$`), screen: personListScreen, tab: 'events' },
  { re: new RegExp(`^/evenement/${ID}(?:/(participants|invitation))?$`), screen: eventDetailScreen, tab: 'events' },
  { re: new RegExp(`^/idees(?:/${ID})?$`), screen: myIdeasScreen, tab: 'ideas' },
  { re: new RegExp(`^/idee/${ID}$`), screen: ideaFormScreen, tab: 'ideas' },
  { re: /^\/reservations$/, screen: myClaimsScreen, tab: 'claims' },
  { re: /^\/profil$/, screen: profileScreen, tab: 'profile' },
];

export function go(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) { route(); return; }
  if (replace) { history.replaceState(null, '', target); route(); } else { location.hash = target; }
}

// Réaffiche l'écran courant (après une modification)
export function refresh() {
  route({ keepScroll: true });
}

let routeSeq = 0;
async function route({ keepScroll = false } = {}) {
  const seq = ++routeSeq;
  const path = location.hash.startsWith('#/') ? location.hash.slice(1).split('?')[0] : '/';
  const match = routes.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);

  if (!match) { go('/', { replace: true }); return; }

  // Sans profil : écran de bienvenue (en mémorisant où l'on voulait aller)
  if (!state.me) {
    if (path !== '/') sessionStorage.setItem('pendingRoute', path);
    renderNav(null);
    await welcomeScreen(main);
    return;
  }

  renderNav(match.r.tab);
  const scrollY = window.scrollY;
  if (!keepScroll) render(main, html`<p class="loading" role="status">Chargement…</p>`);
  try {
    await match.r.screen(main, ...match.m.slice(1));
    if (seq !== routeSeq) return;
    if (keepScroll) window.scrollTo(0, scrollY);
    else {
      window.scrollTo(0, 0);
      const h1 = main.querySelector('h1');
      if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    }
  } catch (err) {
    console.error(err);
    if (seq !== routeSeq) return;
    render(main, html`
      <div class="empty">
        <h1>Oups</h1>
        <p>${errorMessage(err)}</p>
        <a class="btn btn-primary" href="#/">Revenir à l'accueil</a>
      </div>`);
  }
}

// Après la création du profil : on reprend la route mémorisée
export function continueAfterWelcome() {
  const pending = sessionStorage.getItem('pendingRoute') || localStorage.getItem('pendingRoute');
  sessionStorage.removeItem('pendingRoute');
  localStorage.removeItem('pendingRoute');
  go(pending || '/', { replace: true });
}

// ---------------------------------------------------------------------------
// Barre de navigation du bas (4 entrées, icône + libellé)
// ---------------------------------------------------------------------------
function renderNav(active) {
  if (!active) { nav.hidden = true; document.body.classList.remove('has-nav'); return; }
  nav.hidden = false;
  document.body.classList.add('has-nav');
  const items = [
    ['events', '#/', 'Événements'],
    ['ideas', '#/idees', 'Mes idées'],
    ['claims', '#/reservations', 'Réservations'],
    ['profile', '#/profil', 'Profil'],
  ];
  render(nav, html`<ul>
    ${items.map(([key, href, label]) => html`
      <li><a href="${href}" ${key === active ? raw('aria-current="page"') : ''}>
        ${raw(ICONS[key])}<span>${label}</span></a></li>`)}
  </ul>`);
}

// ---------------------------------------------------------------------------
// Chargement de la personne connectée
// ---------------------------------------------------------------------------
export async function loadMe() {
  const { data: { user } } = await sb.auth.getUser();
  state.user = user;
  state.me = user ? await getMyPerson(user.id) : null;
  state.managed = state.me ? await listManaged(state.me.id) : [];
}

export async function reloadManaged() {
  state.managed = state.me ? await listManaged(state.me.id) : [];
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------
async function start() {
  document.title = APP_NAME;

  if (!configured) {
    render(main, html`
      <div class="empty">
        <h1>Configuration à terminer</h1>
        <p>Le fichier <code>config.js</code> doit contenir l'adresse et la clé publique
        de votre projet Supabase. Suivez l'étape 4 du README.</p>
      </div>`);
    return;
  }

  // Retour d'un lien magique : l'URL contient #access_token=... ou #error=...
  // supabase-js lit la session puis on remet une adresse propre.
  const hash = location.hash;
  const fromEmail = /access_token=|error=|error_description=/.test(hash);
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  await sb.auth.getSession();
  if (fromEmail) {
    const pending = localStorage.getItem('pendingRoute') || '/';
    localStorage.removeItem('pendingRoute');
    history.replaceState(null, '', '#' + pending);
    if (params.get('error_description')) {
      setTimeout(() => toast('Le lien reçu par e-mail n’est plus valable. Demande-en un nouveau.', 'error'), 300);
    } else {
      setTimeout(() => toast('C’est bon, ton compte est retrouvé.', 'success'), 300);
    }
  }

  try {
    await loadMe();
  } catch (err) {
    // Session invalide (compte supprimé par exemple) : on repart de zéro
    console.warn(err);
    await sb.auth.signOut().catch(() => {});
    state.user = null; state.me = null;
  }

  // Changement de compte (lien magique ouvert dans un autre onglet, etc.)
  sb.auth.onAuthStateChange((event, session) => {
    // (uniquement un vrai changement de compte : pas la toute première connexion,
    // déjà gérée par l'écran de bienvenue)
    if (event === 'SIGNED_IN' && state.user && session?.user?.id !== state.user.id) {
      loadMe().then(() => route()).catch(console.error);
    }
    if (event === 'USER_UPDATED') {
      state.user = session?.user ?? state.user;
    }
  });

  window.addEventListener('hashchange', () => route());
  route();
}

// Installation PWA : on garde l'invitation du navigateur pour l'écran Profil
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.installPrompt = e;
});

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

start();
