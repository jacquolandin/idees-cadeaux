-- =============================================================================
--  Idées Cadeaux — recettes SQL (tests de sécurité)
--
--  À exécuter dans Supabase > SQL Editor APRÈS schema.sql.
--  Tout se passe dans un seul bloc, annulé à la fin : aucune donnée de test
--  ne reste dans la base, et aucun objet n'est créé.
--
--  Résultat attendu : la dernière ligne affiche « Toutes les recettes sont
--  passées ». Une erreur « ÉCHEC : ... » indique la règle qui ne tient pas.
--
--  Personnages : Alice, Bob, Chloé, David, Marie (gère le profil de Léo, sans
--  compte) et Sam (concerné d'un anniversaire surprise).
--  Chaque requête est jouée « en tant que » l'un d'eux, avec le rôle
--  authenticated, exactement comme le ferait le site.
-- =============================================================================

do $recettes$
declare
  ids jsonb := '{}';   -- identifiants et jetons créés pendant les tests
  ok  boolean;
  n   integer;
begin
  begin
    -- ---------------------------------------------------------------------------
    -- Comptes
    -- ---------------------------------------------------------------------------
    insert into auth.users (id) values
      ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'),
      ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004'),
      ('00000000-0000-0000-0000-000000000005'), ('00000000-0000-0000-0000-000000000006');
    -- Chacun crée sa personne (comme l'écran « Comment tu t'appelles ? »)
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- alice
    insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000001', auth.uid(), 'Alice');
    begin
      execute $q$insert into persons (user_id, first_name) values ('00000000-0000-0000-0000-000000000002', 'Faux Bob')$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'créer une personne pour le compte de quelqu''un d''autre';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000002', auth.uid(), 'Bob');
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000003', auth.uid(), 'Chloé');
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- david
    insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000004', auth.uid(), 'David');
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- marie
    insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000005', auth.uid(), 'Marie');
    insert into persons (id, managed_by, first_name) values ('11111111-0000-0000-0000-000000000007', current_person_id(), 'Léo');
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- sam
    insert into persons (id, user_id, first_name) values ('11111111-0000-0000-0000-000000000006', auth.uid(), 'Sam');
    -- Alice crée Noël (échange collectif, dans 30 jours)
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- alice
    ids := ids || jsonb_build_object('noel', create_event('Noël', 'collective', current_date + 30, false, null, '{}'));
    ids := ids || jsonb_build_object('noel_tok', (select invite_token from events where id = (ids->>'noel')::uuid));
    assert (select count(*) = 1 from events where id = (ids->>'noel')::uuid),
      'ÉCHEC : ' || 'Alice voit Noël';
    -- Idées d'Alice
    insert into ideas (id, owner_id, author_id, title, share_mode) values
      ('22222222-0000-0000-0000-000000000001', current_person_id(), current_person_id(), 'Vélo', 'all'),
      ('22222222-0000-0000-0000-000000000002', current_person_id(), current_person_id(), 'Montre', 'selected'),
      ('22222222-0000-0000-0000-000000000003', current_person_id(), current_person_id(), 'Console', 'all'),
      ('22222222-0000-0000-0000-000000000004', current_person_id(), current_person_id(), 'Thé', 'all'),
      ('22222222-0000-0000-0000-000000000005', current_person_id(), current_person_id(), 'Journal intime', 'private');
    insert into idea_events (idea_id, event_id) values ('22222222-0000-0000-0000-000000000002', (ids->>'noel')::uuid);
    begin
      execute $q$insert into ideas (owner_id, author_id, title, url) values (current_person_id(), current_person_id(), 'X', 'javascript:alert(1)')$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'URL non http(s) refusée';
    -- Bob rejoint Noël
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    begin
      execute $q$select join_event('mauvais-jeton')$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'jeton inconnu refusé';
    perform join_event((ids->>'noel_tok'));
    assert (select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000001'),
      'ÉCHEC : ' || 'Bob voit le Vélo d''Alice';
    assert (select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000005'),
      'ÉCHEC : ' || 'Bob ne voit pas l''idée privée d''Alice';
    -- ===========================================================================
    -- Recette 5 : une idée de juillet apparaît dans Noël dès l'adhésion
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    insert into ideas (id, owner_id, author_id, title) values
      ('22222222-0000-0000-0000-000000000010', current_person_id(), current_person_id(), 'Livre de juillet');
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    assert (select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000010'),
      'ÉCHEC : ' || 'R5 : avant l''adhésion de Chloé, Bob ne voit pas son idée';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    perform join_event((ids->>'noel_tok'));
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    assert (select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000010'),
      'ÉCHEC : ' || 'R5 : après l''adhésion de Chloé à Noël, Bob voit son idée de juillet';
    -- ===========================================================================
    -- Recette 4 : une idée ouverte à Noël est invisible d'un événement sans rapport
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- david
    ids := ids || jsonb_build_object('repas', create_event('Repas entre amis', 'collective', current_date + 10, false, null, '{}'));
    ids := ids || jsonb_build_object('repas_tok', (select invite_token from events where id = (ids->>'repas')::uuid));
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- alice
    perform join_event((ids->>'repas_tok'));
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- david
    assert (select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000002'),
      'ÉCHEC : ' || 'R4 : David ne voit pas la Montre (ouverte à Noël seulement)';
    assert (select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000001'),
      'ÉCHEC : ' || 'R4 : David voit le Vélo (ouvert à tous les événements d''Alice)';
    assert (select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000010'),
      'ÉCHEC : ' || 'R4 : David ne voit pas l''idée de Chloé (aucun événement commun)';
    assert (select count(*) = 0 from persons where id = '11111111-0000-0000-0000-000000000003'),
      'ÉCHEC : ' || 'R4 : David ne voit même pas le prénom de Chloé';
    assert (select count(*) = 0 from events where id = (ids->>'noel')::uuid),
      'ÉCHEC : ' || 'R4 : David ne voit pas Noël';
    -- ===========================================================================
    -- Recette 1 : le propriétaire ne lit ni idée secrète ni réservation
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    insert into ideas (id, owner_id, author_id, title, share_mode) values
      ('22222222-0000-0000-0000-000000000020', '11111111-0000-0000-0000-000000000001', current_person_id(), 'Parfum', 'selected');
    insert into idea_events (idea_id, event_id) values ('22222222-0000-0000-0000-000000000020', (ids->>'noel')::uuid);
    assert (select is_secret from ideas where id = '22222222-0000-0000-0000-000000000020'),
      'ÉCHEC : ' || 'R1 : idée de Bob pour Alice marquée secrète';
    perform claim_idea('22222222-0000-0000-0000-000000000001', (ids->>'noel')::uuid, false);
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- alice
    assert (select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000020'),
      'ÉCHEC : ' || 'R1 : Alice ne lit pas l''idée secrète';
    assert (select count(*) = 0 from idea_events where idea_id = '22222222-0000-0000-0000-000000000020'),
      'ÉCHEC : ' || 'R1 : Alice ne lit pas le partage de l''idée secrète';
    assert (select count(*) = 0 from v_claims where owner_id = current_person_id()),
      'ÉCHEC : ' || 'R1 : Alice ne voit aucune réservation sur ses idées';
    begin
      execute $q$select * from claims$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R1 : lecture directe de claims';
    begin
      execute $q$select * from idea_groups$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R1 : lecture directe de idea_groups';
    assert (select count(*) = 0 from similar_ideas(current_person_id(), 'parfum')),
      'ÉCHEC : ' || 'R1 : l''alerte de doublon ne trahit pas l''idée secrète';
    begin
      execute $q$update ideas set title = 'Piraté' where id = '22222222-0000-0000-0000-000000000020'$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R1 : Alice ne modifie pas l''idée secrète';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    assert (select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000020'),
      'ÉCHEC : ' || 'R1 : Chloé voit l''idée secrète';
    assert (select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000001'),
      'ÉCHEC : ' || 'R1 : Chloé voit que Bob offre le Vélo';
    assert (select count(*) = 1 from similar_ideas('11111111-0000-0000-0000-000000000001', 'parfum')),
      'ÉCHEC : ' || 'Doublon : Chloé est avertie d''un titre proche';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- david
    assert (select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000020'),
      'ÉCHEC : ' || 'R4 : David ne voit pas l''idée secrète partagée à Noël';
    assert (select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000001'),
      'ÉCHEC : ' || 'David, qui voit le Vélo via le Repas, voit aussi qu''il est réservé';
    -- ===========================================================================
    -- Recette 6 : pas deux réservations sur une idée simple ; cadeau groupé OK
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    begin
      execute replace($q$select claim_idea('22222222-0000-0000-0000-000000000001', '{noel}'::uuid, false)$q$, '{noel}', ids->>'noel');
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R6 : Chloé ne peut pas réserver le Vélo déjà réservé';
    begin
      execute $q$select open_group('22222222-0000-0000-0000-000000000001')$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R6 : Chloé ne transforme pas la réservation de Bob en cadeau groupé';
    perform open_group('22222222-0000-0000-0000-000000000003');
    perform claim_idea('22222222-0000-0000-0000-000000000003', (ids->>'noel')::uuid, false);
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    perform claim_idea('22222222-0000-0000-0000-000000000003', (ids->>'noel')::uuid, true);
    assert (select count(*) = 2 from v_claims where idea_id = '22222222-0000-0000-0000-000000000003'),
      'ÉCHEC : ' || 'R6 : deux participants au cadeau groupé';
    assert (select bool_and(is_group) from v_claims where idea_id = '22222222-0000-0000-0000-000000000003'),
      'ÉCHEC : ' || 'R6 : la Console est un cadeau groupé';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- alice
    assert (select count(*) = 0 from v_groups where idea_id = '22222222-0000-0000-0000-000000000003'),
      'ÉCHEC : ' || 'R1 : Alice ne sait pas que la Console est un cadeau groupé';
    -- ===========================================================================
    -- Recette 2 : un réservant anonyme n'est identifiable que par lui-même et
    -- par le gestionnaire. Recette 9 : le gestionnaire voit tout.
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    assert (select count(*) = 1 from v_claims where idea_id = '22222222-0000-0000-0000-000000000003'
                and claimer_id is null and claimer_name is null),
      'ÉCHEC : ' || 'R2 : Chloé ne voit pas qui est le participant anonyme';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    assert (select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000003' and is_mine),
      'ÉCHEC : ' || 'R2 : Bob se voit lui-même';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- marie
    perform join_event((ids->>'noel_tok'));
    perform add_managed_member((ids->>'noel')::uuid, '11111111-0000-0000-0000-000000000007');
    insert into ideas (id, owner_id, author_id, title) values
      ('22222222-0000-0000-0000-000000000030', '11111111-0000-0000-0000-000000000007', current_person_id(), 'Lego');
    assert (select not is_secret from ideas where id = '22222222-0000-0000-0000-000000000030'),
      'ÉCHEC : ' || 'R9 : une idée écrite par le gestionnaire n''est pas secrète';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    insert into ideas (id, owner_id, author_id, title, share_mode) values
      ('22222222-0000-0000-0000-000000000031', '11111111-0000-0000-0000-000000000007', current_person_id(), 'Trottinette', 'selected');
    insert into idea_events values ('22222222-0000-0000-0000-000000000031', (ids->>'noel')::uuid);
    perform claim_idea('22222222-0000-0000-0000-000000000030', (ids->>'noel')::uuid, true);
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    assert (select claimer_name is null from v_claims where idea_id = '22222222-0000-0000-0000-000000000030'),
      'ÉCHEC : ' || 'R2 : Chloé ne sait pas qui offre le Lego';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- marie
    assert (select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000031'),
      'ÉCHEC : ' || 'R9 : Marie voit l''idée secrète ajoutée pour Léo';
    assert (select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000030'),
      'ÉCHEC : ' || 'R2/R9 : Marie voit que Bob offre le Lego, même anonyme';
    update ideas set title = 'Trottinette rouge' where id = '22222222-0000-0000-0000-000000000031';
    assert (select title = 'Trottinette rouge' from ideas where id = '22222222-0000-0000-0000-000000000031'),
      'ÉCHEC : ' || 'R9 : Marie peut modifier une idée secrète de Léo';
    -- ===========================================================================
    -- Recette 7 : l'annulation de la réservation d'un autre est refusée
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    begin
      execute $q$select unclaim_idea('22222222-0000-0000-0000-000000000001')$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R7 : Chloé ne peut pas annuler la réservation de Bob';
    begin
      execute $q$delete from claims where idea_id = '22222222-0000-0000-0000-000000000001'$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R7 : suppression directe dans claims';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    assert (select count(*) = 1 from v_claims where idea_id = '22222222-0000-0000-0000-000000000001' and is_mine),
      'ÉCHEC : ' || 'R7 : la réservation de Bob existe toujours';
    -- Bob peut annuler puis reprendre la sienne
    perform unclaim_idea('22222222-0000-0000-0000-000000000001');
    perform claim_idea('22222222-0000-0000-0000-000000000001', (ids->>'noel')::uuid, false);
    -- ===========================================================================
    -- Recette 3 : le concerné d'une surprise ne voit rien
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- sam
    perform join_event((ids->>'noel_tok'));
    insert into ideas (id, owner_id, author_id, title) values
      ('22222222-0000-0000-0000-000000000040', current_person_id(), current_person_id(), 'Guitare');
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    begin
      execute $q$select create_event('Surprise pour moi', 'person', current_date + 5, true, null,
      array['11111111-0000-0000-0000-000000000002'::uuid])$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R3 : on n''organise pas sa propre surprise';
    ids := ids || jsonb_build_object('surprise', create_event('Anniversaire surprise de Sam', 'person', current_date + 5, true, null,
      array['11111111-0000-0000-0000-000000000006'::uuid]));
    ids := ids || jsonb_build_object('surprise_tok', (select invite_token from events where id = (ids->>'surprise')::uuid));
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    perform join_event((ids->>'surprise_tok'));
    assert (select count(*) = 1 from events where id = (ids->>'surprise')::uuid),
      'ÉCHEC : ' || 'R3 : Chloé voit la surprise';
    assert (select count(*) = 1 from event_honorees where event_id = (ids->>'surprise')::uuid),
      'ÉCHEC : ' || 'R3 : Chloé voit le concerné';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- sam
    assert (select count(*) = 0 from events where id = (ids->>'surprise')::uuid),
      'ÉCHEC : ' || 'R3 : Sam ne voit pas l''événement';
    assert (select count(*) = 0 from event_members where event_id = (ids->>'surprise')::uuid),
      'ÉCHEC : ' || 'R3 : Sam ne voit pas ses participants';
    assert (select count(*) = 0 from event_honorees where event_id = (ids->>'surprise')::uuid),
      'ÉCHEC : ' || 'R3 : Sam ne se voit pas concerné';
    begin
      execute replace($q$select join_event('{surprise_tok}')$q$, '{surprise_tok}', ids->>'surprise_tok');
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R3 : le lien est refusé à Sam';
    perform set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);  -- administrateur
    assert (select count(*) = 0 from event_members where event_id = (ids->>'surprise')::uuid
                and person_id = '11111111-0000-0000-0000-000000000006'),
      'ÉCHEC : ' || 'R3 : Sam n''est pas entré';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    -- un concerné déjà participant ne peut pas devenir le concerné d'une surprise
    ids := ids || jsonb_build_object('surprise2', create_event('Autre surprise', 'person', current_date + 5, true, null, '{}'));
    ids := ids || jsonb_build_object('surprise2_tok', (select invite_token from events where id = (ids->>'surprise2')::uuid));
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    perform join_event((ids->>'surprise2_tok'));
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    begin
      execute replace($q$insert into event_honorees values ('{surprise2}'::uuid, '11111111-0000-0000-0000-000000000003')$q$, '{surprise2}', ids->>'surprise2');
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R3 : un participant ne peut pas devenir concerné d''une surprise';
    -- Réservation pour la surprise : Sam (propriétaire) n'en voit aucune trace,
    -- même après la clôture il ne voit pas l'événement
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    perform claim_idea('22222222-0000-0000-0000-000000000040', (ids->>'surprise')::uuid, false);
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- sam
    assert (select count(*) = 0 from v_claims where idea_id = '22222222-0000-0000-0000-000000000040'),
      'ÉCHEC : ' || 'R3 : Sam ne voit pas la réservation de sa guitare';
    perform set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);  -- administrateur
    update events set closed_at = now() where id = (ids->>'surprise')::uuid;
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000006","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- sam
    assert (select count(*) = 1 and bool_and(event_id is null and event_title is null) from v_claims
                where idea_id = '22222222-0000-0000-0000-000000000040'),
      'ÉCHEC : ' || 'R3 : après la fête, Sam voit sa guitare offerte, sans aucune trace de l''événement';
    -- Choix « anniversaire » : dans un événement pour une personne, seules les
    -- listes des concernés sont lisibles
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    ids := ids || jsonb_build_object('anniv', create_event('Anniversaire de Chloé', 'person', current_date + 20, false, null,
      array['11111111-0000-0000-0000-000000000003'::uuid]));
    ids := ids || jsonb_build_object('anniv_tok', (select invite_token from events where id = (ids->>'anniv')::uuid));
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- david
    insert into ideas (id, owner_id, author_id, title) values
      ('22222222-0000-0000-0000-000000000050', current_person_id(), current_person_id(), 'Drone');
    perform join_event((ids->>'anniv_tok'));
    assert (select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000010'),
      'ÉCHEC : ' || 'Anniversaire : David voit la liste de Chloé (concernée)';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    assert (select count(*) = 0 from ideas where id = '22222222-0000-0000-0000-000000000050'),
      'ÉCHEC : ' || 'Anniversaire : Bob ne voit pas la liste de David (simple donneur)';
    -- ===========================================================================
    -- Recette 8 : après clôture, « Offert par X » et plus de réservation
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    perform claim_idea('22222222-0000-0000-0000-000000000020', (ids->>'noel')::uuid, false);
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- alice
    assert (select count(*) = 0 from v_claims where owner_id = current_person_id()),
      'ÉCHEC : ' || 'R8 : avant clôture, Alice ne voit aucune réservation sur ses idées';
    begin
      execute replace($q$update events set closed_at = now() where id = '{repas}'::uuid$q$, '{repas}', ids->>'repas');
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'seul un organisateur clôture';
    -- Clôture manuelle de Noël par Alice
    update events set closed_at = now() where id = (ids->>'noel')::uuid;
    assert (select claimer_name = 'Bob' from v_claims where idea_id = '22222222-0000-0000-0000-000000000001'),
      'ÉCHEC : ' || 'R8 : Alice voit « Vélo offert par Bob »';
    assert (select count(*) = 1 from ideas where id = '22222222-0000-0000-0000-000000000020'),
      'ÉCHEC : ' || 'R8 : l''idée secrète offerte apparaît chez Alice';
    assert (select claimer_name = 'Chloé' from v_claims where idea_id = '22222222-0000-0000-0000-000000000020'),
      'ÉCHEC : ' || 'R8 : Alice voit « Parfum offert par Chloé »';
    assert (select count(*) = 2 from v_claims where idea_id = '22222222-0000-0000-0000-000000000003'),
      'ÉCHEC : ' || 'R8 : Alice voit les deux participants de la Console';
    assert (select count(*) = 1 from v_claims where idea_id = '22222222-0000-0000-0000-000000000003' and claimer_name is null),
      'ÉCHEC : ' || 'R8/R2 : le participant anonyme reste anonyme pour Alice';
    begin
      execute replace($q$update events set title = 'Noël modifié' where id = '{noel}'::uuid$q$, '{noel}', ids->>'noel');
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R8 : un événement clôturé est en lecture seule';
    begin
      execute replace($q$update events set closed_at = null where id = '{noel}'::uuid$q$, '{noel}', ids->>'noel');
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R8 : un événement clôturé ne se rouvre pas';
    assert (select count(*) = 1 from events where id = (ids->>'noel')::uuid),
      'ÉCHEC : ' || 'R8 : Noël reste consultable';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    begin
      execute $q$select unclaim_idea('22222222-0000-0000-0000-000000000001')$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R8 : plus d''annulation après clôture';
    begin
      execute replace($q$select claim_idea('22222222-0000-0000-0000-000000000010', '{noel}'::uuid, false)$q$, '{noel}', ids->>'noel');
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R8 : plus de réservation après clôture';
    -- Clôture automatique : la date du Repas entre amis est passée
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- david
    perform claim_idea('22222222-0000-0000-0000-000000000004', (ids->>'repas')::uuid, false);
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- alice
    assert (select count(*) = 0 from v_claims where idea_id = '22222222-0000-0000-0000-000000000004'),
      'ÉCHEC : ' || 'R8 : avant la date, Alice ne voit pas que David offre le Thé';
    perform set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);  -- administrateur
    update events set event_date = current_date - 1 where id = (ids->>'repas')::uuid;
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- alice
    assert (select claimer_name = 'David' from v_claims where idea_id = '22222222-0000-0000-0000-000000000004'),
      'ÉCHEC : ' || 'R8 : le lendemain de la date, Alice voit « Thé offert par David »';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- david
    begin
      execute $q$select unclaim_idea('22222222-0000-0000-0000-000000000004')$q$;
      get diagnostics n = row_count; ok := n = 0;
    exception when others then ok := true;
    end;
    assert ok, 'ÉCHEC (accepté à tort) : ' || 'R8 : plus d''annulation après la clôture automatique';
    -- ===========================================================================
    -- Divers : départ du dernier organisateur, suppression de compte
    -- ===========================================================================
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- bob
    delete from event_members where event_id = (ids->>'surprise')::uuid and person_id = current_person_id();
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- chloe
    assert (select is_event_organizer((ids->>'surprise')::uuid)),
      'ÉCHEC : ' || 'Chloé devient organisatrice quand Bob quitte';
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true), set_config('role', 'authenticated', true);  -- marie
    perform delete_my_account();
    perform set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);  -- administrateur
    assert (select count(*) = 0 from persons where id in ('11111111-0000-0000-0000-000000000005',
                                                              '11111111-0000-0000-0000-000000000007')),
      'ÉCHEC : ' || 'Suppression : Marie et le profil de Léo sont supprimés';
    assert (select count(*) = 0 from ideas where owner_id = '11111111-0000-0000-0000-000000000007'),
      'ÉCHEC : ' || 'Suppression : les idées de Léo sont supprimées';
    assert (select count(*) = 0 from auth.users where id = '00000000-0000-0000-0000-000000000005'),
      'ÉCHEC : ' || 'Suppression : le compte de Marie est supprimé';
    -- Recette 10 (e-mail de récupération) : elle se vérifie sur le site, car la
    -- conversion d'un compte anonyme garde le même identifiant de compte, donc
    -- toutes les lignes ci-dessus restent rattachées à la même personne.

    -- Tout a réussi : on annule volontairement les données de test
    raise exception 'fin des recettes' using errcode = 'TSTOK';
  exception when sqlstate 'TSTOK' then
    null;
  end;
end
$recettes$;

select 'Toutes les recettes sont passées' as resultat;

