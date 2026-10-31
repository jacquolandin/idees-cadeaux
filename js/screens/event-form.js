// =============================================================================
//  Créer ou modifier un événement
// =============================================================================
import {
  loadEvents, createEvent, updateEvent, setHonorees, createManaged,
} from '../api.js';
import { html, render, raw, fullName, showError, busy, toast, isClosed } from '../lib.js';
import { state, go, reloadManaged } from '../app.js';

export async function eventFormScreen(root, eventId = null) {
  const { events, personById } = await loadEvents();
  const ev = eventId ? events.find((e) => e.id === eventId) : null;

  if (eventId && !ev) {
    render(root, html`<div class="empty"><h1>Événement introuvable</h1>
      <a class="btn btn-primary" href="#/">Retour</a></div>`);
    return;
  }
  const isOrganizer = ev?.members.some((m) => m.person_id === state.me.id && m.role === 'organizer');
  if (ev && (!isOrganizer || isClosed(ev))) {
    render(root, html`<div class="empty"><h1>Modification impossible</h1>
      <p>${isClosed(ev) ? 'Cet événement est clôturé.' : 'Seuls les organisateurs peuvent modifier l’événement.'}</p>
      <a class="btn btn-primary" href="#/evenement/${ev.id}">Retour à l’événement</a></div>`);
    return;
  }

  // Personnes connues : moi, mes profils gérés, et les personnes de mes événements
  const known = new Map();
  known.set(state.me.id, state.me);
  state.managed.forEach((p) => known.set(p.id, p));
  personById.forEach((p, id) => known.set(id, p));
  const selected = new Set(ev ? ev.honorees : []);

  const draw = () => {
    const kind = root.querySelector('[name=kind]:checked')?.value ?? ev?.kind ?? 'person';
    const surprise = root.querySelector('[name=surprise]')?.checked ?? ev?.is_surprise ?? false;
    const values = {
      title: root.querySelector('[name=title]')?.value ?? ev?.title ?? '',
      date: root.querySelector('[name=date]')?.value ?? ev?.event_date ?? '',
      description: root.querySelector('[name=description]')?.value ?? ev?.description ?? '',
    };
    const people = [...known.values()].sort((a, b) =>
      (a.id === state.me.id ? -1 : b.id === state.me.id ? 1 : fullName(a).localeCompare(fullName(b), 'fr')));

    render(root, html`
      <a class="back" href="${ev ? `#/evenement/${ev.id}` : '#/'}">← ${ev ? ev.title : 'Événements'}</a>
      <h1>${ev ? 'Modifier l’événement' : 'Nouvel événement'}</h1>

      <form id="event-form" class="stack" novalidate>
        <div class="field">
          <label for="title">Titre</label>
          <input id="title" name="title" required maxlength="100" value="${values.title}"
                 placeholder="Noël 2026, Anniversaire de Léo…">
        </div>

        <fieldset class="field">
          <legend>Type</legend>
          <label class="choice">
            <input type="radio" name="kind" value="person" ${kind === 'person' ? raw('checked') : ''}>
            <span><strong>Pour une personne</strong>
              <span class="hint">Anniversaire, baptême, naissance, départ… On offre au(x) concerné(s).</span></span>
          </label>
          <label class="choice">
            <input type="radio" name="kind" value="collective" ${kind === 'collective' ? raw('checked') : ''}>
            <span><strong>Échange collectif</strong>
              <span class="hint">Noël, fête de famille… Tout le monde offre et reçoit.</span></span>
          </label>
        </fieldset>

        <div class="field">
          <label for="date">Date <span class="optional">(facultative)</span></label>
          <input id="date" name="date" type="date" value="${values.date}" aria-describedby="date-hint">
          <p id="date-hint" class="hint">L’événement se clôture tout seul le lendemain.
            Sans date, l’organisateur le clôture à la main.</p>
        </div>

        ${kind === 'person' ? html`
          <fieldset class="field">
            <legend>Pour qui ?</legend>
            <div class="checklist">
              ${people.map((p) => html`
                <label class="choice">
                  <input type="checkbox" name="honoree" value="${p.id}"
                    ${selected.has(p.id) ? raw('checked') : ''}
                    ${surprise && p.id === state.me.id ? raw('disabled') : ''}>
                  <span>${p.id === state.me.id ? 'Moi' : fullName(p)}
                    ${p.managed_by ? html`<span class="hint">(profil géré)</span>` : ''}</span>
                </label>`)}
            </div>
            <div class="inline-add">
              <label for="new-managed">Quelqu’un sans compte (enfant, invité…)</label>
              <div class="row">
                <input id="new-managed" placeholder="Prénom" maxlength="50" autocapitalize="words">
                <button type="button" class="btn btn-secondary" id="add-managed">Ajouter</button>
              </div>
              <p class="hint">Tu gèreras sa liste à sa place.</p>
            </div>
          </fieldset>

          <label class="choice choice-box">
            <input type="checkbox" name="surprise" ${surprise ? raw('checked') : ''}>
            <span><strong>Surprise : le concerné ne doit pas le savoir</strong>
              <span class="hint">L’événement lui sera totalement invisible, même avec le lien.</span></span>
          </label>` : ''}

        <div class="field">
          <label for="description">Description <span class="optional">(facultative)</span></label>
          <textarea id="description" name="description" maxlength="500" rows="3"
            placeholder="Lieu, budget conseillé…">${values.description}</textarea>
        </div>

        <p id="form-error" class="form-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary btn-block">
          ${ev ? 'Enregistrer' : 'Créer l’événement'}</button>
      </form>`);

    bind();
  };

  const bind = () => {
    const form = root.querySelector('#event-form');
    // Mémoriser les cases cochées avant de redessiner
    const remember = () => {
      root.querySelectorAll('[name=honoree]').forEach((c) => {
        if (c.checked) selected.add(c.value); else selected.delete(c.value);
      });
    };
    form.querySelectorAll('[name=kind], [name=surprise]').forEach((el) =>
      el.addEventListener('change', () => { remember(); draw(); }));

    root.querySelector('#add-managed')?.addEventListener('click', async (e) => {
      const input = root.querySelector('#new-managed');
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      await busy(e.currentTarget, async () => {
        try {
          remember();
          const p = await createManaged(state.me.id, name, null);
          await reloadManaged();
          known.set(p.id, p);
          selected.add(p.id);
          toast(`Profil de ${name} créé.`, 'success');
          draw();
        } catch (err) { showError(err); }
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      remember();
      const errorBox = root.querySelector('#form-error');
      const title = form.title.value.trim();
      const kind = form.querySelector('[name=kind]:checked').value;
      const surprise = kind === 'person' && Boolean(form.surprise?.checked);
      const honorees = kind === 'person'
        ? [...selected].filter((id) => !(surprise && id === state.me.id)) : [];
      const fail = (msg, el) => {
        errorBox.textContent = msg; errorBox.hidden = false; el?.focus();
      };
      if (!title) return fail('Donne un titre à l’événement.', form.title);
      if (kind === 'person' && !honorees.length) {
        return fail('Choisis au moins une personne à qui offrir.', form.querySelector('[name=honoree]'));
      }

      await busy(form.querySelector('[type=submit]'), async () => {
        try {
          const payload = {
            title, kind, date: form.date.value || null, surprise,
            description: form.description.value.trim(), honorees,
          };
          if (!ev) {
            const id = await createEvent(payload);
            toast('Événement créé. Invite tes proches !', 'success');
            go(`/evenement/${id}/invitation`, { replace: true });
            return;
          }
          // Modification : d'abord retirer les concernés, puis changer le type
          const remove = ev.honorees.filter((id) => !honorees.includes(id));
          const add = honorees.filter((id) => !ev.honorees.includes(id));
          await setHonorees(ev.id, [], remove);
          await updateEvent(ev.id, {
            title, kind, event_date: payload.date, is_surprise: surprise,
            description: payload.description || null,
          });
          await setHonorees(ev.id, add, []);
          toast('Événement enregistré.', 'success');
          go(`/evenement/${ev.id}`, { replace: true });
        } catch (err) {
          showError(err);
        }
      });
    });
  };

  draw();
}
