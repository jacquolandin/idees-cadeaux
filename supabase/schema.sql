-- =============================================================================
--  Idées Cadeaux — schéma Supabase (PostgreSQL)
--
--  À coller dans Supabase > SQL Editor et à exécuter UNE FOIS sur un projet neuf.
--  Contenu : tables, contraintes, index, fonctions d'aide, déclencheurs,
--  politiques RLS, vues et fonctions appelées par le site (RPC).
--
--  Principe : le secret (idées secrètes, réservations, événements surprise)
--  est garanti ICI, par la base. L'interface ne fait qu'afficher ce que la base
--  accepte de lui renvoyer.
--
--  Écarts assumés par rapport au cahier des charges (voir README) :
--   * le drapeau « cadeau groupé » est rangé dans une table à part
--     (idea_groups) plutôt que dans ideas.is_group, pour que le propriétaire
--     ne puisse pas le lire par l'API ;
--   * les réservations (claims) ne sont accessibles qu'à travers la vue
--     v_claims et les fonctions claim_idea / unclaim_idea / open_group.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Jeton d'invitation : 64 caractères hexadécimaux (≈ 244 bits aléatoires)
-- -----------------------------------------------------------------------------
create or replace function public.new_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

-- Personnes : soit liées à un compte (user_id), soit profils gérés (managed_by)
create table public.persons (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete cascade,
  managed_by  uuid references public.persons(id) on delete cascade,
  first_name  text not null check (char_length(btrim(first_name)) between 1 and 50),
  last_name   text check (last_name is null or char_length(last_name) <= 50),
  created_at  timestamptz not null default now(),
  -- exactement l'un des deux : un compte OU un gestionnaire
  constraint persons_compte_ou_gere check ((user_id is null) <> (managed_by is null))
);
create index persons_managed_by_idx on public.persons(managed_by);

-- Événements
create table public.events (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (char_length(btrim(title)) between 1 and 100),
  kind          text not null default 'person' check (kind in ('person', 'collective')),
  event_date    date,
  is_surprise   boolean not null default false,
  description   text check (description is null or char_length(description) <= 500),
  invite_token  text not null unique default public.new_token()
                check (char_length(invite_token) >= 32),
  created_by    uuid references public.persons(id) on delete set null,
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  -- une surprise n'a de sens que pour un événement « pour une personne »
  constraint events_surprise_pour_une_personne check (not (is_surprise and kind = 'collective'))
);
create index events_created_by_idx on public.events(created_by);

-- Participants (organisateurs et membres)
create table public.event_members (
  event_id   uuid not null references public.events(id) on delete cascade,
  person_id  uuid not null references public.persons(id) on delete cascade,
  role       text not null default 'member' check (role in ('organizer', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (event_id, person_id)
);
create index event_members_person_idx on public.event_members(person_id);

-- Concernés (événements « pour une personne »)
create table public.event_honorees (
  event_id   uuid not null references public.events(id) on delete cascade,
  person_id  uuid not null references public.persons(id) on delete cascade,
  primary key (event_id, person_id)
);
create index event_honorees_person_idx on public.event_honorees(person_id);

-- Idées
create table public.ideas (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.persons(id) on delete cascade,
  author_id   uuid references public.persons(id) on delete set null,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  url         text check (
                url is null
                or (char_length(url) <= 2000 and url ~* '^https?://[^\s/?#]+\.[^\s]*$')
              ),
  comment     text check (comment is null or char_length(comment) <= 500),
  -- 1 = « J'en rêve », 2 = « J'en ai envie » (défaut), 3 = « Sympa »
  priority    smallint not null default 2 check (priority between 1 and 3),
  share_mode  text not null default 'all' check (share_mode in ('all', 'selected', 'private')),
  -- calculé à la création : auteur ≠ propriétaire et ≠ gestionnaire du propriétaire
  is_secret   boolean not null default false,
  -- l'auteur d'une idée secrète peut la révéler : elle devient ordinaire
  revealed    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- une idée secrète non révélée ne peut pas être « gardée pour moi »
  constraint ideas_secrete_pas_privee check (not (is_secret and not revealed and share_mode = 'private'))
);
create index ideas_owner_idx on public.ideas(owner_id);
create index ideas_author_idx on public.ideas(author_id);

-- Partage « certains événements »
create table public.idea_events (
  idea_id   uuid not null references public.ideas(id) on delete cascade,
  event_id  uuid not null references public.events(id) on delete cascade,
  primary key (idea_id, event_id)
);
create index idea_events_event_idx on public.idea_events(event_id);

-- Idées ouvertes aux participations (cadeau groupé). Jamais lisible directement.
create table public.idea_groups (
  idea_id    uuid primary key references public.ideas(id) on delete cascade,
  opened_by  uuid references public.persons(id) on delete set null,
  opened_at  timestamptz not null default now()
);
create index idea_groups_opened_by_idx on public.idea_groups(opened_by);

-- Réservations. Jamais lisibles directement : vue v_claims.
create table public.claims (
  id            uuid primary key default gen_random_uuid(),
  idea_id       uuid not null references public.ideas(id) on delete cascade,
  claimer_id    uuid not null references public.persons(id) on delete cascade,
  event_id      uuid not null references public.events(id) on delete cascade,
  is_anonymous  boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (idea_id, claimer_id)
);
create index claims_idea_idx on public.claims(idea_id);
create index claims_claimer_idx on public.claims(claimer_id);
create index claims_event_idx on public.claims(event_id);

-- -----------------------------------------------------------------------------
-- 2. Fonctions d'aide (SECURITY DEFINER : elles lisent les tables sans
--    déclencher les politiques RLS, ce qui évite les récursions)
-- -----------------------------------------------------------------------------

-- Personne liée au compte connecté (null si pas encore de profil)
create or replace function public.current_person_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.persons where user_id = auth.uid();
$$;

-- Vrai si je suis le gestionnaire de ce profil géré
create or replace function public.manages(p_person uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.persons
    where id = p_person
      and managed_by is not null
      and managed_by = public.current_person_id()
  );
$$;

create or replace function public.is_event_member(p_event uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_members
    where event_id = p_event and person_id = public.current_person_id()
  );
$$;

create or replace function public.is_event_organizer(p_event uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.event_members
    where event_id = p_event
      and person_id = public.current_person_id()
      and role = 'organizer'
  );
$$;

-- Clôture : manuelle (closed_at) ou automatique le lendemain de la date,
-- à minuit heure de Paris. Aucune tâche planifiée nécessaire.
create or replace function public.is_event_closed(p_event uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select closed_at is not null
        or (event_date is not null
            and event_date < (now() at time zone 'Europe/Paris')::date)
    from public.events where id = p_event
  ), true);
$$;

-- Je peux voir l'événement si j'en suis membre (ou si j'y gère quelqu'un),
-- SAUF si c'est une surprise dont je suis le concerné.
create or replace function public.can_see_event(p_event uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with me as (select public.current_person_id() as id)
  select (select id from me) is not null
    and (
      exists (select 1 from public.event_members m
              where m.event_id = p_event and m.person_id = (select id from me))
      or exists (select 1 from public.event_members m
                 join public.persons p on p.id = m.person_id
                 where m.event_id = p_event and p.managed_by = (select id from me))
      or exists (select 1 from public.event_honorees h
                 join public.persons p on p.id = h.person_id
                 where h.event_id = p_event and p.managed_by = (select id from me))
    )
    and not exists (
      select 1 from public.events e
      join public.event_honorees h on h.event_id = e.id
      where e.id = p_event and e.is_surprise and h.person_id = (select id from me)
    );
$$;

-- La liste de cette personne est-elle affichée dans cet événement ?
-- Collectif : tous les membres. « Pour une personne » : seulement les concernés.
create or replace function public.person_listed_in_event(p_person uuid, p_event uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.event_honorees
                 where event_id = p_event and person_id = p_person)
      or exists (select 1 from public.events e
                 join public.event_members m on m.event_id = e.id
                 where e.id = p_event and e.kind = 'collective' and m.person_id = p_person);
$$;

-- L'idée est-elle ouverte à cet événement (selon son mode de partage) ?
create or replace function public.idea_open_to_event(p_idea uuid, p_share text, p_event uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_share = 'all'
      or (p_share = 'selected'
          and exists (select 1 from public.idea_events
                      where idea_id = p_idea and event_id = p_event));
$$;

-- Je peux voir cette personne : moi, mes profils gérés, ou quelqu'un qui
-- figure dans un événement que je vois.
create or replace function public.can_see_person(p_person uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with me as (select public.current_person_id() as id)
  select (select id from me) is not null and (
    p_person = (select id from me)
    or public.manages(p_person)
    or exists (
      select 1 from (
        select event_id from public.event_members where person_id = p_person
        union
        select event_id from public.event_honorees where person_id = p_person
      ) x
      where public.can_see_event(x.event_id)
    )
  );
$$;

-- Cœur des règles de visibilité d'une idée (section 8).
-- Prend les colonnes de la ligne pour fonctionner aussi pendant un INSERT.
create or replace function public.idea_row_visible(
  p_id uuid, p_owner uuid, p_author uuid, p_share text, p_secret boolean, p_revealed boolean
)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := public.current_person_id();
begin
  if me is null then
    return false;
  end if;

  -- L'auteur voit toujours ce qu'il a écrit
  if p_author = me then
    return true;
  end if;

  -- Le gestionnaire voit tout, sans masquage
  if public.manages(p_owner) then
    return true;
  end if;

  -- Le propriétaire : pas d'idée secrète, sauf révélée ou offerte puis clôturée
  if p_owner = me then
    return (not p_secret)
        or p_revealed
        or exists (select 1 from public.claims c
                   where c.idea_id = p_id and public.is_event_closed(c.event_id));
  end if;

  -- Les autres : il faut un événement commun, que je vois, où la liste du
  -- propriétaire est affichée et auquel l'idée est ouverte.
  if p_share = 'private' then
    return false;
  end if;

  return exists (
    select 1 from (
      select event_id from public.event_members where person_id = p_owner
      union
      select event_id from public.event_honorees where person_id = p_owner
    ) x
    where public.can_see_event(x.event_id)
      and public.person_listed_in_event(p_owner, x.event_id)
      and public.idea_open_to_event(p_id, p_share, x.event_id)
  );
end;
$$;

create or replace function public.idea_visible_to_me(p_idea uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select public.idea_row_visible(i.id, i.owner_id, i.author_id, i.share_mode, i.is_secret, i.revealed)
    from public.ideas i where i.id = p_idea
  ), false);
$$;

-- Une réservation est révélée au propriétaire quand son événement est clôturé
create or replace function public.claim_revealed_to_owner(p_claim uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select public.is_event_closed(event_id)
                   from public.claims where id = p_claim), false);
$$;

-- Droit de modification d'une idée (section 5) :
-- ordinaire → propriétaire ; secrète → auteur et gestionnaire.
create or replace function public.can_edit_idea(
  p_owner uuid, p_author uuid, p_secret boolean, p_revealed boolean
)
returns boolean
language sql stable security definer set search_path = public
as $$
  with me as (select public.current_person_id() as id)
  select (select id from me) is not null and (
    p_author = (select id from me)
    or public.manages(p_owner)
    or (p_owner = (select id from me) and (not p_secret or p_revealed))
  );
$$;

-- Puis-je ajouter une idée à la liste de cette personne ?
create or replace function public.can_add_idea_for(p_owner uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with me as (select public.current_person_id() as id)
  select (select id from me) is not null and (
    p_owner = (select id from me)
    or public.manages(p_owner)
    or exists (
      select 1 from (
        select event_id from public.event_members where person_id = p_owner
        union
        select event_id from public.event_honorees where person_id = p_owner
      ) x
      where public.can_see_event(x.event_id)
        and public.person_listed_in_event(p_owner, x.event_id)
        and not public.is_event_closed(x.event_id)
    )
  );
$$;

-- Puis-je ouvrir cette idée à cet événement (partage « certains événements ») ?
create or replace function public.can_link_idea_event(p_idea uuid, p_event uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.ideas i
    where i.id = p_idea
      and public.can_edit_idea(i.owner_id, i.author_id, i.is_secret, i.revealed)
      and public.person_listed_in_event(i.owner_id, p_event)
      and (public.can_see_event(p_event) or public.manages(i.owner_id))
  );
$$;

-- -----------------------------------------------------------------------------
-- 3. Déclencheurs
-- -----------------------------------------------------------------------------

-- Idées : calcul du caractère secret, champs non modifiables, révélation
create or replace function public.ideas_before_write()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := public.current_person_id();
  owner_manager uuid;
begin
  if tg_op = 'INSERT' then
    select managed_by into owner_manager from public.persons where id = new.owner_id;
    new.is_secret := new.author_id is distinct from new.owner_id
                 and new.author_id is distinct from owner_manager;
    -- une idée secrète naît non révélée
    new.revealed := false;
    if new.is_secret and new.share_mode = 'private' then
      new.share_mode := 'selected';
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- UPDATE
  new.owner_id   := old.owner_id;
  new.author_id  := old.author_id;
  new.is_secret  := old.is_secret;
  new.created_at := old.created_at;
  new.updated_at := now();
  -- la révélation est définitive et réservée à l'auteur ou au gestionnaire
  if old.revealed then
    new.revealed := true;
  elsif new.revealed and not (me = old.author_id or public.manages(old.owner_id)) then
    new.revealed := false;
  end if;
  return new;
end;
$$;

create trigger ideas_before_write
before insert or update on public.ideas
for each row execute function public.ideas_before_write();

-- Événements : un événement clôturé est en lecture seule ; on ne rouvre pas ;
-- une surprise ne peut pas avoir de concerné déjà participant avec un compte.
create or replace function public.events_before_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.closed_at is not null
     or (old.event_date is not null
         and old.event_date < (now() at time zone 'Europe/Paris')::date) then
    raise exception 'Cet événement est clôturé : il n''est plus modifiable.'
      using errcode = 'P0001';
  end if;

  new.invite_token := coalesce(new.invite_token, old.invite_token);
  new.created_by   := old.created_by;
  new.created_at   := old.created_at;

  if new.is_surprise and exists (
    select 1 from public.event_honorees h
    join public.event_members m on m.event_id = h.event_id and m.person_id = h.person_id
    where h.event_id = new.id
  ) then
    raise exception 'Surprise impossible : un concerné participe déjà à l''événement.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger events_before_update
before update on public.events
for each row execute function public.events_before_update();

-- Concernés : seulement pour un événement « pour une personne » ouvert ;
-- dans une surprise, le concerné ne doit pas être participant.
create or replace function public.event_honorees_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  ev record;
begin
  select * into ev from public.events where id = new.event_id;
  if ev.kind <> 'person' then
    raise exception 'Un échange collectif n''a pas de concerné : tous les participants le sont.'
      using errcode = 'P0001';
  end if;
  if ev.is_surprise and exists (
    select 1 from public.event_members
    where event_id = new.event_id and person_id = new.person_id
  ) then
    raise exception 'Le concerné d''une surprise ne peut pas en être participant.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger event_honorees_before_insert
before insert on public.event_honorees
for each row execute function public.event_honorees_before_insert();

-- Participants : le concerné d'une surprise ne peut jamais entrer
create or replace function public.event_members_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.events e
    join public.event_honorees h on h.event_id = e.id
    where e.id = new.event_id and e.is_surprise and h.person_id = new.person_id
  ) then
    raise exception 'Lien d''invitation invalide.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger event_members_before_insert
before insert on public.event_members
for each row execute function public.event_members_before_insert();

-- Participants : si le dernier organisateur part, le plus ancien membre
-- disposant d'un compte devient organisateur.
create or replace function public.event_members_after_delete()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'organizer'
     and exists (select 1 from public.events where id = old.event_id)
     and not exists (select 1 from public.event_members
                     where event_id = old.event_id and role = 'organizer') then
    update public.event_members m
    set role = 'organizer'
    where (m.event_id, m.person_id) = (
      select m2.event_id, m2.person_id
      from public.event_members m2
      join public.persons p on p.id = m2.person_id
      where m2.event_id = old.event_id and p.user_id is not null
      order by m2.joined_at
      limit 1
    );
  end if;
  return null;
end;
$$;

create trigger event_members_after_delete
after delete on public.event_members
for each row execute function public.event_members_after_delete();

-- Réservations : une seule par idée, sauf cadeau groupé ; jamais sur un
-- événement clôturé. Verrou sur l'idée pour éviter deux réservations simultanées.
create or replace function public.claims_before_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform 1 from public.ideas where id = new.idea_id for update;

  if public.is_event_closed(new.event_id) then
    raise exception 'Cet événement est clôturé : plus de réservation possible.'
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.idea_groups where idea_id = new.idea_id)
     and exists (select 1 from public.claims where idea_id = new.idea_id) then
    raise exception 'Cette idée est déjà réservée par quelqu''un d''autre.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger claims_before_insert
before insert on public.claims
for each row execute function public.claims_before_insert();

-- -----------------------------------------------------------------------------
-- 4. Politiques RLS
-- -----------------------------------------------------------------------------
alter table public.persons        enable row level security;
alter table public.events         enable row level security;
alter table public.event_members  enable row level security;
alter table public.event_honorees enable row level security;
alter table public.ideas          enable row level security;
alter table public.idea_events    enable row level security;
alter table public.idea_groups    enable row level security;  -- aucune politique : inaccessible
alter table public.claims         enable row level security;  -- aucune politique : inaccessible

-- persons
create policy persons_select on public.persons for select to authenticated
  using (user_id = auth.uid()
         or managed_by = public.current_person_id()
         or public.can_see_person(id));

create policy persons_insert on public.persons for insert to authenticated
  with check (
    (user_id = auth.uid() and managed_by is null)
    or (user_id is null and public.current_person_id() is not null
        and managed_by = public.current_person_id())
  );

create policy persons_update on public.persons for update to authenticated
  using (user_id = auth.uid() or managed_by = public.current_person_id())
  with check (user_id = auth.uid() or managed_by = public.current_person_id());

create policy persons_delete on public.persons for delete to authenticated
  using (managed_by = public.current_person_id());

-- events (création par la fonction create_event)
create policy events_select on public.events for select to authenticated
  using (public.can_see_event(id));

create policy events_update on public.events for update to authenticated
  using (public.is_event_organizer(id))
  with check (public.is_event_organizer(id));

create policy events_delete on public.events for delete to authenticated
  using (public.is_event_organizer(id));

-- event_members (adhésion par join_event / add_managed_member uniquement)
create policy event_members_select on public.event_members for select to authenticated
  using (public.can_see_event(event_id));

create policy event_members_delete on public.event_members for delete to authenticated
  using (person_id = public.current_person_id()
         or public.manages(person_id)
         or public.is_event_organizer(event_id));

-- event_honorees
create policy event_honorees_select on public.event_honorees for select to authenticated
  using (public.can_see_event(event_id));

create policy event_honorees_insert on public.event_honorees for insert to authenticated
  with check (public.is_event_organizer(event_id)
              and not public.is_event_closed(event_id)
              and public.can_see_person(person_id));

create policy event_honorees_delete on public.event_honorees for delete to authenticated
  using (public.is_event_organizer(event_id) and not public.is_event_closed(event_id));

-- ideas
create policy ideas_select on public.ideas for select to authenticated
  using (public.idea_row_visible(id, owner_id, author_id, share_mode, is_secret, revealed));

create policy ideas_insert on public.ideas for insert to authenticated
  with check (author_id = public.current_person_id()
              and public.can_add_idea_for(owner_id));

create policy ideas_update on public.ideas for update to authenticated
  using (public.can_edit_idea(owner_id, author_id, is_secret, revealed))
  with check (public.can_edit_idea(owner_id, author_id, is_secret, revealed));

create policy ideas_delete on public.ideas for delete to authenticated
  using (public.can_edit_idea(owner_id, author_id, is_secret, revealed));

-- idea_events
create policy idea_events_select on public.idea_events for select to authenticated
  using ((public.can_see_event(event_id)
          or exists (select 1 from public.ideas i
                     where i.id = idea_id and public.manages(i.owner_id)))
         and public.idea_visible_to_me(idea_id));

create policy idea_events_insert on public.idea_events for insert to authenticated
  with check (public.can_link_idea_event(idea_id, event_id));

create policy idea_events_delete on public.idea_events for delete to authenticated
  using (exists (select 1 from public.ideas i
                 where i.id = idea_id
                   and public.can_edit_idea(i.owner_id, i.author_id, i.is_secret, i.revealed)));

-- -----------------------------------------------------------------------------
-- 5. Vues de lecture des réservations (propriétaire = postgres : elles lisent
--    claims malgré l'absence de politique, et filtrent elles-mêmes)
-- -----------------------------------------------------------------------------

-- Réservations visibles par la personne connectée, identité masquée si anonyme.
create view public.v_claims with (security_barrier = true) as
with me as (select public.current_person_id() as id)
select
  c.id,
  c.idea_id,
  i.title                                   as idea_title,
  i.url                                     as idea_url,
  i.owner_id,
  trim(o.first_name || ' ' || coalesce(o.last_name, '')) as owner_name,
  case when c.claimer_id = me.id or public.can_see_event(c.event_id)
       then c.event_id end                  as event_id,
  case when c.claimer_id = me.id or public.can_see_event(c.event_id)
       then e.title end                     as event_title,
  case when c.claimer_id = me.id or public.can_see_event(c.event_id)
       then e.event_date end                as event_date,
  public.is_event_closed(c.event_id)        as event_closed,
  c.is_anonymous,
  (c.claimer_id = me.id)                    as is_mine,
  case when c.claimer_id = me.id or public.manages(i.owner_id) or not c.is_anonymous
       then c.claimer_id end                as claimer_id,
  case when c.claimer_id = me.id or public.manages(i.owner_id) or not c.is_anonymous
       then trim(p.first_name || ' ' || coalesce(p.last_name, '')) end as claimer_name,
  exists (select 1 from public.idea_groups g where g.idea_id = c.idea_id) as is_group,
  c.created_at
from public.claims c
join public.ideas i   on i.id = c.idea_id
join public.persons o on o.id = i.owner_id
join public.persons p on p.id = c.claimer_id
join public.events e  on e.id = c.event_id
cross join me
where me.id is not null
  and (
    -- ma propre réservation
    c.claimer_id = me.id
    -- gestionnaire du propriétaire : tout
    or public.manages(i.owner_id)
    -- autre donneur qui voit l'idée
    or (i.owner_id <> me.id
        and public.idea_row_visible(i.id, i.owner_id, i.author_id, i.share_mode, i.is_secret, i.revealed))
    -- propriétaire : seulement après la clôture de l'événement de la réservation
    or (i.owner_id = me.id and public.is_event_closed(c.event_id))
  );

-- Idées ouvertes aux participations, jamais montrées au propriétaire
create view public.v_groups with (security_barrier = true) as
select g.idea_id, g.opened_at
from public.idea_groups g
join public.ideas i on i.id = g.idea_id
where public.current_person_id() is not null
  and (public.manages(i.owner_id)
       or (i.owner_id <> public.current_person_id()
           and public.idea_row_visible(i.id, i.owner_id, i.author_id, i.share_mode, i.is_secret, i.revealed)));

-- -----------------------------------------------------------------------------
-- 6. Fonctions appelées par le site (RPC)
-- -----------------------------------------------------------------------------

-- Petite aide : exige un profil
create or replace function public.require_person()
returns uuid
language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := public.current_person_id();
begin
  if me is null then
    raise exception 'Profil introuvable : reconnecte-toi.' using errcode = 'P0001';
  end if;
  return me;
end;
$$;

-- Créer un événement (le créateur devient organisateur)
create or replace function public.create_event(
  p_title text,
  p_kind text,
  p_date date,
  p_surprise boolean,
  p_description text,
  p_honorees uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := public.require_person();
  new_id uuid;
  h uuid;
begin
  if p_surprise and me = any(coalesce(p_honorees, '{}')) then
    raise exception 'Tu ne peux pas organiser ta propre surprise.' using errcode = 'P0001';
  end if;

  insert into public.events (title, kind, event_date, is_surprise, description, created_by)
  values (btrim(p_title), p_kind, p_date, coalesce(p_surprise, false),
          nullif(btrim(coalesce(p_description, '')), ''), me)
  returning id into new_id;

  insert into public.event_members (event_id, person_id, role)
  values (new_id, me, 'organizer');

  if p_kind = 'person' then
    foreach h in array coalesce(p_honorees, '{}') loop
      if not public.can_see_person(h) then
        raise exception 'Concerné inconnu.' using errcode = 'P0001';
      end if;
      insert into public.event_honorees (event_id, person_id)
      values (new_id, h) on conflict do nothing;
    end loop;
  end if;

  return new_id;
end;
$$;

-- Rejoindre un événement par son jeton d'invitation
create or replace function public.join_event(p_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := public.require_person();
  ev record;
begin
  select * into ev from public.events where invite_token = p_token;

  -- même message que pour un jeton inconnu : aucune trace pour le concerné
  if ev.id is null or (ev.is_surprise and exists (
       select 1 from public.event_honorees where event_id = ev.id and person_id = me)) then
    raise exception 'Lien d''invitation invalide ou expiré.' using errcode = 'P0001';
  end if;

  if public.is_event_closed(ev.id) and not public.is_event_member(ev.id) then
    raise exception 'Cet événement est clôturé.' using errcode = 'P0001';
  end if;

  insert into public.event_members (event_id, person_id, role)
  values (ev.id, me, 'member')
  on conflict do nothing;

  return ev.id;
end;
$$;

-- Régénérer le lien d'invitation (l'ancien cesse de fonctionner)
create or replace function public.regenerate_invite(p_event uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  tok text := public.new_token();
begin
  if not public.is_event_organizer(p_event) then
    raise exception 'Réservé aux organisateurs.' using errcode = 'P0001';
  end if;
  update public.events set invite_token = tok where id = p_event;
  return tok;
end;
$$;

-- Nommer ou retirer un organisateur
create or replace function public.set_member_role(p_event uuid, p_person uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_event_organizer(p_event) then
    raise exception 'Réservé aux organisateurs.' using errcode = 'P0001';
  end if;
  if p_role not in ('organizer', 'member') then
    raise exception 'Rôle inconnu.' using errcode = 'P0001';
  end if;
  if p_role = 'member' and (select count(*) from public.event_members
                            where event_id = p_event and role = 'organizer') <= 1 then
    raise exception 'Il faut au moins un organisateur.' using errcode = 'P0001';
  end if;
  update public.event_members set role = p_role
  where event_id = p_event and person_id = p_person;
end;
$$;

-- Inscrire un de mes profils gérés à un échange collectif dont je suis membre
create or replace function public.add_managed_member(p_event uuid, p_person uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.manages(p_person) then
    raise exception 'Ce profil n''est pas géré par toi.' using errcode = 'P0001';
  end if;
  if not public.is_event_member(p_event) then
    raise exception 'Tu dois d''abord participer à l''événement.' using errcode = 'P0001';
  end if;
  if (select kind from public.events where id = p_event) <> 'collective' then
    raise exception 'Seul un échange collectif accepte des profils gérés comme participants.'
      using errcode = 'P0001';
  end if;
  if public.is_event_closed(p_event) then
    raise exception 'Cet événement est clôturé.' using errcode = 'P0001';
  end if;
  insert into public.event_members (event_id, person_id, role)
  values (p_event, p_person, 'member') on conflict do nothing;
end;
$$;

-- Réserver (« Je l'offre ») ou participer à un cadeau groupé (« Je participe »)
create or replace function public.claim_idea(p_idea uuid, p_event uuid, p_anonymous boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := public.require_person();
  i record;
  new_id uuid;
begin
  select * into i from public.ideas where id = p_idea;
  if i.id is null or not public.idea_visible_to_me(p_idea) then
    raise exception 'Idée introuvable.' using errcode = 'P0001';
  end if;
  if i.owner_id = me then
    raise exception 'Tu ne peux pas réserver ta propre idée.' using errcode = 'P0001';
  end if;
  if not (public.can_see_event(p_event)
          and public.person_listed_in_event(i.owner_id, p_event)
          and public.idea_open_to_event(i.id, i.share_mode, p_event)) then
    raise exception 'Cette idée n''est pas proposée dans cet événement.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.claims where idea_id = p_idea and claimer_id = me) then
    raise exception 'Tu as déjà réservé cette idée.' using errcode = 'P0001';
  end if;

  insert into public.claims (idea_id, claimer_id, event_id, is_anonymous)
  values (p_idea, me, p_event, coalesce(p_anonymous, false))
  returning id into new_id;
  return new_id;
end;
$$;

-- Annuler MA réservation (jamais celle d'un autre, jamais après clôture)
create or replace function public.unclaim_idea(p_idea uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := public.require_person();
  c record;
begin
  select * into c from public.claims where idea_id = p_idea and claimer_id = me;
  if c.id is null then
    raise exception 'Aucune réservation à ton nom sur cette idée.' using errcode = 'P0001';
  end if;
  if public.is_event_closed(c.event_id) then
    raise exception 'Cet événement est clôturé : la réservation ne peut plus être annulée.'
      using errcode = 'P0001';
  end if;
  delete from public.claims where id = c.id;
end;
$$;

-- Ouvrir une idée aux participations (cadeau groupé)
create or replace function public.open_group(p_idea uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me uuid := public.require_person();
  i record;
begin
  select * into i from public.ideas where id = p_idea for update;
  if i.id is null or not public.idea_visible_to_me(p_idea) or i.owner_id = me then
    raise exception 'Idée introuvable.' using errcode = 'P0001';
  end if;
  -- on n'ouvre pas le cadeau de quelqu'un d'autre sans son accord
  if exists (select 1 from public.claims where idea_id = p_idea and claimer_id <> me) then
    raise exception 'Cette idée est déjà réservée par quelqu''un d''autre.' using errcode = 'P0001';
  end if;
  insert into public.idea_groups (idea_id, opened_by) values (p_idea, me)
  on conflict do nothing;
end;
$$;

-- Avertissement de doublon : idées au titre proche sur la liste de quelqu'un.
-- Renvoie le titre si je vois l'idée, sinon une ligne sans titre (idée secrète
-- que je ne vois pas). Pour le propriétaire, les idées secrètes sont ignorées.
create or replace function public.similar_ideas(p_owner uuid, p_title text)
returns table (title text)
language plpgsql stable security definer set search_path = public
as $$
declare
  me uuid := public.require_person();
  norm text := lower(btrim(translate(coalesce(p_title, ''),
               'àâäáãéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
               'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')));
begin
  if not public.can_add_idea_for(p_owner) or char_length(norm) < 3 then
    return;
  end if;
  return query
  select case when public.idea_row_visible(i.id, i.owner_id, i.author_id, i.share_mode, i.is_secret, i.revealed)
              then i.title end
  from public.ideas i,
       lateral (select lower(btrim(translate(i.title,
               'àâäáãéèêëíìîïóòôöõúùûüçñÀÂÄÁÃÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ',
               'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn'))) as t) n
  where i.owner_id = p_owner
    and not (p_owner = me and i.is_secret and not i.revealed and not public.manages(p_owner))
    and (n.t = norm
         or (char_length(norm) >= 4 and position(norm in n.t) > 0)
         or (char_length(n.t) >= 4 and position(n.t in norm) > 0))
  limit 5;
end;
$$;

-- Supprimer mon compte et mes données (profils gérés compris, par cascade)
create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Non connecté.' using errcode = 'P0001';
  end if;
  delete from public.persons where managed_by = public.current_person_id();
  delete from public.persons where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Droits d'accès (le rôle « anon » n'a accès à rien ; toute personne
--    connectée, même anonymement, a le rôle « authenticated »)
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;

grant usage on schema public to authenticated;

grant select, insert, delete on public.persons to authenticated;
grant update (first_name, last_name) on public.persons to authenticated;

grant select, delete on public.events to authenticated;
grant update (title, kind, event_date, is_surprise, description, closed_at) on public.events to authenticated;

grant select, delete on public.event_members to authenticated;
grant select, insert, delete on public.event_honorees to authenticated;

grant select, insert, delete on public.ideas to authenticated;
grant update (title, url, comment, priority, share_mode, revealed) on public.ideas to authenticated;

grant select, insert, delete on public.idea_events to authenticated;

-- claims et idea_groups : aucun droit direct
grant select on public.v_claims, public.v_groups to authenticated;

grant execute on all functions in schema public to authenticated;
