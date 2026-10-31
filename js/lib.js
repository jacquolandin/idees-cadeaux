// =============================================================================
//  Outils communs : échappement HTML, dates, liens, messages, boîtes de dialogue
// =============================================================================

// ---------------------------------------------------------------------------
// Échappement HTML (protection XSS)
// Le gabarit html`...` échappe TOUT ce qui est inséré, sauf ce qui vient
// lui-même d'un gabarit html`...` ou de raw(). Le contenu saisi par les
// utilisateurs n'est donc jamais interprété comme du HTML.
// ---------------------------------------------------------------------------
const RAW = Symbol('raw');

export function raw(s) {
  return { [RAW]: String(s) };
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;',
  }[c]));
}

function convert(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(convert).join('');
  if (typeof v === 'object' && RAW in v) return v[RAW];
  return esc(v);
}

export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += convert(values[i]);
  });
  return raw(out);
}

// Remplit un élément avec un gabarit html`...`
export function render(el, tpl) {
  el.innerHTML = convert(tpl);
}

// ---------------------------------------------------------------------------
// Liens : seuls http et https sont acceptés
// ---------------------------------------------------------------------------
export function safeUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

// Ajoute https:// si l'utilisateur a oublié le préfixe (ex. « amazon.fr/... »)
export function normalizeUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return 'https://' + s;
}

export function urlHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Dates (fuseau de Paris, comme la base)
// ---------------------------------------------------------------------------
export function todayParis() {
  // format AAAA-MM-JJ
  return new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function daysBetween(fromIso, toIso) {
  const a = Date.UTC(...fromIso.split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
  const b = Date.UTC(...toIso.split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
  return Math.round((b - a) / 86400000);
}

export function formatDate(iso, opts = {}) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: opts.short ? undefined : 'long', day: 'numeric', month: 'long',
    year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// « dans 12 jours », « demain », « aujourd'hui »
export function relativeDays(iso) {
  if (!iso) return 'Sans date';
  const n = daysBetween(todayParis(), iso);
  if (n === 0) return "C'est aujourd'hui";
  if (n === 1) return 'Demain';
  if (n > 1) return `Dans ${n} jours`;
  return 'Passé';
}

// Un événement est clôturé si closed_at est rempli ou si sa date est passée
export function isClosed(ev) {
  return Boolean(ev.closed_at) || (ev.event_date !== null && ev.event_date < todayParis());
}

// ---------------------------------------------------------------------------
// Noms
// ---------------------------------------------------------------------------
export function fullName(p) {
  if (!p) return 'Quelqu’un';
  return [p.first_name, p.last_name].filter(Boolean).join(' ');
}

export const PRIORITIES = {
  1: { label: 'J’en rêve', short: 'Rêve', cls: 'p1' },
  2: { label: 'J’en ai envie', short: 'Envie', cls: 'p2' },
  3: { label: 'Sympa', short: 'Sympa', cls: 'p3' },
};

// ---------------------------------------------------------------------------
// Messages d'erreur en français clair
// ---------------------------------------------------------------------------
export function errorMessage(err) {
  if (!err) return 'Une erreur est survenue.';
  const msg = String(err.message || err.error_description || err);
  // Nos propres messages (raise exception dans la base) sont déjà en français
  if (err.code === 'P0001') return msg;
  if (/row-level security|permission denied/i.test(msg)) return 'Cette action ne t’est pas permise.';
  if (/duplicate key/i.test(msg)) return 'C’est déjà fait.';
  if (/violates check constraint/i.test(msg)) return 'Une valeur saisie n’est pas acceptée (longueur ou format).';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Pas de connexion. Vérifie ton réseau puis réessaie.';
  if (/rate limit|too many/i.test(msg)) return 'Trop de tentatives. Patiente quelques minutes puis réessaie.';
  if (/Anonymous sign-ins are disabled/i.test(msg)) return 'Les connexions anonymes ne sont pas activées dans Supabase (voir README, étape 2).';
  if (/Signups not allowed for otp|User not found/i.test(msg)) return 'Aucun compte n’est associé à cette adresse e-mail.';
  if (/[àéèêç]/.test(msg)) return msg;
  return 'Une erreur est survenue. Réessaie dans un instant.';
}

// ---------------------------------------------------------------------------
// Petits messages (toasts), annoncés aux lecteurs d'écran
// ---------------------------------------------------------------------------
export function toast(message, kind = 'info') {
  const zone = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  zone.appendChild(el);
  setTimeout(() => el.classList.add('out'), kind === 'error' ? 5000 : 2800);
  setTimeout(() => el.remove(), kind === 'error' ? 5400 : 3200);
}

export function showError(err) {
  console.error(err);
  toast(errorMessage(err), 'error');
}

// ---------------------------------------------------------------------------
// Boîte de dialogue générique (<dialog>)
// content : gabarit html ; buttons : [{ label, value, primary, danger }]
// Renvoie une promesse résolue avec { value, form } (form = FormData ou null)
// ---------------------------------------------------------------------------
export function dialog({ title, content = '', buttons }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    render(dlg, html`
      <form method="dialog" class="dialog-form">
        <h2 class="dialog-title">${title}</h2>
        <div class="dialog-body">${content}</div>
        <div class="dialog-actions">
          ${buttons.map((b) => html`
            <button type="submit" value="${b.value}"
              class="btn ${b.primary ? 'btn-primary' : ''} ${b.danger ? 'btn-danger' : ''} ${!b.primary && !b.danger ? 'btn-secondary' : ''}"
              ${b.value === 'cancel' ? raw('formnovalidate') : ''}>${b.label}</button>`)}
        </div>
      </form>`);
    document.body.appendChild(dlg);
    const form = dlg.querySelector('form');
    let submitter = null;
    form.addEventListener('submit', (e) => { submitter = e.submitter; });
    dlg.addEventListener('close', () => {
      const value = submitter ? submitter.value : 'cancel';
      const data = value === 'cancel' ? null : new FormData(form);
      dlg.remove();
      resolve({ value, form: data });
    });
    dlg.showModal();
    const first = dlg.querySelector('input:not([type=hidden]), select, textarea');
    if (first) first.focus();
  });
}

// Confirmation avant suppression
export async function confirmAction(title, message, confirmLabel = 'Supprimer', danger = true) {
  const { value } = await dialog({
    title,
    content: html`<p>${message}</p>`,
    buttons: [
      { label: 'Annuler', value: 'cancel' },
      { label: confirmLabel, value: 'ok', danger, primary: !danger },
    ],
  });
  return value === 'ok';
}

// Désactive un bouton le temps d'une action asynchrone
export async function busy(button, fn) {
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try {
    return await fn();
  } finally {
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}

// Icônes (toujours accompagnées d'un libellé texte)
export const ICONS = {
  events: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  ideas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v10H4zM2 7h20v4H2zM12 7v14M12 7c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z"/></svg>',
  claims: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>',
  profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
};
