// =============================================================================
//  Affichage d'une idée (carte), de son statut, et actions associées :
//  réserver, participer, annuler, ouvrir aux participations, révéler, supprimer.
//  Ajout d'une idée avec alerte de doublon.
// =============================================================================
import {
  claimIdea, unclaimIdea, openGroup, updateIdea, deleteIdea, addIdea, similarIdeas,
} from '../api.js';
import {
  html, raw, safeUrl, normalizeUrl, urlHost, PRIORITIES, fullName, dialog,
  confirmAction, showError, toast, busy,
} from '../lib.js';

// Nom affiché d'un réservant, selon ce que la base a bien voulu révéler
function claimerLabel(c) {
  if (c.is_mine) return 'toi';
  return c.claimer_name || null;
}

// Statut calculé d'une idée pour la personne qui regarde
export function ideaStatus(idea) {
  const claims = idea.claims || [];
  const offered = claims.some((c) => c.event_closed);
  const mine = claims.find((c) => c.is_mine);
  return { claims, offered, mine, isGroup: idea.isGroup || claims.length > 1 };
}

function statusHtml(idea, { ownerView }) {
  const { claims, offered, isGroup } = ideaStatus(idea);

  // Le propriétaire ne voit que les réservations révélées (événement clôturé)
  if (ownerView) {
    if (!claims.length) return '';
    const names = claims.map((c) => c.claimer_name).filter(Boolean);
    return html`<p class="status status-offered">🎁 Offert${names.length ? ` par ${names.join(', ')}` : ''}</p>`;
  }

  if (!claims.length) {
    return isGroup
      ? html`<p class="status status-group">Cadeau groupé, aucun participant pour l’instant</p>`
      : html`<p class="status status-free">Libre</p>`;
  }

  if (isGroup) {
    const named = claims.map(claimerLabel).filter(Boolean);
    const anonymous = claims.length - named.length;
    const parts = [...named];
    if (anonymous === 1) parts.push('un participant anonyme');
    if (anonymous > 1) parts.push(`${anonymous} participants anonymes`);
    return html`<p class="status ${offered ? 'status-offered' : 'status-group'}">
      ${offered ? '🎁 Offert — ' : ''}Cadeau groupé, ${claims.length} participant${claims.length > 1 ? 's' : ''}
      <span class="status-detail">(${parts.join(', ')})</span></p>`;
  }

  const c = claims[0];
  const who = claimerLabel(c);
  if (offered) return html`<p class="status status-offered">🎁 Offert${who ? ` par ${who}` : ''}</p>`;
  if (c.is_mine) {
    return html`<p class="status status-mine">Tu l’offres${c.is_anonymous ? ' (anonymement)' : ''}${
      c.event_title ? ` pour ${c.event_title}` : ''}</p>`;
  }
  return html`<p class="status status-taken">Réservé${who ? ` par ${who}` : ''}</p>`;
}

// ---------------------------------------------------------------------------
// Carte d'une idée
// ctx : { me, ownerName, ownerView, managerView, canClaim, authorName(id),
//         showShare(idea) facultatif }
// ---------------------------------------------------------------------------
export function ideaCard(idea, ctx) {
  const url = safeUrl(idea.url);
  const prio = PRIORITIES[idea.priority] || PRIORITIES[2];
  const secret = idea.is_secret && !idea.revealed;
  const canEdit = idea.author_id === ctx.me || ctx.managerView
    || (idea.owner_id === ctx.me && !secret);
  const st = ideaStatus(idea);
  const isAuthorOfSecret = secret && idea.author_id === ctx.me;

  // Boutons de réservation
  const actions = [];
  if (ctx.canClaim && !ctx.ownerView && !st.offered) {
    if (!st.isGroup) {
      if (!st.claims.length) {
        actions.push(html`<button type="button" class="btn btn-primary btn-small" data-act="claim">Je l’offre</button>`);
      }
      if (st.mine) {
        actions.push(html`<button type="button" class="btn btn-secondary btn-small" data-act="unclaim">Annuler ma réservation</button>`);
      }
      if (!st.claims.length || st.mine) {
        actions.push(html`<button type="button" class="btn btn-secondary btn-small" data-act="group">Ouvrir aux participations</button>`);
      }
    } else if (st.mine) {
      actions.push(html`<button type="button" class="btn btn-secondary btn-small" data-act="unclaim">Je ne participe plus</button>`);
    } else {
      actions.push(html`<button type="button" class="btn btn-primary btn-small" data-act="participate">Je participe</button>`);
    }
  }

  // Boutons de gestion de l'idée
  const manage = [];
  if (canEdit) {
    manage.push(html`<a class="btn btn-link btn-small" href="#/idee/${idea.id}">Modifier</a>`);
    if (isAuthorOfSecret || (secret && ctx.managerView)) {
      manage.push(html`<button type="button" class="btn btn-link btn-small" data-act="reveal">Révéler à ${ctx.ownerName}</button>`);
    }
    if (isAuthorOfSecret && idea.share_mode === 'selected') {
      manage.push(html`<button type="button" class="btn btn-link btn-small" data-act="extend">Proposer dans tous nos événements</button>`);
    }
    manage.push(html`<button type="button" class="btn btn-link btn-small danger-link" data-act="delete">
      ${isAuthorOfSecret ? 'Retirer' : 'Supprimer'}</button>`);
  }

  return html`
    <article class="card idea" data-idea="${idea.id}">
      <div class="idea-head">
        <span class="prio ${prio.cls}">${prio.label}</span>
        ${secret && !ctx.ownerView ? html`<span class="badge badge-secret">Idée secrète</span>` : ''}
      </div>
      <h3 class="idea-title">${idea.title}</h3>
      ${url ? html`<a class="idea-link" href="${url}" target="_blank" rel="noopener noreferrer nofollow">
        Voir le lien<span class="host"> (${urlHost(url)})</span>
        <span class="visually-hidden">, s’ouvre dans un nouvel onglet</span></a>` : ''}
      ${idea.comment ? html`<p class="idea-comment">${idea.comment}</p>` : ''}
      ${secret && !ctx.ownerView ? html`<p class="hint">Ajoutée par ${idea.author_id === ctx.me ? 'toi'
        : ctx.authorName(idea.author_id)} — ${ctx.ownerName} ne la voit pas.</p>` : ''}
      ${ctx.showShare ? html`<p class="hint">${ctx.showShare(idea)}</p>` : ''}
      ${statusHtml(idea, ctx)}
      ${actions.length ? html`<div class="idea-actions">${actions}</div>` : ''}
      ${manage.length ? html`<div class="idea-manage">${manage}</div>` : ''}
    </article>`;
}

// ---------------------------------------------------------------------------
// Branchement des boutons d'une liste de cartes
// ctx : { eventId, eventTitle, ownerName, onChange }
// ---------------------------------------------------------------------------
export function bindIdeaActions(root, ideas, ctx) {
  const byId = new Map(ideas.map((i) => [i.id, i]));
  root.querySelectorAll('.idea [data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idea = byId.get(btn.closest('[data-idea]').dataset.idea);
      busy(btn, () => runAction(btn.dataset.act, idea, ctx)).catch(showError);
    });
  });
}

async function askAnonymity(title, intro) {
  const { value, form } = await dialog({
    title,
    content: html`
      <p>${intro}</p>
      <fieldset class="field">
        <legend>Les autres donneurs verront :</legend>
        <label class="choice"><input type="radio" name="anon" value="no" checked>
          <span>Mon nom</span></label>
        <label class="choice"><input type="radio" name="anon" value="yes">
          <span>Seulement « Réservé » (anonyme)</span></label>
      </fieldset>`,
    buttons: [
      { label: 'Annuler', value: 'cancel' },
      { label: 'Confirmer', value: 'ok', primary: true },
    ],
  });
  if (value !== 'ok') return null;
  return { anonymous: form.get('anon') === 'yes' };
}

async function runAction(act, idea, ctx) {
  try {
    if (act === 'claim' || act === 'participate') {
      const choice = await askAnonymity(
        act === 'claim' ? 'Je l’offre' : 'Je participe',
        act === 'claim'
          ? `« ${idea.title} » sera marqué comme réservé pour ${ctx.eventTitle}. ${ctx.ownerName} ne le saura pas avant la fin de l’événement.`
          : `Tu participes au cadeau groupé « ${idea.title} ». Organisez-vous entre donneurs pour l’achat.`,
      );
      if (!choice) return;
      await claimIdea(idea.id, ctx.eventId, choice.anonymous);
      toast(act === 'claim' ? 'C’est noté, tu l’offres !' : 'Participation enregistrée.', 'success');
    } else if (act === 'unclaim') {
      const ok = await confirmAction('Annuler ?', `Ta réservation sur « ${idea.title} » sera annulée.`,
        'Annuler la réservation', false);
      if (!ok) return;
      await unclaimIdea(idea.id);
      toast('Réservation annulée.');
    } else if (act === 'group') {
      const { value } = await dialog({
        title: 'Cadeau groupé',
        content: html`<p>Plusieurs personnes pourront participer à « ${idea.title} ».</p>`,
        buttons: [
          { label: 'Annuler', value: 'cancel' },
          { label: 'Ouvrir seulement', value: 'open' },
          ...(ideaStatus(idea).mine ? [] : [{ label: 'Ouvrir et participer', value: 'join', primary: true }]),
        ],
      });
      if (value === 'cancel') return;
      await openGroup(idea.id);
      if (value === 'join') {
        const choice = await askAnonymity('Je participe', 'Comment veux-tu apparaître ?');
        if (choice) await claimIdea(idea.id, ctx.eventId, choice.anonymous);
      }
      toast('Idée ouverte aux participations.', 'success');
    } else if (act === 'reveal') {
      const ok = await confirmAction(`Révéler à ${ctx.ownerName} ?`,
        `${ctx.ownerName} verra « ${idea.title} » dans sa liste (sans voir qui l’a réservée). On ne peut pas revenir en arrière.`,
        'Révéler', false);
      if (!ok) return;
      await updateIdea(idea.id, { revealed: true });
      toast('Idée révélée.', 'success');
    } else if (act === 'extend') {
      await updateIdea(idea.id, { share_mode: 'all' });
      toast(`L’idée est proposée dans tous les événements où figure ${ctx.ownerName}.`, 'success');
    } else if (act === 'delete') {
      const ok = await confirmAction('Supprimer cette idée ?',
        `« ${idea.title} » sera supprimée, ainsi que ses réservations éventuelles.`);
      if (!ok) return;
      await deleteIdea(idea.id);
      toast('Idée supprimée.');
    }
    ctx.onChange();
  } catch (err) {
    showError(err);
    ctx.onChange();
  }
}

// ---------------------------------------------------------------------------
// Formulaire d'idée (dans une boîte de dialogue) + alerte de doublon
// mode : 'own' (ma liste), 'managed' (profil que je gère), 'secret' (un proche)
// ---------------------------------------------------------------------------
export function ideaFields(idea = {}) {
  const prio = idea.priority || 2;
  return html`
    <div class="field">
      <label for="idea-title">Idée</label>
      <input id="idea-title" name="title" required maxlength="120" value="${idea.title || ''}"
             placeholder="Un livre, un jeu, une sortie…">
    </div>
    <div class="field">
      <label for="idea-url">Lien <span class="optional">(facultatif)</span></label>
      <input id="idea-url" name="url" inputmode="url" autocomplete="url" maxlength="2000"
             value="${idea.url || ''}" placeholder="https://…">
    </div>
    <div class="field">
      <label for="idea-comment">Commentaire <span class="optional">(facultatif)</span></label>
      <textarea id="idea-comment" name="comment" maxlength="500" rows="2"
        placeholder="Taille, couleur, magasin…">${idea.comment || ''}</textarea>
    </div>
    <fieldset class="field">
      <legend>Envie</legend>
      <div class="segmented">
        ${[1, 2, 3].map((p) => html`
          <label><input type="radio" name="priority" value="${p}" ${p === prio ? raw('checked') : ''}>
            <span>${PRIORITIES[p].label}</span></label>`)}
      </div>
    </fieldset>`;
}

// Lit et valide les champs ; renvoie { fields } ou { error }
export function readIdeaFields(form) {
  const title = String(form.get('title') || '').trim();
  const rawUrl = normalizeUrl(form.get('url'));
  const comment = String(form.get('comment') || '').trim();
  const priority = Number(form.get('priority') || 2);
  if (!title) return { error: 'Donne un titre à l’idée.' };
  if (title.length > 120) return { error: 'Le titre fait plus de 120 caractères.' };
  if (rawUrl && !safeUrl(rawUrl)) return { error: 'Le lien n’est pas une adresse web valide (http ou https).' };
  if (comment.length > 500) return { error: 'Le commentaire fait plus de 500 caractères.' };
  return { fields: { title, url: rawUrl ? safeUrl(rawUrl) : null, comment: comment || null, priority } };
}

// Avertit si un titre proche existe déjà ; renvoie true pour continuer
export async function duplicateCheck(ownerId, title) {
  let similar = [];
  try { similar = await similarIdeas(ownerId, title); } catch { return true; }
  if (!similar.length) return true;
  const visible = similar.map((s) => s.title).filter(Boolean);
  const hidden = similar.length - visible.length;
  return confirmAction('Idée proche déjà présente',
    [
      visible.length ? `La liste contient déjà : ${visible.map((t) => `« ${t} »`).join(', ')}.` : '',
      hidden ? 'Une idée proche existe déjà, ajoutée en secret par un autre proche.' : '',
    ].filter(Boolean).join(' '),
    'Ajouter quand même', false);
}

// Boîte de dialogue « Ajouter une idée »
export async function addIdeaDialog({ me, ownerId, ownerName, mode, eventId }) {
  const intro = {
    own: '',
    managed: `Cette idée sera dans la liste de ${ownerName}.`,
    secret: `Cette idée restera secrète : ${ownerName} ne la verra pas. Elle sera proposée dans cet événement.`,
  }[mode];

  let values = {};
  for (;;) {
    const { value, form } = await dialog({
      title: mode === 'own' ? 'Ajouter une idée' : `Une idée pour ${ownerName}`,
      content: html`${intro ? html`<p class="hint">${intro}</p>` : ''}${ideaFields(values)}`,
      buttons: [
        { label: 'Annuler', value: 'cancel' },
        { label: 'Ajouter', value: 'ok', primary: true },
      ],
    });
    if (value !== 'ok') return null;
    const { fields, error } = readIdeaFields(form);
    values = {
      title: form.get('title'), url: form.get('url'), comment: form.get('comment'),
      priority: Number(form.get('priority')),
    };
    if (error) { toast(error, 'error'); continue; }
    if (!(await duplicateCheck(ownerId, fields.title))) return null;

    const row = {
      ...fields,
      owner_id: ownerId,
      author_id: me,
      share_mode: mode === 'secret' ? 'selected' : 'all',
    };
    const idea = await addIdea(row, mode === 'secret' && eventId ? [eventId] : []);
    toast('Idée ajoutée.', 'success');
    return idea;
  }
}

export { fullName };
