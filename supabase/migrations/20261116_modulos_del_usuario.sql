/*
 * MÓDULOS GUARDADOS DE CADA USUARIO. Un módulo (A, B, C…) vive dentro de su proyecto; con esto,
 * además, se puede guardar en la cuenta para usarlo en cualquier otro proyecto. Igual que el resto:
 * la tabla no se toca desde afuera, sólo por estas funciones, que revisan la sesión.
 */
create table sdc.modules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references sdc.users (id) on delete cascade,
  name text not null,
  name_key text not null,                    -- el nombre en minúsculas: guardar con el mismo nombre lo pisa
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name_key)
);
alter table sdc.modules enable row level security;

create function public.sdc_modules(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  return jsonb_build_object('ok', true, 'modules', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'data', m.data, 'updated_at', m.updated_at) order by m.name_key)
    from sdc.modules m where m.owner_id = u.id), '[]'::jsonb));
end $$;

-- guardar: si ya hay uno con ese nombre, lo pisa. Hace falta permiso para editar.
create function public.sdc_module_save(p_token text, p_name text, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token); nm text := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40); mid uuid;
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  if u.role not in ('editor', 'admin') then return jsonb_build_object('ok', false, 'error', 'permiso'); end if;
  if nm = '' then return jsonb_build_object('ok', false, 'error', 'nombre_modulo'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' or pg_column_size(p_data) > 400000 then return jsonb_build_object('ok', false, 'error', 'dato'); end if;
  if not exists (select 1 from sdc.modules where owner_id = u.id and name_key = lower(nm))
    and (select count(*) from sdc.modules where owner_id = u.id) >= 100 then return jsonb_build_object('ok', false, 'error', 'muchos_modulos'); end if;
  insert into sdc.modules (owner_id, name, name_key, data) values (u.id, nm, lower(nm), p_data)
  on conflict (owner_id, name_key) do update set name = excluded.name, data = excluded.data, updated_at = now()
  returning id into mid;
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

create function public.sdc_module_delete(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u sdc.users := sdc.who(p_token);
begin
  if u.id is null then return jsonb_build_object('ok', false, 'error', 'sesion'); end if;
  delete from sdc.modules where id = p_id and owner_id = u.id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.sdc_modules(text) from public;
revoke all on function public.sdc_module_save(text, text, jsonb) from public;
revoke all on function public.sdc_module_delete(text, uuid) from public;
grant execute on function public.sdc_modules(text) to anon, authenticated;
grant execute on function public.sdc_module_save(text, text, jsonb) to anon, authenticated;
grant execute on function public.sdc_module_delete(text, uuid) to anon, authenticated;
