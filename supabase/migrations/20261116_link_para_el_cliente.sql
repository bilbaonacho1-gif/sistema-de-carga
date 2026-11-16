-- LINK PARA EL CLIENTE: un proyecto se puede abrir, sólo para mirar, con un link público (sin usuario).
-- `sdc_view` es la única función que no pide sesión para leer un proyecto: devuelve el que tenga ese
-- código (14 letras al azar), y nada más. El dueño lo prende y lo apaga con `sdc_project_client`.
alter table sdc.projects add column view_code text unique;

create function public.sdc_project_client(p_token text, p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); code text; abc constant text := 'abcdefghjkmnpqrstuvwxyz23456789'; i int;
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role not in ('editor', 'admin') then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  if not exists (select 1 from sdc.projects where id = p_id and owner_id = u.id) then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  if not p_on then
    update sdc.projects set view_code = null where id = p_id;
    return jsonb_build_object('ok', true, 'view_code', null);
  end if;
  select view_code into code from sdc.projects where id = p_id;
  if code is null then
    loop
      code := '';
      for i in 1..14 loop code := code || substr(abc, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 31), 1); end loop;
      exit when not exists (select 1 from sdc.projects where view_code = code);
    end loop;
    update sdc.projects set view_code = code where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'view_code', code);
end $$;

create function public.sdc_view(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p sdc.projects; c text := lower(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if char_length(c) <> 14 then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  select * into p from sdc.projects where view_code = c;
  if p.id is null then return jsonb_build_object('ok', false, 'error', 'link'); end if;
  return jsonb_build_object('ok', true, 'project', jsonb_build_object('name', p.name, 'data', p.data, 'updated_at', p.updated_at));
end $$;

-- la lista de proyectos también dice si tiene link de cliente (se vuelve a crear sdc_projects con ese dato)
create or replace function public.sdc_projects(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'projects', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'share_code', p.share_code, 'view_code', p.view_code, 'created_at', p.created_at, 'updated_at', p.updated_at) order by p.updated_at desc)
    from sdc.projects p where p.owner_id = u.id), '[]'::jsonb));
end $$;

revoke all on function public.sdc_project_client(text, uuid, boolean) from public;
revoke all on function public.sdc_view(text) from public;
grant execute on function public.sdc_project_client(text, uuid, boolean) to anon, authenticated;
grant execute on function public.sdc_view(text) to anon, authenticated;
