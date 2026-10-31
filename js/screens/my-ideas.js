// =============================================================================
//  Mes idées (ou celles d'un profil que je gère : « Agir pour … »)
// =============================================================================
import { loadEvents, loadIdeas, addIdea } from '../api.js';
import { html, render, raw, fullName, PRIORITIES, showError, toast, busy } from '../lib.js';
import { state, refresh, go } from '../app.js';
import { ideaCard, bindIdeaActions, duplicateCheck } from './ideas-ui.js';

export async function myIdeasScreen(root, personId = null) {
  const me = state.me.id;
  if (personId === me) { go('/idees', { replace: true }); return; }
  const target = personId ? state.managed.find((p) => p.id === personId) : state.me;
  if (!target) {
    render(root, html`<div class="empty"><h1>Profil introuvable</h1>
      <a class="btn btn-primary" href="#/idees">Mes idées</a></div>`);
    return;
  }
  const managerView = target.id !== me;

  const [{ events, personById }, ideasRaw] = await Promise.all([
    loadEvents(), loadIdeas([target.id]),
  ]);
  // Les réservations viennent de la vue v_claims : pour moi-même, seules
  // celles des événements clôturés (« Offerts ») sont renvoyées par la base.

  const eventTitle = (id) => events.find((e) => e.id === id)?.title;
  const shareLabel = (idea) => {
    if (idea.share_mode === 'private') return 'Gardée pour moi';
    if (idea.share_mode === 'all') return 'Visible dans tous mes événements';
    const titles = idea.eventIds.map(eventTitle).filter(Boolean);
    return titles.length ? `Visible dans : ${titles.join(', ')}` : 'Visible dans aucun événement pour l’instant';
  };

  const sortFn = (a, b) => a.priority - b.priority || b.created_at.localeCompare(a.created_at);
  const offered = ideasRaw.filter((i) => i.claims.some((c) => c.event_closed)).sort(sortFn);
  const active = ideasRaw.filter((i) => !offered.includes(i)).sort(sortFn);

  const ctx = {
    me,
    ownerName: target.first_name,
    ownerView: !managerView,
    managerView,
    canClaim: false,
    authorName: (id) => fullName(personById.get(id)) || 'un proche',
    showShare: shareLabel,
  };

  render(root, html`
    <header class="page-head">
      <h1>${managerView ? `Idées de ${fullName(target)}` : 'Mes idées'}</h1>
      <p class="meta">${managerView
        ? `Tu gères cette liste. Tu vois tout, y compris les idées secrètes et les réservations.`
        : 'Ta liste permanente. Choisis pour chaque idée dans quels événements elle apparaît.'}</p>
    </header>

    ${state.managed.length ? html`
      <nav class="acting" aria-label="Agir pour">
        <span class="acting-label">Agir pour :</span>
        <a href="#/idees" ${!managerView ? raw('aria-current="page"') : ''}>Moi</a>
        ${state.managed.map((p) => html`<a href="#/idees/${p.id}"
          ${p.id === target.id ? raw('aria-current="page"') : ''}>${p.first_name}</a>`)}
      </nav>` : ''}

    <form id="quick-add" class="card stack" novalidate>
      <div class="field">
        <label for="qa-title">Nouvelle idée</label>
        <input id="qa-title" name="title" required maxlength="120"
               placeholder="Un livre, un jeu, une sortie…" enterkeyhint="done">
      </div>
      <div class="row wrap">
        <label class="inline-field" for="qa-prio">Envie
          <select id="qa-prio" name="priority">
            ${[1, 2, 3].map((p) => html`<option value="${p}" ${p === 2 ? raw('selected') : ''}>
              ${PRIORITIES[p].label}</option>`)}
          </select>
        </label>
        <label class="switch">
          <input type="checkbox" name="private" role="switch">
          <span>${managerView ? 'Garder pour nous (brouillon)' : 'Garder pour moi'}</span>
        </label>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Ajouter</button>
      <p class="hint">Lien et commentaire : touche « Modifier » sur l’idée après l’ajout.</p>
    </form>

    ${active.length
      ? html`<div class="ideas">${active.map((i) => ideaCard(i, ctx))}</div>`
      : html`<div class="empty-inline"><p>${managerView ? 'Cette liste est vide.' : 'Ta liste est vide.'}</p>
          <p class="hint">Ajoute une première idée : un livre, un objet, une expérience…</p></div>`}

    ${offered.length ? html`
      <h2 class="section-title">Offerts</h2>
      <div class="ideas">${offered.map((i) => ideaCard(i, ctx))}</div>` : ''}
  `);

  bindIdeaActions(root, [...active, ...offered], {
    eventId: null, eventTitle: '', ownerName: target.first_name, onChange: refresh,
  });

  const form = root.querySelector('#quick-add');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) { form.title.focus(); return; }
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        if (!(await duplicateCheck(target.id, title))) return;
        await addIdea({
          owner_id: target.id,
          author_id: me,
          title,
          priority: Number(form.priority.value),
          share_mode: form.private.checked ? 'private' : 'all',
        });
        toast('Idée ajoutée.', 'success');
        refresh();
        setTimeout(() => document.getElementById('qa-title')?.focus(), 50);
      } catch (err) { showError(err); }
    });
  });
}
