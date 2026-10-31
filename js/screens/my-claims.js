// =============================================================================
//  Mes réservations : groupées par événement puis par personne
// =============================================================================
import { myClaims, unclaimIdea } from '../api.js';
import {
  html, render, safeUrl, urlHost, formatDate, relativeDays, showError, toast, busy, confirmAction,
} from '../lib.js';
import { refresh } from '../app.js';

export async function myClaimsScreen(root) {
  const claims = await myClaims();

  // Regroupement : événement → personne → idées
  const groups = new Map();
  for (const c of claims) {
    const key = c.event_id || 'none';
    if (!groups.has(key)) {
      groups.set(key, {
        id: c.event_id, title: c.event_title || 'Événement', date: c.event_date,
        closed: c.event_closed, people: new Map(),
      });
    }
    const g = groups.get(key);
    if (!g.people.has(c.owner_id)) g.people.set(c.owner_id, { name: c.owner_name, items: [] });
    g.people.get(c.owner_id).items.push(c);
  }
  const all = [...groups.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const open = all.filter((g) => !g.closed);
  const done = all.filter((g) => g.closed).reverse();

  const block = (g) => html`
    <section class="claims-group">
      <h2 class="h-section">
        ${g.id ? html`<a href="#/evenement/${g.id}">${g.title}</a>` : g.title}
      </h2>
      <p class="meta">${g.date ? formatDate(g.date) : 'Sans date'}${!g.closed && g.date
        ? html` · <strong>${relativeDays(g.date)}</strong>` : ''}</p>
      ${[...g.people.values()].map((p) => html`
        <h3 class="claims-person">Pour ${p.name}</h3>
        <ul class="list">
          ${p.items.map((c) => {
            const url = safeUrl(c.idea_url);
            return html`<li class="list-item claim-item">
              <div>
                <strong>${c.idea_title}</strong>
                ${url ? html`<a class="idea-link" href="${url}" target="_blank" rel="noopener noreferrer nofollow">
                  Voir le lien<span class="host"> (${urlHost(url)})</span>
                  <span class="visually-hidden">, s’ouvre dans un nouvel onglet</span></a>` : ''}
                <span class="meta">${c.is_group ? 'Cadeau groupé' : 'Cadeau simple'}${c.is_anonymous ? ' · anonyme' : ''}</span>
              </div>
              ${!g.closed ? html`<button type="button" class="btn btn-secondary btn-small"
                data-unclaim="${c.idea_id}" data-title="${c.idea_title}">Annuler</button>` : ''}
            </li>`;
          })}
        </ul>`)}
    </section>`;

  render(root, html`
    <header class="page-head">
      <h1>Mes réservations</h1>
      <p class="meta">Ce que tu offres, à acheter avant la date.</p>
    </header>
    ${open.length ? open.map(block) : html`<div class="empty-inline">
      <p>Tu n’as rien réservé pour l’instant.</p>
      <p class="hint">Ouvre un événement puis la liste d’un proche, et touche « Je l’offre ».</p>
      <a class="btn btn-primary" href="#/">Voir mes événements</a></div>`}
    ${done.length ? html`<details class="archives">
      <summary>Déjà offerts (${done.length} événement${done.length > 1 ? 's' : ''})</summary>
      ${done.map(block)}
    </details>` : ''}
  `);

  root.querySelectorAll('[data-unclaim]').forEach((b) => b.addEventListener('click', async () => {
    const ok = await confirmAction('Annuler ?', `Ta réservation sur « ${b.dataset.title} » sera annulée.`,
      'Annuler la réservation', false);
    if (!ok) return;
    await busy(b, async () => {
      try { await unclaimIdea(b.dataset.unclaim); toast('Réservation annulée.'); refresh(); } catch (err) { showError(err); }
    });
  }));
}
