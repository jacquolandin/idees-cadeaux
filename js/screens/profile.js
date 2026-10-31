// =============================================================================
//  Profil : prénom, e-mail de récupération, profils gérés, installation,
//  suppression du compte
// =============================================================================
import {
  sb, siteUrl, updatePerson, createManaged, deletePerson, deleteMyAccount,
} from '../api.js';
import {
  html, render, fullName, showError, toast, busy, confirmAction, dialog,
} from '../lib.js';
import { state, refresh, reloadManaged, loadMe } from '../app.js';
import { askEmailLogin } from './welcome.js';

export async function profileScreen(root) {
  await reloadManaged();
  const { data: { user } } = await sb.auth.getUser();
  state.user = user;
  const me = state.me;

  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  render(root, html`
    <header class="page-head"><h1>Profil</h1></header>

    <section class="card stack" aria-labelledby="h-name">
      <h2 id="h-name" class="h-section">Mon prénom</h2>
      <form id="name-form" class="stack" novalidate>
        <div class="field">
          <label for="p-first">Prénom</label>
          <input id="p-first" name="first" required maxlength="50" value="${me.first_name}" autocomplete="given-name">
        </div>
        <div class="field">
          <label for="p-last">Nom ou surnom <span class="optional">(facultatif)</span></label>
          <input id="p-last" name="last" maxlength="50" value="${me.last_name || ''}" autocomplete="family-name">
        </div>
        <button type="submit" class="btn btn-primary">Enregistrer</button>
      </form>
    </section>

    <section class="card stack" aria-labelledby="h-email" id="email">
      <h2 id="h-email" class="h-section">Retrouver mon compte</h2>
      ${user?.email ? html`
        <p>Ton compte est protégé par l’adresse <strong>${user.email}</strong>.
          Sur un autre téléphone, touche « J’ai déjà un compte » pour le retrouver.</p>`
      : html`
        ${user?.new_email ? html`<p class="notice">Un lien de confirmation a été envoyé à
          <strong>${user.new_email}</strong>. Ouvre-le pour terminer.</p>` : html`
          <p>Ajoute ton e-mail : si tu changes de téléphone, tu retrouveras tes listes et tes réservations.
            Tu ne recevras aucun autre message.</p>`}
        <form id="email-form" class="stack" novalidate>
          <div class="field">
            <label for="p-email">Adresse e-mail</label>
            <input id="p-email" name="email" type="email" required autocomplete="email" inputmode="email"
              value="${user?.new_email || ''}">
          </div>
          <button type="submit" class="btn btn-secondary">Envoyer le lien de confirmation</button>
        </form>`}
      <button type="button" class="btn btn-link" id="have-account">J’ai déjà un compte (sur un autre téléphone)</button>
    </section>

    <section class="card stack" aria-labelledby="h-managed">
      <h2 id="h-managed" class="h-section">Profils gérés</h2>
      <p class="hint">Pour un enfant ou une personne sans téléphone : tu tiens sa liste à sa place
        et tu vois tout, même les idées secrètes et les réservations.</p>
      ${state.managed.length ? html`<ul class="list">
        ${state.managed.map((p) => html`<li class="list-item">
          <strong>${fullName(p)}</strong>
          <div class="row wrap">
            <a class="btn btn-secondary btn-small" href="#/idees/${p.id}">Ses idées</a>
            <button type="button" class="btn btn-link btn-small" data-rename="${p.id}">Renommer</button>
            <button type="button" class="btn btn-link btn-small danger-link" data-delete="${p.id}">Supprimer</button>
          </div>
        </li>`)}
      </ul>` : ''}
      <form id="managed-form" class="row wrap" novalidate>
        <label for="m-first" class="visually-hidden">Prénom du profil géré</label>
        <input id="m-first" name="first" placeholder="Prénom" maxlength="50" autocapitalize="words">
        <button type="submit" class="btn btn-secondary">Créer le profil</button>
      </form>
    </section>

    <section class="card stack" aria-labelledby="h-install">
      <h2 id="h-install" class="h-section">Installer l’application</h2>
      ${isStandalone ? html`<p>L’application est installée sur cet appareil.</p>` : html`
        ${state.installPrompt ? html`<button type="button" class="btn btn-secondary" id="install">
          Installer sur ce téléphone</button>` : ''}
        <details>
          <summary>Sur iPhone</summary>
          <p>Ouvre ce site dans Safari, touche le bouton Partager (carré avec une flèche),
            puis « Sur l’écran d’accueil ».</p>
        </details>
        <details ${!isIos ? 'open' : ''}>
          <summary>Sur Android</summary>
          <p>Dans Chrome, touche le menu ⋮ en haut à droite, puis « Installer l’application »
            ou « Ajouter à l’écran d’accueil ».</p>
        </details>`}
    </section>

    <section class="card stack danger-zone" aria-labelledby="h-delete">
      <h2 id="h-delete" class="h-section">Supprimer mon compte</h2>
      <p class="hint">Supprime ta personne, tes idées, tes réservations
        ${state.managed.length ? 'et tes profils gérés' : ''}. Irréversible.</p>
      <button type="button" class="btn btn-danger" id="delete-account">Supprimer mon compte et mes données</button>
    </section>
  `);

  // Prénom
  const nameForm = root.querySelector('#name-form');
  nameForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const first = nameForm.first.value.trim();
    if (!first) { nameForm.first.focus(); return; }
    await busy(nameForm.querySelector('[type=submit]'), async () => {
      try {
        await updatePerson(me.id, first, nameForm.last.value.trim());
        await loadMe();
        toast('Enregistré.', 'success');
      } catch (err) { showError(err); }
    });
  });

  // E-mail de récupération : conversion du compte anonyme en compte permanent
  const emailForm = root.querySelector('#email-form');
  emailForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailForm.email.value.trim();
    if (!emailForm.email.checkValidity() || !email) {
      toast('Cette adresse e-mail ne semble pas valide.', 'error');
      return;
    }
    await busy(emailForm.querySelector('[type=submit]'), async () => {
      try {
        localStorage.setItem('pendingRoute', '/profil');
        const { error } = await sb.auth.updateUser({ email }, { emailRedirectTo: siteUrl() });
        if (error) throw error;
        toast('Lien envoyé. Ouvre l’e-mail reçu pour confirmer.', 'success');
        refresh();
      } catch (err) { showError(err); }
    });
  });

  root.querySelector('#have-account').addEventListener('click', () => askEmailLogin());

  // Profils gérés
  const managedForm = root.querySelector('#managed-form');
  managedForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const first = managedForm.first.value.trim();
    if (!first) { managedForm.first.focus(); return; }
    await busy(managedForm.querySelector('[type=submit]'), async () => {
      try {
        await createManaged(me.id, first, null);
        toast(`Profil de ${first} créé.`, 'success');
        refresh();
      } catch (err) { showError(err); }
    });
  });

  root.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', async () => {
    const p = state.managed.find((x) => x.id === b.dataset.rename);
    const { value, form } = await dialog({
      title: 'Renommer',
      content: html`
        <div class="field"><label for="r-first">Prénom</label>
          <input id="r-first" name="first" required maxlength="50" value="${p.first_name}"></div>
        <div class="field"><label for="r-last">Nom ou surnom <span class="optional">(facultatif)</span></label>
          <input id="r-last" name="last" maxlength="50" value="${p.last_name || ''}"></div>`,
      buttons: [{ label: 'Annuler', value: 'cancel' }, { label: 'Enregistrer', value: 'ok', primary: true }],
    });
    if (value !== 'ok') return;
    try {
      await updatePerson(p.id, String(form.get('first')).trim(), String(form.get('last')).trim());
      refresh();
    } catch (err) { showError(err); }
  }));

  root.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
    const p = state.managed.find((x) => x.id === b.dataset.delete);
    const ok = await confirmAction(`Supprimer le profil de ${p.first_name} ?`,
      'Sa liste d’idées et ses participations aux événements seront supprimées.');
    if (!ok) return;
    try { await deletePerson(p.id); toast('Profil supprimé.'); refresh(); } catch (err) { showError(err); }
  }));

  // Installation PWA (Android / ordinateur)
  root.querySelector('#install')?.addEventListener('click', async () => {
    const prompt = state.installPrompt;
    state.installPrompt = null;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    refresh();
  });

  // Suppression du compte
  root.querySelector('#delete-account').addEventListener('click', async () => {
    const managedNames = state.managed.map((p) => p.first_name).join(', ');
    const ok = await confirmAction('Supprimer ton compte ?',
      `Ta liste, tes idées, tes réservations${managedNames ? ` et les profils gérés (${managedNames})` : ''}
       seront définitivement supprimés.`,
      'Tout supprimer');
    if (!ok) return;
    try {
      await deleteMyAccount();
      await sb.auth.signOut().catch(() => {});
      localStorage.clear();
      sessionStorage.clear();
      location.hash = '#/';
      location.reload();
    } catch (err) { showError(err); }
  });
}
