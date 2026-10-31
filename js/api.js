// =============================================================================
//  Accès aux données Supabase
//  Toutes les règles de secret sont appliquées par la base (RLS, vues,
//  fonctions) : ce fichier ne fait que demander, la base décide.
// =============================================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const configured =
  !SUPABASE_URL.includes('VOTRE-PROJET') && !SUPABASE_ANON_KEY.includes('VOTRE-CLE');

export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // « implicit » : le lien magique marche même s'il est ouvert dans un
      // autre navigateur que celui où il a été demandé
      flowType: 'implicit',
      storageKey: 'idees-cadeaux-session',
    },
  })
  : null;

// Lève l'erreur Supabase s'il y en a une, sinon renvoie les données
function check({ data, error }) {
  if (error) throw error;
  return data;
}

async function rpc(name, args = {}) {
  return check(await sb.rpc(name, args));
}

// Adresse de retour des liens envoyés par e-mail : la page actuelle, sans fragment
export function siteUrl() {
  return location.origin + location.pathname;
}

// ---------------------------------------------------------------------------
// Comptes et personnes
// ---------------------------------------------------------------------------
export async function getMyPerson(userId) {
  return check(await sb.from('persons').select('*').eq('user_id', userId).maybeSingle());
}

export async function createMyPerson(userId, firstName, lastName) {
  return check(await sb.from('persons')
    .insert({ user_id: userId, first_name: firstName, last_name: lastName || null })
    .select().single());
}

export async function updatePerson(id, firstName, lastName) {
  check(await sb.from('persons')
    .update({ first_name: firstName, last_name: lastName || null }).eq('id', id));
}

export async function listManaged(meId) {
  return check(await sb.from('persons').select('*')
    .eq('managed_by', meId).order('first_name'));
}

export async function createManaged(meId, firstName, lastName) {
  return check(await sb.from('persons')
    .insert({ managed_by: meId, first_name: firstName, last_name: lastName || null })
    .select().single());
}

export async function deletePerson(id) {
  check(await sb.from('persons').delete().eq('id', id));
}

export async function deleteMyAccount() {
  await rpc('delete_my_account');
}

// ---------------------------------------------------------------------------
// Événements : on charge en une fois tout ce que la personne a le droit de
// voir (quelques dizaines de lignes pour un usage familial).
// ---------------------------------------------------------------------------
export async function loadEvents() {
  const [events, members, honorees, persons] = await Promise.all([
    sb.from('events').select('*').order('event_date', { ascending: true, nullsFirst: false }),
    sb.from('event_members').select('*'),
    sb.from('event_honorees').select('*'),
    sb.from('persons').select('*'),
  ]).then((rs) => rs.map(check));

  const personById = new Map(persons.map((p) => [p.id, p]));
  const byEvent = new Map(events.map((e) => [e.id, { ...e, members: [], honorees: [] }]));
  members.forEach((m) => byEvent.get(m.event_id)?.members.push(m));
  honorees.forEach((h) => byEvent.get(h.event_id)?.honorees.push(h.person_id));
  return { events: [...byEvent.values()], personById };
}

// Personnes dont la liste est affichée dans l'événement
export function listedPersons(ev) {
  if (ev.kind === 'collective') return ev.members.map((m) => m.person_id);
  return ev.honorees;
}

export async function createEvent({ title, kind, date, surprise, description, honorees }) {
  return rpc('create_event', {
    p_title: title,
    p_kind: kind,
    p_date: date || null,
    p_surprise: surprise,
    p_description: description || null,
    p_honorees: honorees,
  });
}

export async function updateEvent(id, fields) {
  check(await sb.from('events').update(fields).eq('id', id));
}

export async function setHonorees(eventId, add, remove) {
  if (remove.length) {
    check(await sb.from('event_honorees').delete()
      .eq('event_id', eventId).in('person_id', remove));
  }
  if (add.length) {
    check(await sb.from('event_honorees')
      .insert(add.map((person_id) => ({ event_id: eventId, person_id }))));
  }
}

export async function closeEvent(id) {
  check(await sb.from('events').update({ closed_at: new Date().toISOString() }).eq('id', id));
}

export async function deleteEvent(id) {
  check(await sb.from('events').delete().eq('id', id));
}

export async function joinEvent(token) {
  return rpc('join_event', { p_token: token });
}

export async function regenerateInvite(eventId) {
  return rpc('regenerate_invite', { p_event: eventId });
}

export async function setMemberRole(eventId, personId, role) {
  await rpc('set_member_role', { p_event: eventId, p_person: personId, p_role: role });
}

export async function addManagedMember(eventId, personId) {
  await rpc('add_managed_member', { p_event: eventId, p_person: personId });
}

export async function leaveEvent(eventId, personId) {
  check(await sb.from('event_members').delete()
    .eq('event_id', eventId).eq('person_id', personId));
}

// ---------------------------------------------------------------------------
// Idées
// ---------------------------------------------------------------------------

// Idées de plusieurs personnes, avec leurs partages, réservations et groupes
// (uniquement ce que la base accepte de montrer).
export async function loadIdeas(ownerIds) {
  if (!ownerIds.length) return [];
  const ideas = check(await sb.from('ideas').select('*').in('owner_id', ownerIds));
  if (!ideas.length) return [];
  const ids = ideas.map((i) => i.id);
  const [links, claims, groups] = await Promise.all([
    sb.from('idea_events').select('*').in('idea_id', ids),
    sb.from('v_claims').select('*').in('idea_id', ids),
    sb.from('v_groups').select('*').in('idea_id', ids),
  ]).then((rs) => rs.map(check));

  const groupSet = new Set(groups.map((g) => g.idea_id));
  return ideas.map((i) => ({
    ...i,
    eventIds: links.filter((l) => l.idea_id === i.id).map((l) => l.event_id),
    claims: claims.filter((c) => c.idea_id === i.id),
    isGroup: groupSet.has(i.id),
  }));
}

export async function getIdea(id) {
  const rows = await sb.from('ideas').select('*').eq('id', id).maybeSingle();
  const idea = check(rows);
  if (!idea) return null;
  const links = check(await sb.from('idea_events').select('*').eq('idea_id', id));
  return { ...idea, eventIds: links.map((l) => l.event_id) };
}

// L'idée est-elle proposée dans cet événement ?
export function ideaOpenTo(idea, eventId) {
  return idea.share_mode === 'all'
    || (idea.share_mode === 'selected' && idea.eventIds.includes(eventId));
}

export async function addIdea(fields, eventIds = []) {
  const idea = check(await sb.from('ideas').insert(fields).select().single());
  if (eventIds.length) {
    check(await sb.from('idea_events')
      .insert(eventIds.map((event_id) => ({ idea_id: idea.id, event_id }))));
  }
  return idea;
}

export async function updateIdea(id, fields) {
  check(await sb.from('ideas').update(fields).eq('id', id));
}

export async function setIdeaEvents(ideaId, add, remove) {
  if (remove.length) {
    check(await sb.from('idea_events').delete().eq('idea_id', ideaId).in('event_id', remove));
  }
  if (add.length) {
    check(await sb.from('idea_events')
      .insert(add.map((event_id) => ({ idea_id: ideaId, event_id }))));
  }
}

export async function deleteIdea(id) {
  check(await sb.from('ideas').delete().eq('id', id));
}

export async function similarIdeas(ownerId, title) {
  return rpc('similar_ideas', { p_owner: ownerId, p_title: title });
}

// ---------------------------------------------------------------------------
// Réservations
// ---------------------------------------------------------------------------
export async function claimIdea(ideaId, eventId, anonymous) {
  return rpc('claim_idea', { p_idea: ideaId, p_event: eventId, p_anonymous: anonymous });
}

export async function unclaimIdea(ideaId) {
  await rpc('unclaim_idea', { p_idea: ideaId });
}

export async function openGroup(ideaId) {
  await rpc('open_group', { p_idea: ideaId });
}

export async function myClaims() {
  return check(await sb.from('v_claims').select('*').eq('is_mine', true));
}
