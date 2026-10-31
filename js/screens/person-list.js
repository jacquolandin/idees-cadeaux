// =============================================================================
//  Liste d'une personne dans un événement
// =============================================================================
import { loadEvents, loadIdeas, ideaOpenTo, listedPersons } from '../api.js';
import { html, render, fullName, isClosed, showError } from '../lib.js';
import { state, refresh } from '../app.js';
import { ideaCard, bindIdeaActions, addIdeaDialog } from './ideas-ui.js';

export async function personListScreen(root, eventId, personId) {
  const { events, personById } = await loadEvents();
  const ev = events.find((e) => e.id === eventId);
  const owner = personById.get(personId) || state.managed.find((p) => p.id === personId);

  if (!ev || !owner || !listedPersons(ev).includes(personId)) {
    render(root, html`<div class="empty"><h1>Liste introuvable</h1>
      <a class="btn btn-primary" href="${ev ? `#/evenement/${ev.id}` : '#/'}">Retour</a></div>`);
    return;
  }

  const me = state.me.id;
  const ownerView = personId === me;                       // ma propre liste
  const managerView = owner.managed_by === me;              // un profil que je gère
  const closed = isClosed(ev);
  const name = fullName(owner);

  const ideas = (await loadIdeas([personId]))
    .filter((i) => ideaOpenTo(i, ev.id))
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, 'fr'));

  const ctx = {
    me,
    ownerName: owner.first_name,
    ownerView,
    managerView,
    canClaim: !closed && !ownerView,
    authorName: (id) => fullName(personById.get(id)) || 'un proche',
  };

  let intro;
  if (ownerView) {
    intro = closed
      ? 'L’événement est clôturé : tu vois maintenant ce qu’on t’a offert.'
      : 'Tu ne vois ni les réservations, ni les idées ajoutées en secret par tes proches : la surprise reste entière.';
  } else if (managerView) {
    intro = `Tu gères la liste de ${owner.first_name} : tu vois tout, réservations et idées secrètes comprises.`;
  } else {
    intro = closed
      ? 'Événement clôturé : la liste est en lecture seule.'
      : `Choisis un cadeau et réserve-le pour éviter les doublons. ${owner.first_name} ne le verra pas avant la fin de l’événement.`;
  }

  render(root, html`
    <a class="back" href="#/evenement/${ev.id}">← ${ev.title}</a>
    <header class="page-head">
      <h1>${ownerView ? 'Ma liste' : `Liste de ${name}`}</h1>
      <p class="meta">${intro}</p>
    </header>

    ${!closed ? html`<button type="button" class="btn btn-primary btn-block" id="add-idea">
      ${ownerView ? 'Ajouter une idée' : `Ajouter une idée pour ${owner.first_name}`}</button>` : ''}

    ${ideas.length
      ? html`<div class="ideas">${ideas.map((i) => ideaCard(i, ctx))}</div>`
      : html`<div class="empty-inline">
          <p>${ownerView ? 'Ta liste est vide pour cet événement.' : `${owner.first_name} n’a pas encore d’idée ici.`}</p>
          <p class="hint">${ownerView
            ? 'Ajoute des idées : tes proches pourront les réserver sans que tu le saches.'
            : `Tu peux lui en suggérer une : elle restera secrète pour ${owner.first_name}.`}</p>
        </div>`}
  `);

  bindIdeaActions(root, ideas, {
    eventId: ev.id, eventTitle: ev.title, ownerName: owner.first_name, onChange: refresh,
  });

  root.querySelector('#add-idea')?.addEventListener('click', async () => {
    try {
      const mode = ownerView ? 'own' : managerView ? 'managed' : 'secret';
      const idea = await addIdeaDialog({
        me, ownerId: personId, ownerName: owner.first_name, mode, eventId: ev.id,
      });
      if (idea) refresh();
    } catch (err) { showError(err); }
  });
}
