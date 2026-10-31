// =============================================================================
//  Modifier une idée : champs, priorité et partage
// =============================================================================
import { loadEvents, getIdea, updateIdea, setIdeaEvents, deleteIdea } from '../api.js';
import {
  html, render, raw, fullName, isClosed, formatDate, showError, toast, busy, confirmAction,
} from '../lib.js';
import { state } from '../app.js';
import { ideaFields, readIdeaFields } from './ideas-ui.js';

export async function ideaFormScreen(root, ideaId) {
  const me = state.me.id;
  const [idea, { events, personById }] = await Promise.all([getIdea(ideaId), loadEvents()]);
  const back = () => (history.length > 1 ? history.back() : (location.hash = '#/idees'));

  if (!idea) {
    render(root, html`<div class="empty"><h1>Idée introuvable</h1>
      <a class="btn btn-primary" href="#/idees">Mes idées</a></div>`);
    return;
  }

  const owner = idea.owner_id === me ? state.me
    : state.managed.find((p) => p.id === idea.owner_id) || personById.get(idea.owner_id);
  const managerView = owner?.managed_by === me;
  const secret = idea.is_secret && !idea.revealed;
  const canEdit = idea.author_id === me || managerView || (idea.owner_id === me && !secret);
  if (!canEdit) {
    render(root, html`<div class="empty"><h1>Modification impossible</h1>
      <p>Seul son auteur peut modifier cette idée.</p>
      <button type="button" class="btn btn-primary" id="back">Retour</button></div>`);
    root.querySelector('#back').addEventListener('click', back);
    return;
  }

  // Événements où la liste du propriétaire est affichée (et que je vois)
  const listed = events.filter((e) =>
    (e.kind === 'collective' && e.members.some((m) => m.person_id === idea.owner_id))
    || e.honorees.includes(idea.owner_id));
  const choices = listed.filter((e) => !isClosed(e) || idea.eventIds.includes(e.id));
  const ownerName = owner?.first_name || 'cette personne';
  const forSelf = idea.owner_id === me;

  render(root, html`
    <button type="button" class="back btn-link" id="back">← Retour</button>
    <h1>Modifier l’idée</h1>
    ${!forSelf ? html`<p class="meta">Dans la liste de ${fullName(owner)}${secret
      ? ` — idée secrète, ${ownerName} ne la voit pas` : ''}.</p>` : ''}

    <form id="idea-form" class="stack" novalidate>
      ${ideaFields(idea)}

      <fieldset class="field">
        <legend>Où apparaît-elle ?</legend>
        <label class="choice">
          <input type="radio" name="share" value="all" ${idea.share_mode === 'all' ? raw('checked') : ''}>
          <span><strong>${forSelf ? 'Tous mes événements' : `Tous les événements de ${ownerName}`}</strong>
            <span class="hint">Y compris ceux rejoints plus tard.</span></span>
        </label>
        <label class="choice">
          <input type="radio" name="share" value="selected" ${idea.share_mode === 'selected' ? raw('checked') : ''}>
          <span><strong>Certains événements</strong></span>
        </label>
        <div class="checklist indent" id="event-choices">
          ${choices.length ? choices.map((e) => html`
            <label class="choice">
              <input type="checkbox" name="event" value="${e.id}"
                ${idea.eventIds.includes(e.id) ? raw('checked') : ''}>
              <span>${e.title}${e.event_date ? html` <span class="hint">· ${formatDate(e.event_date, { short: true })}</span>` : ''}</span>
            </label>`) : html`<p class="hint">Aucun événement pour l’instant.</p>`}
        </div>
        ${!secret ? html`
          <label class="choice">
            <input type="radio" name="share" value="private" ${idea.share_mode === 'private' ? raw('checked') : ''}>
            <span><strong>${forSelf ? 'Garder pour moi' : 'Garder pour nous'}</strong>
              <span class="hint">Visible de ${forSelf ? 'toi' : 'toi et du gestionnaire'} seulement, comme un brouillon.</span></span>
          </label>` : ''}
      </fieldset>

      <p id="form-error" class="form-error" role="alert" hidden></p>
      <button type="submit" class="btn btn-primary btn-block">Enregistrer</button>
      <button type="button" class="btn btn-link danger-link" id="delete">Supprimer l’idée</button>
    </form>`);

  root.querySelector('#back').addEventListener('click', back);
  const form = root.querySelector('#idea-form');
  const syncChoices = () => {
    const selected = form.querySelector('[name=share]:checked')?.value === 'selected';
    form.querySelectorAll('[name=event]').forEach((c) => { c.disabled = !selected; });
  };
  form.querySelectorAll('[name=share]').forEach((r) => r.addEventListener('change', syncChoices));
  syncChoices();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const errorBox = root.querySelector('#form-error');
    const { fields, error } = readIdeaFields(data);
    if (error) { errorBox.textContent = error; errorBox.hidden = false; return; }
    const share = data.get('share');
    const picked = data.getAll('event');
    if (share === 'selected' && !picked.length) {
      errorBox.textContent = 'Coche au moins un événement, ou choisis une autre option.';
      errorBox.hidden = false;
      return;
    }
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        await updateIdea(idea.id, { ...fields, share_mode: share });
        if (share === 'selected') {
          await setIdeaEvents(idea.id,
            picked.filter((id) => !idea.eventIds.includes(id)),
            idea.eventIds.filter((id) => !picked.includes(id)));
        }
        toast('Idée enregistrée.', 'success');
        back();
      } catch (err) { showError(err); }
    });
  });

  root.querySelector('#delete').addEventListener('click', async () => {
    const ok = await confirmAction('Supprimer cette idée ?',
      `« ${idea.title} » sera supprimée, ainsi que ses réservations éventuelles.`);
    if (!ok) return;
    try { await deleteIdea(idea.id); toast('Idée supprimée.'); back(); } catch (err) { showError(err); }
  });
}
