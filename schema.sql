-- UsadoGamer — esquema inicial de base de datos
-- Ejecutar esto una sola vez en Supabase: panel izquierdo -> SQL Editor -> New query -> pegar todo -> Run

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  category text not null check (category in ('teclados','mouse','auriculares','monitores')),
  title text not null,
  description text,
  price numeric not null check (price > 0),
  condition text not null,
  works_ok boolean default false,
  has_box boolean default false,
  has_warranty boolean default false,
  was_repaired boolean default false,
  created_at timestamptz not null default now()
);

-- Row Level Security: nadie puede tocar la tabla salvo por estas reglas explícitas
alter table public.products enable row level security;

-- Cualquiera (incluso sin sesión) puede ver los productos publicados
create policy "Los productos son públicos para leer"
  on public.products for select
  using (true);

-- Solo un usuario logueado puede publicar, y solo a su propio nombre
create policy "Los usuarios publican sus propios productos"
  on public.products for insert
  with check (auth.uid() = user_id);

-- Solo el dueño puede editar o borrar su propia publicación
create policy "Los usuarios editan sus propios productos"
  on public.products for update
  using (auth.uid() = user_id);

create policy "Los usuarios borran sus propios productos"
  on public.products for delete
  using (auth.uid() = user_id);

-- Columna para guardar el link de la foto subida a Storage
alter table public.products add column if not exists photo_url text;

-- Columna para el detalle de la reparación, cuando corresponde
alter table public.products add column if not exists repair_detail text;

-- Columna para guardar varias fotos por producto (hasta 6)
alter table public.products add column if not exists photo_urls text[];

-- Permisos del bucket de fotos (ejecutar DESPUÉS de crear el bucket "product-photos" en Storage)
create policy "Cualquiera puede ver las fotos de productos"
  on storage.objects for select
  using (bucket_id = 'product-photos');

create policy "Los usuarios logueados suben sus fotos"
  on storage.objects for insert
  with check (bucket_id = 'product-photos' and auth.role() = 'authenticated');

-- ============================================================
-- Sistema de pedidos (escrow manual) — agregado después del lanzamiento inicial
-- ============================================================

-- Datos de cobro del vendedor (CBU/alias), separados de "products" porque
-- esta tabla NO es pública: solo el propio vendedor puede leer su alias/CBU.
create table if not exists public.product_payout_info (
  product_id uuid primary key references public.products(id) on delete cascade,
  seller_id uuid not null references auth.users(id) default auth.uid(),
  cbu text,
  alias text,
  created_at timestamptz not null default now()
);

alter table public.product_payout_info enable row level security;

-- Solo el vendedor dueño del producto puede ver sus propios datos de cobro
create policy "El vendedor ve sus propios datos de cobro"
  on public.product_payout_info for select
  using (auth.uid() = seller_id);

create policy "El vendedor carga sus propios datos de cobro"
  on public.product_payout_info for insert
  with check (auth.uid() = seller_id);

create policy "El vendedor actualiza sus propios datos de cobro"
  on public.product_payout_info for update
  using (auth.uid() = seller_id);

-- Pedidos: cada compra genera una fila acá. El dinero lo retiene Mateo
-- manualmente (cuenta bancaria aparte) hasta que el comprador confirma
-- que recibió el producto en buen estado.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  buyer_id uuid not null references auth.users(id) default auth.uid(),
  seller_id uuid not null references auth.users(id),
  amount numeric not null check (amount > 0),
  payment_method text not null check (payment_method in ('transferencia','tarjeta')),
  status text not null default 'pendiente_pago' check (status in (
    'pendiente_pago',      -- comprador todavía no pagó / no subió comprobante
    'pago_confirmado',     -- Mateo confirmó que el dinero llegó
    'despachado',          -- el vendedor avisó que lo envió
    'confirmado_entrega',  -- el comprador confirmó que lo recibió bien
    'liberado',            -- Mateo ya le pagó al vendedor
    'disputado',           -- hay un problema, Mateo tiene que intervenir
    'cancelado'
  )),
  receipt_url text,
  tracking_info text,
  shipped_at timestamptz,
  confirmed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

-- El comprador y el vendedor de un pedido pueden verlo (nadie más)
create policy "Comprador y vendedor ven su propio pedido"
  on public.orders for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- Solo un usuario logueado puede crear un pedido, y solo como comprador de sí mismo
create policy "El comprador crea su propio pedido"
  on public.orders for insert
  with check (auth.uid() = buyer_id);

-- Comprador y vendedor pueden actualizar su propio pedido (p.ej. subir
-- comprobante, marcar despachado, confirmar recepción). El control fino de
-- qué campo puede tocar cada uno se maneja desde la app, no desde SQL.
create policy "Comprador y vendedor actualizan su propio pedido"
  on public.orders for update
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- Bucket de comprobantes de transferencia (crear el bucket "order-receipts"
-- en Storage, como privado, ANTES de ejecutar esto).
create policy "Los usuarios logueados suben su comprobante"
  on storage.objects for insert
  with check (bucket_id = 'order-receipts' and auth.role() = 'authenticated');

-- Comprador y vendedor del pedido pueden ver el comprobante (el nombre del
-- archivo incluye el id del pedido, así que alcanza con que esté autenticado;
-- Mateo revisa los comprobantes directamente desde el panel de Supabase).
create policy "Los usuarios logueados ven comprobantes"
  on storage.objects for select
  using (bucket_id = 'order-receipts' and auth.role() = 'authenticated');

-- ============================================================
-- Página de producto: preguntas al vendedor
-- ============================================================

create table if not exists public.product_questions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  asker_id uuid not null references auth.users(id) default auth.uid(),
  question text not null,
  answer text,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.product_questions enable row level security;

-- Cualquiera puede leer las preguntas y respuestas (son públicas, como en Mercado Libre)
create policy "Las preguntas son públicas para leer"
  on public.product_questions for select
  using (true);

-- Cualquier usuario logueado puede preguntar, siempre como sí mismo
create policy "Los usuarios logueados preguntan"
  on public.product_questions for insert
  with check (auth.uid() = asker_id);

-- Solo el dueño del producto puede responder (actualizar) una pregunta de ese producto
create policy "El vendedor responde las preguntas de su producto"
  on public.product_questions for update
  using (auth.uid() = (select user_id from public.products where id = product_questions.product_id));

-- ============================================================
-- Perfiles: username para poder iniciar sesión con usuario o email
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null check (char_length(username) >= 3),
  email text not null,
  nombre text,
  apellido text,
  telefono text,
  rol text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cada usuario solo puede ver y editar su propio perfil (tiene email y teléfono, no es público)
create policy "Cada usuario ve su propio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Cada usuario actualiza su propio perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- Cuando alguien se registra, copiamos sus datos automáticamente a public.profiles.
-- Se hace con un trigger (no desde el navegador) porque justo al registrarse todavía
-- no hay sesión activa (falta confirmar el email), así que el cliente no podría
-- insertar la fila él mismo sin saltarse la seguridad por fila.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, email, nombre, apellido, telefono, rol)
  values (
    new.id,
    lower(new.raw_user_meta_data->>'username'),
    new.email,
    new.raw_user_meta_data->>'nombre',
    new.raw_user_meta_data->>'apellido',
    new.raw_user_meta_data->>'telefono',
    new.raw_user_meta_data->>'rol'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Función para resolver el email a partir del username, para poder iniciar sesión
-- con cualquiera de los dos. security definer porque un usuario sin sesión (todavía
-- no logueado) necesita poder llamarla para saber con qué email intentar el login.
create or replace function public.email_for_username(uname text)
returns text
language sql
security definer
set search_path = public
as $$
  select email from public.profiles where username = lower(uname) limit 1;
$$;

grant execute on function public.email_for_username(text) to anon, authenticated;

-- ============================================================
-- Estado del producto: reservar automáticamente al generarse un pedido,
-- para que no quede "disponible" mientras se revisa el pago.
-- ============================================================

alter table public.products add column if not exists status text not null default 'disponible'
  check (status in ('disponible','reservado','vendido'));

-- Cuando se crea un pedido (orders), se reserva el producto automáticamente.
-- Cuando Mateo libera el pago al vendedor (status = 'liberado'), el producto
-- pasa a vendido. Si se cancela el pedido (status = 'cancelado'), el producto
-- vuelve a estar disponible. Esto se hace con un trigger, no desde la app,
-- para que pase siempre aunque el cambio de estado se haga a mano desde la
-- tabla de Supabase.
create or replace function public.sync_product_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'liberado' then
    update public.products set status = 'vendido' where id = new.product_id;
  elsif new.status = 'cancelado' then
    update public.products set status = 'disponible' where id = new.product_id;
  elsif new.status = 'pendiente_pago' then
    update public.products set status = 'reservado' where id = new.product_id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_order_status_change on public.orders;
create trigger on_order_status_change
  after insert or update on public.orders
  for each row execute function public.sync_product_status();

-- ============================================================
-- Emails automáticos (Resend): avisar por mail cuando llega una pregunta
-- nueva, y mandar un mail de bienvenida cuando se confirma la cuenta.
-- El secreto de acá abajo tiene que ser EXACTAMENTE el mismo valor que
-- cargues como variable de entorno INTERNAL_WEBHOOK_SECRET en Vercel.
-- ============================================================

create extension if not exists pg_net;

create or replace function public.notify_new_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://usadogamer-projecarg.vercel.app/api/notify-question',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('question_id', new.id, 'secret', '7b0dbded63a6e04bb8e592cc348bca0585c8afe3de7aacfb')
  );
  return new;
end;
$$;

drop trigger if exists on_question_created on public.product_questions;
create trigger on_question_created
  after insert on public.product_questions
  for each row execute function public.notify_new_question();

create or replace function public.notify_welcome_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform net.http_post(
      url := 'https://usadogamer-projecarg.vercel.app/api/send-welcome',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('user_id', new.id, 'secret', '7b0dbded63a6e04bb8e592cc348bca0585c8afe3de7aacfb')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_user_confirmed on auth.users;
create trigger on_user_confirmed
  after update on auth.users
  for each row execute function public.notify_welcome_email();

-- ============================================================
-- Empresas de envío que ofrece cada publicación.
-- ============================================================

alter table public.products add column if not exists shipping_carriers text[] not null default array['correo_argentino'];

-- ============================================================
-- Contraofertas: el comprador puede ofertar un precio menor, siempre
-- dentro de un margen fijo de la plataforma. Si el vendedor la acepta,
-- se genera el pedido automáticamente y el comprador tiene 24hs para pagar.
-- ============================================================

-- Margen global permitido (15% por debajo del precio de lista). Para
-- cambiarlo en el futuro, alcanza con editar este único número.
create or replace function public.offer_margin()
returns numeric
language sql
immutable
as $$
  select 0.15;
$$;

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) default auth.uid(),
  seller_id uuid not null references auth.users(id),
  offered_price numeric not null check (offered_price > 0),
  status text not null default 'pendiente' check (status in ('pendiente','aceptada','rechazada')),
  order_id uuid references public.orders(id),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (product_id, buyer_id)
);

alter table public.offers enable row level security;

create policy "Comprador y vendedor ven su propia oferta"
  on public.offers for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

create policy "El comprador crea su propia oferta"
  on public.offers for insert
  with check (auth.uid() = buyer_id);

create policy "El vendedor responde su propia oferta"
  on public.offers for update
  using (auth.uid() = seller_id);

-- Validación del lado del servidor (no se puede confiar solo en el JS):
-- rechaza ofertas por debajo del margen, en el producto propio, o en
-- productos que ya no están disponibles. Si falla, no se avisa al vendedor
-- porque la fila nunca llega a crearse.
create or replace function public.validate_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prod record;
  min_price numeric;
begin
  select price, status, user_id into prod from public.products where id = new.product_id;

  if prod is null then
    raise exception 'Producto no encontrado';
  end if;

  if prod.status <> 'disponible' then
    raise exception 'Este producto ya no está disponible para ofertar';
  end if;

  if new.buyer_id = prod.user_id then
    raise exception 'No podés ofertar en tu propia publicación';
  end if;

  min_price := prod.price * (1 - public.offer_margin());

  if new.offered_price < min_price then
    raise exception 'oferta_fuera_de_margen';
  end if;

  new.seller_id := prod.user_id;
  return new;
end;
$$;

drop trigger if exists before_offer_insert on public.offers;
create trigger before_offer_insert
  before insert on public.offers
  for each row execute function public.validate_offer();

-- Vencimiento de pagos pendientes generados por una oferta aceptada.
alter table public.orders add column if not exists payment_deadline timestamptz;

-- Cuando el vendedor acepta una oferta, se crea el pedido automáticamente
-- (con el precio ofertado) y el comprador tiene 24hs para pagar. El trigger
-- on_order_status_change ya reserva el producto solo porque el pedido nace
-- en 'pendiente_pago'.
create or replace function public.handle_offer_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_order_id uuid;
begin
  if new.status = 'aceptada' and old.status = 'pendiente' then
    insert into public.orders (product_id, buyer_id, seller_id, amount, payment_method, status, payment_deadline)
    values (new.product_id, new.buyer_id, new.seller_id, new.offered_price, 'transferencia', 'pendiente_pago', now() + interval '24 hours')
    returning id into new_order_id;

    update public.offers set order_id = new_order_id, responded_at = now() where id = new.id;
  elsif new.status = 'rechazada' and old.status = 'pendiente' then
    update public.offers set responded_at = now() where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_offer_status_change on public.offers;
create trigger on_offer_status_change
  after update on public.offers
  for each row execute function public.handle_offer_accept();

-- Si el comprador no paga dentro de las 24hs, se cancela el pedido y el
-- producto vuelve a estar disponible (vía el trigger que ya existía). Se
-- llama desde la app cada vez que se carga el explorador, un producto o
-- "mis pedidos", así que no depende de ningún proceso en segundo plano.
create or replace function public.cleanup_expired_offer_orders()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
  set status = 'cancelado'
  where status = 'pendiente_pago'
    and payment_deadline is not null
    and payment_deadline < now();
end;
$$;

grant execute on function public.cleanup_expired_offer_orders() to anon, authenticated;

-- Avisos por mail: al vendedor cuando le llega una oferta nueva, y al
-- comprador cuando el vendedor la acepta o la rechaza.
create or replace function public.notify_offer_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://usadogamer-projecarg.vercel.app/api/notify-offer',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('offer_id', new.id, 'secret', '7b0dbded63a6e04bb8e592cc348bca0585c8afe3de7aacfb')
  );
  return new;
end;
$$;

drop trigger if exists on_offer_created on public.offers;
create trigger on_offer_created
  after insert on public.offers
  for each row execute function public.notify_offer_created();

create or replace function public.notify_offer_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('aceptada','rechazada') and old.status = 'pendiente' then
    perform net.http_post(
      url := 'https://usadogamer-projecarg.vercel.app/api/notify-offer-response',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('offer_id', new.id, 'secret', '7b0dbded63a6e04bb8e592cc348bca0585c8afe3de7aacfb')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_offer_responded on public.offers;
create trigger on_offer_responded
  after update on public.offers
  for each row execute function public.notify_offer_response();
