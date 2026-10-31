// =============================================================================
//  Écran « Bienvenue » (prénom, sans mot de passe), connexion par e-mail
//  pour retrouver un compte, et adhésion par lien d'invitation.
// =============================================================================
import { sb, createMyPerson, joinEvent, siteUrl } from '../api.js';
import { html, render, dialog, showError, toast, busy, errorMessage } from '../lib.js';
import { state, continueAfterWelcome, loadMe, go } from '../app.js';
import { APP_NAME } from '../../config.js';

export async function welcomeScreen(root) {
  const pending = sessionStorage.getItem('pendingRoute') || '';
  const invited = pending.startsWith('/rejoindre/');

  render(root, html`
    <section class="welcome">
      <div class="welcome-logo" aria-hidden="true">🎁</div>
      <h1>${APP_NAME}</h1>
      <p class="lead">
        ${invited
          ? 'Un proche t’invite à partager des idées de cadeaux.'
          : 'Les listes de cadeaux de la famille et des amis, sans doublon ni mauvaise surprise.'}
      </p>
      <form id="welcome-form" class="card stack" novalidate>
        <h2 class="h-form">Comment tu t’appelles ?</h2>
        <div class="field">
          <label for="first">Prénom</label>
          <input id="first" name="first" required maxlength="50" autocomplete="given-name"
                 autocapitalize="words" enterkeyhint="next">
        </div>
        <div class="field">
          <label for="last">Nom ou surnom <span class="optional">(facultatif)</span></label>
          <input id="last" name="last" maxlength="50" autocomplete="family-name"
                 autocapitalize="words" aria-describedby="last-hint" enterkeyhint="go">
          <p id="last-hint" class="hint">Utile s’il y a plusieurs personnes avec le même prénom.</p>
        </div>
        <p id="welcome-error" class="form-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">C’est parti</button>
        <p class="hint center">Pas de mot de passe : ce téléphone se souviendra de toi.</p>
      </form>
      <button type="button" class="btn btn-link" id="have-account">J’ai déjà un compte</button>
    </section>`);

  const form = root.querySelector('#welcome-form');
  const errorBox = root.querySelector('#welcome-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const first = form.first.value.trim();
    const last = form.last.value.trim();
    if (!first) {
      errorBox.textContent = 'Indique ton prénom pour continuer.';
      errorBox.hidden = false;
      form.first.focus();
      return;
    }
    await busy(form.querySelector('[type=submit]'), async () => {
      try {
        let { data: { session } } = await sb.auth.getSession();
        if (!session) {
          const { data, error } = await sb.auth.signInAnonymously();
          if (error) throw error;
          session = data.session;
        }
        state.user = session.user;
        state.me = await createMyPerson(session.user.id, first, last);
        await loadMe();
        continueAfterWelcome();
      } catch (err) {
        errorBox.textContent = errorMessage(err);
        errorBox.hidden = false;
      }
    });
  });

  root.querySelector('#have-account').addEventListener('click', () => askEmailLogin());
}

// « J'ai déjà un compte » : envoie un lien magique à l'adresse de récupération
export async function askEmailLogin() {
  const { value, form } = await dialog({
    title: 'Retrouver mon compte',
    content: html`
      <p>Si tu as ajouté une adresse e-mail sur ton autre téléphone, saisis-la :
      tu recevras un lien pour te connecter ici.</p>
      ${state.me ? html`<p class="hint">Attention : le profil « ${state.me.first_name} » utilisé
        sur ce téléphone sera remplacé par ton compte retrouvé.</p>` : ''}
      <div class="field">
        <label for="login-email">Adresse e-mail</label>
        <input id="login-email" name="email" type="email" required autocomplete="email" inputmode="email">
      </div>`,
    buttons: [
      { label: 'Annuler', value: 'cancel' },
      { label: 'Recevoir le lien', value: 'ok', primary: true },
    ],
  });
  if (value !== 'ok') return;
  const email = String(form.get('email') || '').trim();
  if (!email) return;
  try {
    const pending = sessionStorage.getItem('pendingRoute');
    if (pending) localStorage.setItem('pendingRoute', pending);
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: siteUrl() },
    });
    if (error) throw error;
    await dialog({
      title: 'Regarde tes e-mails',
      content: html`<p>Un lien de connexion a été envoyé à <strong>${email}</strong>.
        Ouvre-le sur ce téléphone. Pense à vérifier les courriers indésirables.</p>`,
      buttons: [{ label: 'Compris', value: 'ok', primary: true }],
    });
  } catch (err) {
    showError(err);
  }
}

// Lien d'invitation #/rejoindre/<jeton>
export async function joinScreen(root, token) {
  render(root, html`<p class="loading" role="status">Connexion à l’événement…</p>`);
  try {
    const eventId = await joinEvent(token);
    toast('Bienvenue dans l’événement !', 'success');
    go(`/evenement/${eventId}`, { replace: true });
  } catch (err) {
    render(root, html`
      <div class="empty">
        <h1>Invitation impossible</h1>
        <p>${errorMessage(err)}</p>
        <p class="hint">Demande un nouveau lien à la personne qui t’a invité(e).</p>
        <a class="btn btn-primary" href="#/">Voir mes événements</a>
      </div>`);
  }
}
