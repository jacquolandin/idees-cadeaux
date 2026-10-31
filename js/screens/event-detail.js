// =============================================================================
//  Détail d'un événement : onglets Listes, Participants, Invitation
// =============================================================================
import {
  loadEvents, listedPersons, loadIdeas, ideaOpenTo, closeEvent, deleteEvent,
  leaveEvent, setMemberRole, regenerateInvite, addManagedMember,
} from '../api.js';
import {
  html, render, raw, formatDate, relativeDays, isClosed, fullName,
  showError, confirmAction, toast, busy,
} from '../lib.js';
import { state, go, refresh } from '../app.js';

export function inviteLink(token) {
  return `${location.origin}${location.pathname}#/rejoindre/${token}`;
}

export async function eventDetailScreen(root, eventId, tab = 'listes') {
  const { events, personById } = await loadEvents();
  const ev = events.find((e) => e.id === eventId);
  if (!ev) {
    render(root, html`<div class="empty"><h1>Événement introuvable</h1>
      <p>Il a peut-être été supprimé, ou tu n’y participes pas.</p>
      <a class="btn btn-primary" href="#/">Voir mes événements</a></div>`);
    return;
  }

  const me = state.me.id;
  const person = (id) => personById.get(id) || state.managed.find((p) => p.id === id);
  const closed = isClosed(ev);
  const myMembership = ev.members.find((m) => m.person_id === me);
  const isOrganizer = myMembership?.role === 'organizer';
  const honoreeNames = ev.honorees.map((id) => fullName(person(id)));

  const tabs = [
    ['listes', `#/evenement/${ev.id}`, 'Listes'],
    ['participants', `#/evenement/${ev.id}/participants`, 'Participants'],
    ['invitation', `#/evenement/${ev.id}/invitation`, 'Invitation'],
  ];

  let body;
  if (tab === 'participants') body = participantsTab();
  else if (tab === 'invitation') body = invitationTab();
  else body = await listsTab();

  render(root, html`
    <a class="back" href="#/">← Événements</a>
    <header class="page-head">
      <h1>${ev.title}</h1>
      <p class="meta">
        ${ev.event_date ? formatDate(ev.event_date) : 'Sans date'}
        ${!closed && ev.event_date ? html` · <strong>${relativeDays(ev.event_date)}</strong>` : ''}
      </p>
      <p class="meta">${ev.kind === 'collective'
        ? 'Échange collectif : chacun offre et reçoit'
        : html`Pour ${honoreeNames.join(', ')}`}</p>
      <p class="badges">
        ${ev.is_surprise ? html`<span class="badge badge-surprise">Surprise :
          ${honoreeNames.join(', ')} ne voit pas cet événement</span>` : ''}
        ${closed ? html`<span class="badge">Clôturé — lecture seule</span>` : ''}
      </p>
      ${ev.description ? html`<p class="description">${ev.description}</p>` : ''}
    </header>

    <nav class="tabs" aria-label="Sections de l’événement">
      ${tabs.map(([key, href, label]) => html`
        <a href="${href}" ${key === tab ? raw('aria-current="page"') : ''}>${label}</a>`)}
    </nav>

    <div class="tab-body">${body}</div>
  `);
  bind();

  // -------------------------------------------------------------------------
  async function listsTab() {
    const listed = listedPersons(ev);
    const ideas = await loadIdeas(listed);
    const count = (pid) => ideas.filter((i) => i.owner_id === pid && ideaOpenTo(i, ev.id)).length;
    const sorted = [...listed].sort((a, b) => {
      if (a === me) return -1;
      if (b === me) return 1;
      return fullName(person(a)).localeCompare(fullName(person(b)), 'fr');
    });
    const addable = ev.kind === 'collective' && !closed && myMembership
      ? state.managed.filter((p) => !ev.members.some((m) => m.person_id === p.id)) : [];

    return html`
      ${closed ? html`<p class="notice">Événement clôturé : les cadeaux offerts sont
        maintenant visibles de leurs destinataires.</p>` : ''}
      <ul class="cards">
        ${sorted.map((pid) => {
          const p = person(pid);
          const n = count(pid);
          return html`<li>
            <a class="card person-card" href="#/evenement/${ev.id}/liste/${pid}">
              <span class="person-card-name">${pid === me ? 'Ma liste' : `Liste de ${fullName(p)}`}</span>
              <span class="meta">${n} idée${n > 1 ? 's' : ''}${p?.managed_by
                ? (p.managed_by === me ? ' · profil que tu gères' : ' · profil géré') : ''}</span>
            </a></li>`;
        })}
      </ul>
      ${!sorted.length ? html`<p class="empty-inline">Personne pour l’instant.
        Invite des proches depuis l’onglet Invitation.</p>` : ''}
      ${addable.length ? html`
        <div class="card stack">
          <p>Tes profils gérés peuvent aussi avoir leur liste dans cet échange :</p>
          ${addable.map((p) => html`
            <button type="button" class="btn btn-secondary" data-add-managed="${p.id}">
              Inscrire ${fullName(p)}</button>`)}
        </div>` : ''}
    `;
  }

  // -------------------------------------------------------------------------
  function participantsTab() {
    const members = [...ev.members].sort((a, b) => {
      if (a.role !== b.role) return a.role === 'organizer' ? -1 : 1;
      return fullName(person(a.person_id)).localeCompare(fullName(person(b.person_id)), 'fr');
    });
    return html`
      <ul class="list">
        ${members.map((m) => {
          const p = person(m.person_id);
          const isMe = m.person_id === me;
          const managedByMe = p?.managed_by === me;
          return html`<li class="list-item">
            <div>
              <strong>${isMe ? `${fullName(p)} (moi)` : fullName(p)}</strong>
              <span class="meta">${m.role === 'organizer' ? 'Organisateur' : 'Participant'}${p?.managed_by
                ? ' · profil géré' : ''}</span>
            </div>
            <div class="row">
              ${isOrganizer && !closed && !p?.managed_by && !isMe ? html`
                <button type="button" class="btn btn-secondary btn-small"
                  data-role="${m.person_id}" data-to="${m.role === 'organizer' ? 'member' : 'organizer'}">
                  ${m.role === 'organizer' ? 'Retirer le rôle d’organisateur' : 'Nommer organisateur'}</button>` : ''}
              ${managedByMe ? html`
                <button type="button" class="btn btn-secondary btn-small" data-leave="${m.person_id}">
                  Retirer ${p.first_name}</button>` : ''}
            </div>
          </li>`;
        })}
      </ul>

      ${isOrganizer ? html`
        <section class="card stack">
          <h2 class="h-section">Organisation</h2>
          ${!closed ? html`
            <a class="btn btn-secondary" href="#/evenement/${ev.id}/modifier">Modifier l’événement</a>
            <button type="button" class="btn btn-secondary" id="close-event">Clôturer maintenant</button>
            <p class="hint">À la clôture, chacun découvre ce qui lui a été offert et les réservations
              se figent.${ev.event_date ? ' Elle a lieu automatiquement le lendemain de la date.' : ''}</p>` : ''}
          <button type="button" class="btn btn-danger" id="delete-event">Supprimer l’événement</button>
        </section>` : ''}

      ${myMembership ? html`
        <button type="button" class="btn btn-link danger-link" data-leave="${me}">
          Quitter l’événement</button>` : ''}
    `;
  }

  // -------------------------------------------------------------------------
  function invitationTab() {
    if (closed) {
      return html`<p class="notice">Événement clôturé : les invitations sont fermées.</p>`;
    }
    const link = inviteLink(ev.invite_token);
    return html`
      <div class="stack">
        <p>Envoie ce lien à tes proches par WhatsApp, SMS ou e-mail.
          Il suffit de l’ouvrir et de taper son prénom.</p>
        ${ev.is_surprise ? html`<p class="notice">C’est une surprise : n’envoie pas ce lien à
          ${honoreeNames.join(', ')}. S’il l’ouvrait quand même, il serait refusé.</p>` : ''}
        <label for="invite-link" class="label">Lien d’invitation</label>
        <input id="invite-link" readonly value="${link}" class="mono">
        ${navigator.share ? html`
          <button type="button" class="btn btn-primary btn-block" id="share-link">Partager le lien</button>
          <button type="button" class="btn btn-secondary btn-block" id="copy-link">Copier le lien</button>`
        : html`<button type="button" class="btn btn-primary btn-block" id="copy-link">Copier le lien</button>`}
        ${isOrganizer ? html`
          <button type="button" class="btn btn-link" id="regen-link">Créer un nouveau lien
            (l’ancien ne marchera plus)</button>` : ''}
      </div>`;
  }

  // -------------------------------------------------------------------------
  function bind() {
    root.querySelectorAll('[data-add-managed]').forEach((b) => b.addEventListener('click', () =>
      busy(b, async () => {
        try {
          await addManagedMember(ev.id, b.dataset.addManaged);
          toast('Profil inscrit.', 'success');
          refresh();
        } catch (err) { showError(err); }
      })));

    root.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', () =>
      busy(b, async () => {
        try {
          await setMemberRole(ev.id, b.dataset.role, b.dataset.to);
          refresh();
        } catch (err) { showError(err); }
      })));

    root.querySelectorAll('[data-leave]').forEach((b) => b.addEventListener('click', async () => {
      const pid = b.dataset.leave;
      const self = pid === me;
      const ok = await confirmAction(
        self ? 'Quitter l’événement ?' : `Retirer ${fullName(person(pid))} ?`,
        self ? 'Tu ne verras plus cet événement. Tes idées restent dans ta liste. Pour revenir, il faudra un nouveau lien.'
          : 'Sa liste ne sera plus visible dans cet événement.',
        self ? 'Quitter' : 'Retirer',
      );
      if (!ok) return;
      try {
        await leaveEvent(ev.id, pid);
        if (self) go('/', { replace: true }); else refresh();
      } catch (err) { showError(err); }
    }));

    root.querySelector('#close-event')?.addEventListener('click', async (e) => {
      const ok = await confirmAction('Clôturer l’événement ?',
        'Chacun découvrira ce qu’on lui a offert. Plus aucune réservation ne sera possible. On ne peut pas revenir en arrière.',
        'Clôturer', false);
      if (!ok) return;
      await busy(e.target, async () => {
        try { await closeEvent(ev.id); toast('Événement clôturé.', 'success'); refresh(); } catch (err) { showError(err); }
      });
    });

    root.querySelector('#delete-event')?.addEventListener('click', async () => {
      const ok = await confirmAction('Supprimer l’événement ?',
        'L’événement, ses participants et les réservations faites pour lui seront supprimés. Les idées restent dans les listes de chacun.');
      if (!ok) return;
      try { await deleteEvent(ev.id); toast('Événement supprimé.'); go('/', { replace: true }); } catch (err) { showError(err); }
    });

    const copy = async () => {
      const input = root.querySelector('#invite-link');
      try {
        await navigator.clipboard.writeText(input.value);
      } catch {
        input.select();
        document.execCommand('copy');
      }
      toast('Lien copié. Colle-le dans un message.', 'success');
    };
    root.querySelector('#copy-link')?.addEventListener('click', copy);
    root.querySelector('#share-link')?.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: ev.title,
          text: `Rejoins « ${ev.title} » pour partager nos idées de cadeaux :`,
          url: root.querySelector('#invite-link').value,
        });
      } catch (err) {
        if (err?.name !== 'AbortError') copy();
      }
    });
    root.querySelector('#regen-link')?.addEventListener('click', async () => {
      const ok = await confirmAction('Créer un nouveau lien ?',
        'L’ancien lien ne fonctionnera plus. Les personnes déjà inscrites restent dans l’événement.',
        'Créer un nouveau lien', false);
      if (!ok) return;
      try { await regenerateInvite(ev.id); toast('Nouveau lien créé.', 'success'); refresh(); } catch (err) { showError(err); }
    });
  }
}
