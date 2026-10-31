// =============================================================================
//  Accueil : liste des événements (ouverts puis archives repliées)
// =============================================================================
import { loadEvents } from '../api.js';
import { html, render, formatDate, relativeDays, isClosed, fullName } from '../lib.js';
import { state } from '../app.js';

const BANNER_KEY = 'recoveryBannerHiddenUntil';

export async function eventsScreen(root) {
  const { events, personById } = await loadEvents();
  const open = events.filter((e) => !isClosed(e));
  const closed = events.filter(isClosed).reverse();

  // Bannière discrète : ajouter un e-mail de récupération
  const hiddenUntil = Number(localStorage.getItem(BANNER_KEY) || 0);
  const showBanner = state.user?.is_anonymous && !state.user?.email
    && !state.user?.new_email && Date.now() > hiddenUntil;

  const card = (ev) => {
    const honorees = ev.honorees.map((id) => personById.get(id)).filter(Boolean);
    const closedNow = isClosed(ev);
    return html`
      <li>
        <a class="card event-card ${closedNow ? 'is-closed' : ''}" href="#/evenement/${ev.id}">
          <span class="event-card-title">${ev.title}</span>
          <span class="event-card-meta">
            ${ev.event_date ? formatDate(ev.event_date, { short: true }) : 'Sans date'}
            ${!closedNow && ev.event_date ? html` · <strong>${relativeDays(ev.event_date)}</strong>` : ''}
          </span>
          <span class="event-card-meta">
            ${ev.kind === 'collective'
              ? 'Échange collectif'
              : html`Pour ${honorees.map(fullName).join(', ') || '…'}`}
            · ${ev.members.length} participant${ev.members.length > 1 ? 's' : ''}
          </span>
          <span class="badges">
            ${ev.is_surprise ? html`<span class="badge badge-surprise">Surprise</span>` : ''}
            ${closedNow ? html`<span class="badge">Clôturé</span>` : ''}
          </span>
        </a>
      </li>`;
  };

  render(root, html`
    <header class="page-head">
      <h1>Bonjour ${state.me.first_name}</h1>
    </header>

    ${showBanner ? html`
      <aside class="banner" aria-label="Récupération du compte">
        <p>Ajoute ton e-mail pour retrouver ton compte sur un autre téléphone.</p>
        <div class="row">
          <a class="btn btn-secondary btn-small" href="#/profil">Ajouter mon e-mail</a>
          <button type="button" class="btn btn-link btn-small" id="hide-banner">Plus tard</button>
        </div>
      </aside>` : ''}

    <a class="btn btn-primary btn-block" href="#/evenement/nouveau">Créer un événement</a>

    <h2 class="section-title">Mes événements</h2>
    ${open.length
      ? html`<ul class="cards">${open.map(card)}</ul>`
      : html`<div class="empty-inline">
          <p>Aucun événement en cours.</p>
          <p class="hint">Crée-en un (Noël, anniversaire…) ou ouvre le lien d’invitation
          qu’un proche t’a envoyé par message.</p>
        </div>`}

    ${closed.length ? html`
      <details class="archives">
        <summary>Archives (${closed.length})</summary>
        <ul class="cards">${closed.map(card)}</ul>
      </details>` : ''}
  `);

  root.querySelector('#hide-banner')?.addEventListener('click', (e) => {
    localStorage.setItem(BANNER_KEY, String(Date.now() + 30 * 86400000));
    e.target.closest('.banner').remove();
  });
}
