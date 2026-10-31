-- =============================================================================
--  Idées Cadeaux — recettes SQL (tests de sécurité)
--
--  À exécuter dans Supabase > SQL Editor APRÈS schema.sql.
--  Tout se passe dans une transaction annulée à la fin (ROLLBACK) : aucune
--  donnée de test ne reste dans la base.
--
--  Résultat attendu : la dernière ligne affiche « Toutes les recettes sont
--  passées ». Une erreur « ÉCHEC : ... » indique la règle qui ne tient pas.
--
--  Personnages : Alice, Bob, Chloé, David, Marie (gère le profil de Léo, sans
--  compte) et Sam (concerné d'un anniversaire surprise).
--  Chaque requête est jouée « en tant que » l'un d'eux, avec le rôle
--  authenticated, exactement comme le ferait le site.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Outils de test (supprimés par le ROLLBACK final)
-- ---------------------------------------------------------------------------
create table public._t (k text primary key, v uuid, s text);
grant all on public._t to authenticated;

-- Se connecter en tant que quelqu'un (null = revenir administrateur)
create function public._as(p_name text) returns void language plpgsql as $$
begin
  if p_name is null then
    perform set_config('request.jwt.claims', '', true);
    perform set_config('role', 'postgres', true);
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub',
    case p_name
      when 'alice' then '00000000-0000-0000-0000-000000000001'
      when 'bob'   then '00000000-0000-0000-0000-000000000002'
      when 'chloe' then '00000000-0000-0000-0000-000000000003'
      when 'david' then '00000000-0000-0000-0000-000000000004'
      when 'marie' then '00000000-0000-0000-0000-000000000005'
      when 'sam'   then '00000000-0000-0000-0000-000000000006'
    end, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

-- Vérifier une condition
create function public._ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ÉCHEC : %', p_msg;
  end if;
end $$;

-- Vérifier qu'une commande est refusée (erreur ou aucune ligne touchée)
create function public._refused(p_sql text, p_msg text) returns void language plpgsql as $$
declare n int;
begin
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then
    return;  -- refusée par une erreur : c'est ce qu'on veut
  end;
  if n > 0 then
    raise exception 'ÉCHEC (commande acceptée) : %', p_msg;
  end if;
end $$;

create function public._id(p_k text) returns uuid language sql as $$
  select v from public._t where k = p_k $$;

grant execute on function public._as(text), public._ok(boolean, text),
  public._refused(text, text), public._id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Comptes
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004'),
  ('00000000-0000-0000-0000-000000000005'), ('00000000-0000-0000-0000-000000000006');

-- Chacun crée sa personne (comme l'écran « Comment tu t'appelles ? »)
select _as('alice');
insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000001', auth.uid(), 'Alice');
select _refused($$insert into persons (user_id, first_name) values ('00000000-0000-0000-0000-000000000002', 'Faux Bob')$$,
  'créer une personne pour le compte de quelqu''un d''autre');
select _as('bob');
insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000002', auth.uid(), 'Bob');
select _as('chloe');
insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000003', auth.uid(), 'Chloé');
select _as('david');
insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000004', auth.uid(), 'David');
select _as('marie');
insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000005', auth.uid(), 'Marie');
insert into persons (id, managed_by, first_name) values ('11111111-0000-0000-0000-000000000007', current_person_id(), 'Léo');
select _as('sam');
insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000006', auth.uid(), 'Sam');

-- Alice crée Noël (échange collectif, dans 30 jours)
select _as('alice');
insert into _t (k, v) select 'noel', create_event('Noël', 'collective', current_date + 30, false, null, '{}');
insert into _t (k, s) select 'noel_tok', invite_token from events where id = _id('noel');
select _ok((select count(*) = 1 from events where id = _id('noel')), 'Alice voit Noël');

-- Idées d'Alice
insert into ideas (id, owner_id, author_id, title, share_mode) values
  ('22222222-0000-0000-0000-000000000001', current_person_id(), current_person_id(), 'Vélo', 'all'),
  ('22222222-0000-0000-0000-000000000002', current_person_id(), current_person_id(), 'Montre', 'selected'),
  ('22222222-0000-0000-0000-000000000003', current_person_id(), current_person_id(), 'Console', 'all'),
  ('22222222-0000-0000-0000-000000000004', current_person_id(), current_person_id(), 'Thé', 'all'),
  ('22222222-0000-0000-0000-000000000005', current_person_id(), current_person_id(), 'Journal intime', 'private');
insert into idea_events (idea_id, event_id) values ('22222222-0000-0000-0000-000000000002', _id('noel'));
select _refused($$insert into ideas (owner_id, author_id, title, url) values (current_person_id(), current_person_id(), 'X', 'javascript:alert(1)')$$,
  'URL non http(s) refusée');

-- Bob rejoint Noël
select _as('bob');
select _refused($$select join_event('mauvais-jeton')$$, 'jeton inconnu refusé');
select join_event((select s from _t where k = 'noel_tok'));
select _ok((select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000001'), 'Bob voit le Vélo d''Alice');
select _ok((select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000005'), 'Bob ne voit pas l''idée privée d''Alice');

-- ===========================================================================
-- Recette 5 : une idée de juillet apparaît dans Noël dès l'adhésion
-- ===========================================================================
select _as('chloe');
insert into ideas (id, owner_id, author_id, title) values
  ('22222222-0000-0000-0000-000000000010', current_person_id(), current_person_id(), 'Livre de juillet');
select _as('bob');
select _ok((select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000010'),
  'R5 : avant l''adhésion de Chloé, Bob ne voit pas son idée');
select _as('chloe');
select join_event((select s from _t where k = 'noel_tok'));
select _as('bob');
select _ok((select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000010'),
  'R5 : après l''adhésion de Chloé à Noël, Bob voit son idée de juillet');

-- ===========================================================================
-- Recette 4 : une idée ouverte à Noël est invisible d'un événement sans rapport
-- ===========================================================================
select _as('david');
insert into _t (k, v) select 'repas', create_event('Repas entre amis', 'collective', current_date + 10, false, null, '{}');
insert into _t (k, s) select 'repas_tok', invite_token from events where id = _id('repas');
select _as('alice');
select join_event((select s from _t where k = 'repas_tok'));
select _as('david');
select _ok((select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000002'),
  'R4 : David ne voit pas la Montre (ouverte à Noël seulement)');
select _ok((select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000001'),
  'R4 : David voit le Vélo (ouvert à tous les événements d''Alice)');
select _ok((select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000010'),
  'R4 : David ne voit pas l''idée de Chloé (aucun événement commun)');
select _ok((select count(*) = 0 from persons where id = '11111111-0000-0000-0000-000000000003'),
  'R4 : David ne voit même pas le prénom de Chloé');
select _ok((select count(*) = 0 from events where id = _id('noel')), 'R4 : David ne voit pas Noël');

-- ===========================================================================
-- Recette 1 : le propriétaire ne lit ni idée secrète ni réservation
-- ===========================================================================
select _as('bob');
insert into ideas (id, owner_id, author_id, title, share_mode) values
  ('22222222-0000-0000-0000-000000000020', '11111111-0000-0000-0000-000000000001', current_person_id(), 'Parfum', 'selected');
insert into idea_events (idea_id, event_id) values ('22222222-0000-0000-0000-000000000020', _id('noel'));
select _ok((select is_secret from ideas where id = '22222222-0000-0000-0000-000000000020'), 'R1 : idée de Bob pour Alice marquée secrète');
select claim_idea('22222222-0000-0000-0000-000000000001', _id('noel'), false);   -- Bob offre le Vélo

select _as('alice');
select _ok((select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000020'),
  'R1 : Alice ne lit pas l''idée secrète');
select _ok((select count(*) = 0 from idea_events where idea_id = '22222222-0000-0000-0000-000000000020'),
  'R1 : Alice ne lit pas le partage de l''idée secrète');
select _ok((select count(*) = 0 from v_claims where owner_id = current_person_id()),
  'R1 : Alice ne voit aucune réservation sur ses idées');
select _refused($$select * from claims$$, 'R1 : lecture directe de claims');
select _refused($$select * from idea_groups$$, 'R1 : lecture directe de idea_groups');
select _ok((select count(*) = 0 from similar_ideas(current_person_id(), 'parfum')),
  'R1 : l''alerte de doublon ne trahit pas l''idée secrète');
select _refused($$update ideas set title = 'Piraté' where id = '22222222-0000-0000-0000-000000000020'$$,
  'R1 : Alice ne modifie pas l''idée secrète');

select _as('chloe');
select _ok((select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000020'),
  'R1 : Chloé voit l''idée secrète');
select _ok((select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000001'),
  'R1 : Chloé voit que Bob offre le Vélo');
select _ok((select count(*) = 1 from similar_ideas('11111111-0000-0000-0000-000000000001', 'parfum')),
  'Doublon : Chloé est avertie d''un titre proche');

select _as('david');
select _ok((select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000020'),
  'R4 : David ne voit pas l''idée secrète partagée à Noël');
select _ok((select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000001'),
  'David, qui voit le Vélo via le Repas, voit aussi qu''il est réservé');

-- ===========================================================================
-- Recette 6 : pas deux réservations sur une idée simple ; cadeau groupé OK
-- ===========================================================================
select _as('chloe');
select _refused($$select claim_idea('22222222-0000-0000-0000-000000000001', public._id('noel'), false)$$,
  'R6 : Chloé ne peut pas réserver le Vélo déjà réservé');
select _refused($$select open_group('22222222-0000-0000-0000-000000000001')$$,
  'R6 : Chloé ne transforme pas la réservation de Bob en cadeau groupé');
select open_group('22222222-0000-0000-0000-000000000003');                        -- Console
select claim_idea('22222222-0000-0000-0000-000000000003', _id('noel'), false);
select _as('bob');
select claim_idea('22222222-0000-0000-0000-000000000003', _id('noel'), true);     -- anonyme
select _ok((select count(*) = 2 from v_claims where idea_id = '22222222-0000-0000-0000-000000000003'),
  'R6 : deux participants au cadeau groupé');
select _ok((select bool_and(is_group) from v_claims where idea_id = '22222222-0000-0000-0000-000000000003'),
  'R6 : la Console est un cadeau groupé');
select _as('alice');
select _ok((select count(*) = 0 from v_groups where idea_id = '22222222-0000-0000-0000-000000000003'), 'R1 : Alice ne sait pas que la Console est un cadeau groupé');

-- ===========================================================================
-- Recette 2 : un réservant anonyme n'est identifiable que par lui-même et
-- par le gestionnaire. Recette 9 : le gestionnaire voit tout.
-- ===========================================================================
select _as('chloe');
select _ok((select count(*) = 1 from v_claims where idea_id = '22222222-0000-0000-0000-000000000003'
            and claimer_id is null and claimer_name is null),
  'R2 : Chloé ne voit pas qui est le participant anonyme');
select _as('bob');
select _ok((select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000003' and is_mine),
  'R2 : Bob se voit lui-même');

select _as('marie');
select join_event((select s from _t where k = 'noel_tok'));
select add_managed_member(_id('noel'), '11111111-0000-0000-0000-000000000007');
insert into ideas (id, owner_id, author_id, title) values
  ('22222222-0000-0000-0000-000000000030', '11111111-0000-0000-0000-000000000007', current_person_id(), 'Lego');
select _ok((select not is_secret from ideas where id = '22222222-0000-0000-0000-000000000030'),
  'R9 : une idée écrite par le gestionnaire n''est pas secrète');
select _as('bob');
insert into ideas (id, owner_id, author_id, title, share_mode) values
  ('22222222-0000-0000-0000-000000000031', '11111111-0000-0000-0000-000000000007', current_person_id(), 'Trottinette', 'selected');
insert into idea_events values ('22222222-0000-0000-0000-000000000031', _id('noel'));
select claim_idea('22222222-0000-0000-0000-000000000030', _id('noel'), true);     -- Bob offre le Lego, anonyme
select _as('chloe');
select _ok((select claimer_name is null from v_claims where idea_id = '22222222-0000-0000-0000-000000000030'),
  'R2 : Chloé ne sait pas qui offre le Lego');
select _as('marie');
select _ok((select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000031'),
  'R9 : Marie voit l''idée secrète ajoutée pour Léo');
select _ok((select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000030'),
  'R2/R9 : Marie voit que Bob offre le Lego, même anonyme');
update ideas set title = 'Trottinette rouge' where id = '22222222-0000-0000-0000-000000000031';
select _ok((select title = 'Trottinette rouge' from ideas where id = '22222222-0000-0000-0000-000000000031'),
  'R9 : Marie peut modifier une idée secrète de Léo');

-- ===========================================================================
-- Recette 7 : l'annulation de la réservation d'un autre est refusée
-- ===========================================================================
select _as('chloe');
select _refused($$select unclaim_idea('22222222-0000-0000-0000-000000000001')$$,
  'R7 : Chloé ne peut pas annuler la réservation de Bob');
select _refused($$delete from claims where idea_id = '22222222-0000-0000-0000-000000000001'$$,
  'R7 : suppression directe dans claims');
select _as('bob');
select _ok((select count(*) = 1 from v_claims where idea_id = '22222222-0000-0000-0000-000000000001' and is_mine),
  'R7 : la réservation de Bob existe toujours');
-- Bob peut annuler puis reprendre la sienne
select unclaim_idea('22222222-0000-0000-0000-000000000001');
select claim_idea('22222222-0000-0000-0000-000000000001', _id('noel'), false);

-- ===========================================================================
-- Recette 3 : le concerné d'une surprise ne voit rien
-- ===========================================================================
select _as('sam');
select join_event((select s from _t where k = 'noel_tok'));   -- Sam est connu de Bob via Noël
insert into ideas (id, owner_id, author_id, title) values
  ('22222222-0000-0000-0000-000000000040', current_person_id(), current_person_id(), 'Guitare');
select _as('bob');
select _refused($$select create_event('Surprise pour moi', 'person', current_date + 5, true, null,
  array['11111111-0000-0000-0000-000000000002'::uuid])$$, 'R3 : on n''organise pas sa propre surprise');
insert into _t (k, v) select 'surprise', create_event('Anniversaire surprise de Sam', 'person', current_date + 5, true, null,
  array['11111111-0000-0000-0000-000000000006'::uuid]);
insert into _t (k, s) select 'surprise_tok', invite_token from events where id = _id('surprise');
select _as('chloe');
select join_event((select s from _t where k = 'surprise_tok'));
select _ok((select count(*) = 1 from events where id = _id('surprise')), 'R3 : Chloé voit la surprise');
select _ok((select count(*) = 1 from event_honorees where event_id = _id('surprise')), 'R3 : Chloé voit le concerné');

select _as('sam');
select _ok((select count(*) = 0 from events where id = _id('surprise')), 'R3 : Sam ne voit pas l''événement');
select _ok((select count(*) = 0 from event_members where event_id = _id('surprise')), 'R3 : Sam ne voit pas ses participants');
select _ok((select count(*) = 0 from event_honorees where event_id = _id('surprise')), 'R3 : Sam ne se voit pas concerné');
select _refused($$select join_event((select s from public._t where k = 'surprise_tok'))$$, 'R3 : le lien est refusé à Sam');
select _as(null);
select _ok((select count(*) = 0 from event_members where event_id = _id('surprise')
            and person_id = '11111111-0000-0000-0000-000000000006'), 'R3 : Sam n''est pas entré');
select _as('bob');
-- un concerné déjà participant ne peut pas devenir le concerné d'une surprise
insert into _t (k, v) select 'surprise2', create_event('Autre surprise', 'person', current_date + 5, true, null, '{}');
insert into _t (k, s) select 'surprise2_tok', invite_token from events where id = _id('surprise2');
select _as('chloe');
select join_event((select s from _t where k = 'surprise2_tok'));
select _as('bob');
select _refused($$insert into event_honorees values (public._id('surprise2'), '11111111-0000-0000-0000-000000000003')$$,
  'R3 : un participant ne peut pas devenir concerné d''une surprise');

-- Réservation pour la surprise : Sam (propriétaire) n'en voit aucune trace,
-- même après la clôture il ne voit pas l'événement
select _as('chloe');
select claim_idea('22222222-0000-0000-0000-000000000040', _id('surprise'), false);
select _as('sam');
select _ok((select count(*) = 0 from v_claims where idea_id = '22222222-0000-0000-0000-000000000040'),
  'R3 : Sam ne voit pas la réservation de sa guitare');
select _as(null);
update events set closed_at = now() where id = _id('surprise');
select _as('sam');
select _ok((select count(*) = 1 and bool_and(event_id is null and event_title is null) from v_claims
            where idea_id = '22222222-0000-0000-0000-000000000040'),
  'R3 : après la fête, Sam voit sa guitare offerte, sans aucune trace de l''événement');

-- Choix « anniversaire » : dans un événement pour une personne, seules les
-- listes des concernés sont lisibles
select _as('bob');
insert into _t (k, v) select 'anniv', create_event('Anniversaire de Chloé', 'person', current_date + 20, false, null,
  array['11111111-0000-0000-0000-000000000003'::uuid]);
insert into _t (k, s) select 'anniv_tok', invite_token from events where id = _id('anniv');
select _as('david');
insert into ideas (id, owner_id, author_id, title) values
  ('22222222-0000-0000-0000-000000000050', current_person_id(), current_person_id(), 'Drone');
select join_event((select s from _t where k = 'anniv_tok'));
select _ok((select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000010'),
  'Anniversaire : David voit la liste de Chloé (concernée)');
select _as('bob');
select _ok((select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000050'),
  'Anniversaire : Bob ne voit pas la liste de David (simple donneur)');

-- ===========================================================================
-- Recette 8 : après clôture, « Offert par X » et plus de réservation
-- ===========================================================================
select _as('chloe');
select claim_idea('22222222-0000-0000-0000-000000000020', _id('noel'), false);    -- Chloé offre le Parfum secret
select _as('alice');
select _ok((select count(*) = 0 from v_claims where owner_id = current_person_id()),
  'R8 : avant clôture, Alice ne voit aucune réservation sur ses idées');
select _refused($$update events set closed_at = now() where id = public._id('repas')$$,
  'seul un organisateur clôture');

-- Clôture manuelle de Noël par Alice
update events set closed_at = now() where id = _id('noel');
select _ok((select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000001'),
  'R8 : Alice voit « Vélo offert par Bob »');
select _ok((select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000020'),
  'R8 : l''idée secrète offerte apparaît chez Alice');
select _ok((select claimer_name = 'Chloé' from v_claims where idea_id = '22222222-0000-0000-0000-000000000020'),
  'R8 : Alice voit « Parfum offert par Chloé »');
select _ok((select count(*) = 2 from v_claims where idea_id = '22222222-0000-0000-0000-000000000003'),
  'R8 : Alice voit les deux participants de la Console');
select _ok((select count(*) = 1 from v_claims where idea_id = '22222222-0000-0000-0000-000000000003' and claimer_name is null),
  'R8/R2 : le participant anonyme reste anonyme pour Alice');
select _refused($$update events set title = 'Noël modifié' where id = public._id('noel')$$,
  'R8 : un événement clôturé est en lecture seule');
select _refused($$update events set closed_at = null where id = public._id('noel')$$,
  'R8 : un événement clôturé ne se rouvre pas');
select _ok((select count(*) = 1 from events where id = _id('noel')), 'R8 : Noël reste consultable');

select _as('bob');
select _refused($$select unclaim_idea('22222222-0000-0000-0000-000000000001')$$,
  'R8 : plus d''annulation après clôture');
select _refused($$select claim_idea('22222222-0000-0000-0000-000000000010', public._id('noel'), false)$$,
  'R8 : plus de réservation après clôture');

-- Clôture automatique : la date du Repas entre amis est passée
select _as('david');
select claim_idea('22222222-0000-0000-0000-000000000004', _id('repas'), false);   -- David offre le Thé
select _as('alice');
select _ok((select count(*) = 0 from v_claims where idea_id = '22222222-0000-0000-0000-000000000004'),
  'R8 : avant la date, Alice ne voit pas que David offre le Thé');
select _as(null);
update events set event_date = current_date - 1 where id = _id('repas');
select _as('alice');
select _ok((select claimer_name = 'David' from v_claims where idea_id = '22222222-0000-0000-0000-000000000004'),
  'R8 : le lendemain de la date, Alice voit « Thé offert par David »');
select _as('david');
select _refused($$select unclaim_idea('22222222-0000-0000-0000-000000000004')$$,
  'R8 : plus d''annulation après la clôture automatique');

-- ===========================================================================
-- Divers : départ du dernier organisateur, suppression de compte
-- ===========================================================================
select _as('bob');
delete from event_members where event_id = _id('surprise') and person_id = current_person_id();
select _as('chloe');
select _ok((select is_event_organizer(_id('surprise'))), 'Chloé devient organisatrice quand Bob quitte');

select _as('marie');
select delete_my_account();
select _as(null);
select _ok((select count(*) = 0 from persons where id in ('11111111-0000-0000-0000-000000000005',
                                                          '11111111-0000-0000-0000-000000000007')),
  'Suppression : Marie et le profil de Léo sont supprimés');
select _ok((select count(*) = 0 from ideas where owner_id = '11111111-0000-0000-0000-000000000007'),
  'Suppression : les idées de Léo sont supprimées');
select _ok((select count(*) = 0 from auth.users where id = '00000000-0000-0000-0000-000000000005'),
  'Suppression : le compte de Marie est supprimé');

-- Recette 10 (e-mail de récupération) : elle se vérifie sur le site, car la
-- conversion d'un compte anonyme garde le même identifiant de compte, donc
-- toutes les lignes ci-dessus restent rattachées à la même personne.

select 'Toutes les recettes sont passées' as resultat;
rollback;
