-- USUARIOS, PERMISOS Y PROYECTOS del Sistema de depósitos.
--
-- Las tablas viven en el esquema privado `sdc` (no se publica por la API) y tienen RLS prendido
-- sin políticas: nadie las lee ni las escribe directo. Todo pasa por las funciones `public.sdc_*`,
-- que son la API: cada una recibe la ficha de la sesión (token), revisa quién es y qué puede hacer,
-- y recién entonces toca las tablas. El ingreso es propio (usuario y contraseña con hash bcrypt).

create extension if not exists pgcrypto with schema extensions;

create schema if not exists sdc;
revoke all on schema sdc from public, anon, authenticated;

create table sdc.users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  login_key text not null unique,            -- el usuario, en minúsculas y sin acentos
  name_key text not null,                    -- el nombre completo, igual: también sirve para entrar
  full_name text not null,
  pass_hash text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor', 'admin')),
  status text not null default 'pending' check (status in ('pending', 'active', 'blocked')),
  note text,                                 -- lo que escribió al pedir acceso
  must_change boolean not null default false, -- todavía usa la contraseña que le pusieron
  failed int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references sdc.users (id) on delete set null,
  last_login timestamptz
);
create index users_name_key on sdc.users (name_key);
create index users_approved_by on sdc.users (approved_by);

create table sdc.sessions (
  token_hash text primary key,
  user_id uuid not null references sdc.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sdc.sessions (user_id);

create table sdc.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references sdc.users (id) on delete cascade,
  name text not null,
  data jsonb not null,
  share_code text unique,                    -- con este código lo abre otro usuario
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index projects_owner on sdc.projects (owner_id, updated_at desc);

alter table sdc.users enable row level security;
alter table sdc.sessions enable row level security;
alter table sdc.projects enable row level security;

/* ------------------------------ Ayudas internas ------------------------------ */

-- minúsculas, sin acentos y con un solo espacio: para comparar usuarios y nombres
create function sdc.norm(t text) returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '\s+', ' ', 'g'))
$$;

create function sdc.hash_token(t text) returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(t, ''), 'UTF8')), 'hex')
$$;

-- quién es el dueño de esta sesión (sólo si está activo y la sesión no venció)
create function sdc.who(p_token text) returns sdc.users language sql stable set search_path = '' as $$
  select u.* from sdc.sessions s join sdc.users u on u.id = s.user_id
  where s.token_hash = sdc.hash_token(p_token) and s.expires_at > now() and u.status = 'active'
$$;

create function sdc.user_json(u sdc.users) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', u.id, 'username', u.username, 'full_name', u.full_name, 'role', u.role, 'must_change', u.must_change)
$$;

create function sdc.bad_password(p text) returns boolean language sql immutable set search_path = '' as $$
  select p is null or char_length(p) < 5 or char_length(p) > 72
$$;

-- siempre tiene que quedar al menos un administrador activo
create function sdc.need_admin() returns void language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from sdc.users where role = 'admin' and status = 'active') then
    raise exception 'Tiene que quedar al menos un administrador activo.' using errcode = 'P0001';
  end if;
end $$;

/* ------------------------------ Entrar y salir ------------------------------ */

create function public.sdc_login(p_user text, p_pass text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  k text := sdc.norm(p_user);
  u sdc.users;
  found_user sdc.users;
  t text;
begin
  if k = '' or p_pass is null or char_length(p_pass) > 72 then return jsonb_build_object('ok', false, 'error', 'credenciales'); end if;
  -- por usuario o por nombre completo
  for u in select * from sdc.users where login_key = k or name_key = k order by (login_key = k) desc loop
    if u.locked_until is not null and u.locked_until > now() then
      return jsonb_build_object('ok', false, 'error', 'espera', 'seconds', ceil(extract(epoch from u.locked_until - now())));
    end if;
    if u.pass_hash = extensions.crypt(p_pass, u.pass_hash) then found_user := u; exit; end if;
    -- contraseña equivocada: a los 5 intentos seguidos se frena 5 minutos
    update sdc.users set failed = case when failed + 1 >= 5 then 0 else failed + 1 end,
      locked_until = case when failed + 1 >= 5 then now() + interval '5 minutes' else locked_until end where id = u.id;
  end loop;
  if found_user.id is null then
    perform extensions.crypt(p_pass, extensions.gen_salt('bf', 10));   -- que tarde lo mismo exista o no el usuario
    return jsonb_build_object('ok', false, 'error', 'credenciales');
  end if;
  if found_user.status = 'pending' then return jsonb_build_object('ok', false, 'error', 'pendiente'); end if;
  if found_user.status = 'blocked' then return jsonb_build_object('ok', false, 'error', 'bloqueado'); end if;
  t := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into sdc.sessions (token_hash, user_id, expires_at) values (sdc.hash_token(t), found_user.id, now() + interval '30 days');
  delete from sdc.sessions where expires_at < now();
  update sdc.users set failed = 0, locked_until = null, last_login = now() where id = found_user.id;
  return jsonb_build_object('ok', true, 'token', t, 'user', sdc.user_json(found_user));
end $$;

create function public.sdc_me(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'user', sdc.user_json(u),
    -- al administrador le llega cuántos pedidos de acceso hay esperando
    'pending', case when u.role = 'admin' then (select count(*) from sdc.users where status = 'pending') else 0 end);
end $$;

create function public.sdc_logout(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from sdc.sessions where token_hash = sdc.hash_token(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- pedir acceso: queda esperando hasta que un administrador le dé (o no) un permiso
create function public.sdc_request_access(p_name text, p_user text, p_pass text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare k text := sdc.norm(p_user); nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(nm) < 3 or char_length(nm) > 60 then return jsonb_build_object('ok', false, 'error', 'nombre'); end if;
  if k !~ '^[a-z0-9][a-z0-9._ -]{2,29}$' then return jsonb_build_object('ok', false, 'error', 'usuario'); end if;
  if sdc.bad_password(p_pass) then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  if exists (select 1 from sdc.users where login_key = k) then return jsonb_build_object('ok', false, 'error', 'usuario_usado'); end if;
  if (select count(*) from sdc.users where status = 'pending') >= 50 then return jsonb_build_object('ok', false, 'error', 'muchos_pedidos'); end if;
  insert into sdc.users (username, login_key, name_key, full_name, pass_hash, role, status, note)
  values (btrim(p_user), k, sdc.norm(nm), nm, extensions.crypt(p_pass, extensions.gen_salt('bf', 10)), 'viewer', 'pending', nullif(left(btrim(coalesce(p_note, '')), 300), ''));
  return jsonb_build_object('ok', true);
end $$;

create function public.sdc_change_password(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if p_old is null or char_length(p_old) > 72 or u.pass_hash <> extensions.crypt(p_old, u.pass_hash) then return jsonb_build_object('ok', false, 'error', 'clave_actual'); end if;
  if sdc.bad_password(p_new) then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  if p_new = p_old then return jsonb_build_object('ok', false, 'error', 'clave_igual'); end if;
  update sdc.users set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), must_change = false where id = u.id;
  -- las otras sesiones abiertas de este usuario se cierran
  delete from sdc.sessions where user_id = u.id and token_hash <> sdc.hash_token(p_token);
  return jsonb_build_object('ok', true);
end $$;

/* ------------------------------ Administración ------------------------------ */

create function public.sdc_admin_users(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  return jsonb_build_object('ok', true, 'users', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', x.id, 'username', x.username, 'full_name', x.full_name, 'role', x.role, 'status', x.status, 'note', x.note,
      'created_at', x.created_at, 'last_login', x.last_login, 'must_change', x.must_change,
      'projects', (select count(*) from sdc.projects p where p.owner_id = x.id)
    ) order by (x.status = 'pending') desc, x.created_at)
    from sdc.users x), '[]'::jsonb));
end $$;

-- cambiar el permiso y/o el estado de un usuario (dar acceso = pasarlo a 'active' con su permiso)
create function public.sdc_admin_set(p_token text, p_id uuid, p_role text default null, p_status text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); t sdc.users;
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  if p_role is not null and p_role not in ('viewer', 'editor', 'admin') then return jsonb_build_object('ok', false, 'error', 'dato'); end if;
  if p_status is not null and p_status not in ('active', 'blocked') then return jsonb_build_object('ok', false, 'error', 'dato'); end if;
  select * into t from sdc.users where id = p_id;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  update sdc.users set role = coalesce(p_role, role), status = coalesce(p_status, status),
    approved_at = case when t.status = 'pending' and p_status = 'active' then now() else approved_at end,
    approved_by = case when t.status = 'pending' and p_status = 'active' then u.id else approved_by end
  where id = p_id;
  -- si se lo bloquea, se le cierran las sesiones
  if p_status = 'blocked' then delete from sdc.sessions where user_id = p_id; end if;
  perform sdc.need_admin();
  return jsonb_build_object('ok', true);
exception when sqlstate 'P0001' then return jsonb_build_object('ok', false, 'error', 'ultimo_admin');
end $$;

create function public.sdc_admin_delete(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  if p_id = u.id then return jsonb_build_object('ok', false, 'error', 'vos_mismo'); end if;
  delete from sdc.users where id = p_id;      -- se van también sus sesiones y sus proyectos
  perform sdc.need_admin();
  return jsonb_build_object('ok', true);
exception when sqlstate 'P0001' then return jsonb_build_object('ok', false, 'error', 'ultimo_admin');
end $$;

-- ponerle una contraseña nueva a alguien (la tiene que cambiar al entrar)
create function public.sdc_admin_password(p_token text, p_id uuid, p_new text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  if sdc.bad_password(p_new) then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  update sdc.users set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), must_change = true, failed = 0, locked_until = null where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  delete from sdc.sessions where user_id = p_id and token_hash <> sdc.hash_token(p_token);
  return jsonb_build_object('ok', true);
end $$;

-- crear un usuario ya con acceso (sin que lo pida)
create function public.sdc_admin_create(p_token text, p_name text, p_user text, p_pass text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); k text := sdc.norm(p_user); nm text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role <> 'admin' then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  if char_length(nm) < 3 or char_length(nm) > 60 then return jsonb_build_object('ok', false, 'error', 'nombre'); end if;
  if k !~ '^[a-z0-9][a-z0-9._ -]{2,29}$' then return jsonb_build_object('ok', false, 'error', 'usuario'); end if;
  if sdc.bad_password(p_pass) then return jsonb_build_object('ok', false, 'error', 'clave'); end if;
  if p_role not in ('viewer', 'editor', 'admin') then return jsonb_build_object('ok', false, 'error', 'dato'); end if;
  if exists (select 1 from sdc.users where login_key = k) then return jsonb_build_object('ok', false, 'error', 'usuario_usado'); end if;
  insert into sdc.users (username, login_key, name_key, full_name, pass_hash, role, status, must_change, approved_at, approved_by)
  values (btrim(p_user), k, sdc.norm(nm), nm, extensions.crypt(p_pass, extensions.gen_salt('bf', 10)), p_role, 'active', true, now(), u.id);
  return jsonb_build_object('ok', true);
end $$;

/* ------------------------------ Proyectos (de cada usuario) ------------------------------ */

create function public.sdc_projects(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'projects', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'share_code', p.share_code, 'created_at', p.created_at, 'updated_at', p.updated_at) order by p.updated_at desc)
    from sdc.projects p where p.owner_id = u.id), '[]'::jsonb));
end $$;

create function public.sdc_project_get(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); p sdc.projects;
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  select * into p from sdc.projects where id = p_id and owner_id = u.id;
  if p.id is null then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  return jsonb_build_object('ok', true, 'project', jsonb_build_object('id', p.id, 'name', p.name, 'data', p.data, 'share_code', p.share_code, 'updated_at', p.updated_at));
end $$;

-- guardar: sin id crea uno nuevo; con id pisa el propio. Hace falta permiso para editar.
create function public.sdc_project_save(p_token text, p_id uuid, p_name text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80); pid uuid; ts timestamptz := now();
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role not in ('editor', 'admin') then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 4000000 then return jsonb_build_object('ok', false, 'error', 'dato'); end if;
  if p_id is null then
    if nm = '' then return jsonb_build_object('ok', false, 'error', 'nombre'); end if;
    if (select count(*) from sdc.projects where owner_id = u.id) >= 300 then return jsonb_build_object('ok', false, 'error', 'muchos'); end if;
    insert into sdc.projects (owner_id, name, data) values (u.id, nm, p_data) returning id into pid;
  else
    update sdc.projects set data = p_data, name = case when nm = '' then name else nm end, updated_at = ts where id = p_id and owner_id = u.id returning id into pid;
    if pid is null then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  end if;
  return jsonb_build_object('ok', true, 'id', pid, 'updated_at', ts);
end $$;

create function public.sdc_project_rename(p_token text, p_id uuid, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role not in ('editor', 'admin') then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  if nm = '' then return jsonb_build_object('ok', false, 'error', 'nombre'); end if;
  update sdc.projects set name = nm where id = p_id and owner_id = u.id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  return jsonb_build_object('ok', true);
end $$;

create function public.sdc_project_delete(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  delete from sdc.projects where id = p_id and owner_id = u.id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- compartir: genera un código (o lo saca). Con el código, otro usuario lo abre.
create function public.sdc_project_share(p_token text, p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); code text; abc constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if not exists (select 1 from sdc.projects where id = p_id and owner_id = u.id) then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  if not p_on then
    update sdc.projects set share_code = null where id = p_id;
    return jsonb_build_object('ok', true, 'share_code', null);
  end if;
  select share_code into code from sdc.projects where id = p_id;
  if code is null then
    loop
      code := '';
      for i in 1..8 loop code := code || substr(abc, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1); end loop;
      exit when not exists (select 1 from sdc.projects where share_code = code);
    end loop;
    update sdc.projects set share_code = code where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'share_code', code);
end $$;

-- abrir un proyecto compartido con su código (cualquier usuario con acceso)
create function public.sdc_project_shared(p_token text, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); p sdc.projects; c text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if char_length(c) <> 8 then return jsonb_build_object('ok', false, 'error', 'codigo'); end if;
  select * into p from sdc.projects where share_code = c;
  if p.id is null then return jsonb_build_object('ok', false, 'error', 'codigo'); end if;
  return jsonb_build_object('ok', true, 'project', jsonb_build_object('name', p.name, 'data', p.data, 'updated_at', p.updated_at,
    'owner', (select full_name from sdc.users where id = p.owner_id), 'mine', p.owner_id = u.id, 'id', case when p.owner_id = u.id then p.id end));
end $$;

-- para que el servidor no se duerma por falta de uso
create function public.sdc_ping() returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('ok', (select count(*) >= 0 from sdc.users))
$$;

/* ------------------------------ Quién puede llamar qué ------------------------------ */

-- las ayudas internas no se llaman desde afuera
revoke all on all functions in schema sdc from public, anon, authenticated;
-- la API: se llama sin sesión de Supabase (cada función revisa la ficha propia)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'sdc\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
end $$;
