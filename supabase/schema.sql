-- Split the Expenses — schema. Paste into the Supabase SQL editor and run.
--
-- ACCESS MODEL
--
-- The browser never talks to Postgres. Every read and write goes through the
-- Next.js server, which holds SUPABASE_SECRET_KEY and connects as the
-- service_role. So RLS is enabled on every table with *no policies at all*:
-- the anon and authenticated roles can do nothing, and the group slug in the
-- URL is checked by our own server code before any query runs.
--
-- That is what makes "the link is the password" actually true. A publishable
-- key shipped to the browser would be public, and permissive policies would
-- let anyone holding it dump every group in the database.
--
-- IDS
--
-- All ids and slugs are client-generated nanoid strings, so they are `text`
-- rather than bigint identities. They are unguessable, which is the point.
--
-- MONEY
--
-- Every amount is a bigint count of the currency's minor unit (paise for INR).
-- There is no numeric or float money column here and there must never be one.

-- Uncomment while iterating on the schema. DESTRUCTIVE: drops every group,
-- expense and settlement. Leave commented once there is real data.
-- drop function if exists public.group_bundle(text);
-- drop function if exists public.group_activity(text,int,timestamptz);
-- drop function if exists public.save_expense(text,text,text,text,bigint,text,text,date,text,jsonb,text);
-- drop function if exists public.save_settlements(text,jsonb,text,date,text);
-- drop function if exists public.save_settlement(text,text,text,bigint,date,text,text);
-- drop function if exists public.set_expense_deleted(text,boolean,text);
-- drop function if exists public.create_group(text,text,text,text,text,text,text);
-- drop function if exists public.add_member(text,text,text,text,text);
-- drop function if exists public.rename_member(text,text,text);
-- drop function if exists public.claim_member(text,text);
-- drop function if exists public.set_group_settings(text,text,boolean,text);
-- drop function if exists public.set_settlement_deleted(text,boolean,text);
-- drop table if exists public.activity;
-- drop table if exists public.settlements;
-- drop table if exists public.expense_shares;
-- drop table if exists public.expenses;
-- drop table if exists public.members;
-- drop table if exists public.groups;


-- ---------------------------------------------------------------- groups ---

create table if not exists public.groups (
  id                text        primary key,
  slug              text        not null unique,
  name              text        not null,
  -- The group owns the currency; expenses do not carry one. Netting across
  -- currencies needs exchange rates, and rates have a date, a source and a
  -- spread. A trip abroad means a second group.
  currency          text        not null default 'INR',
  simplify_payments boolean     not null default false,
  created_at        timestamptz not null default now(),

  constraint groups_name_present check (length(btrim(name)) > 0),
  constraint groups_slug_shape   check (slug ~ '^[A-Za-z0-9_-]{8,32}$'),
  constraint groups_currency_supported
    check (currency in ('INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY'))
);


-- --------------------------------------------------------------- members ---

create table if not exists public.members (
  id         text        primary key,
  group_id   text        not null references public.groups (id) on delete cascade,
  name       text        not null,
  -- Set when a device claims this member. Null means nobody has claimed it,
  -- which is what the join screen offers to new arrivals so they pick an
  -- existing "Sam" instead of creating a second one.
  device_key text,
  created_at timestamptz not null default now(),

  constraint members_name_present check (length(btrim(name)) > 0),
  -- Names are the identity here, so they have to be unique within a group.
  constraint members_name_unique  unique (group_id, name),
  -- Not redundant with the primary key: it is the target the composite foreign
  -- keys below point at, which is how a payer or a share is proven to belong
  -- to the same group as its expense.
  constraint members_group_scoped unique (group_id, id)
);


-- -------------------------------------------------------------- expenses ---

create table if not exists public.expenses (
  id           text        primary key,
  group_id     text        not null references public.groups (id) on delete cascade,
  title        text        not null,
  description  text,
  amount_minor bigint      not null,
  -- Free text from a suggested list. Report-only: it never touches balances,
  -- so a wrong or missing category cannot corrupt anything.
  category     text,
  -- Who actually put the money down. The split says who consumed the expense;
  -- the payer says who funded it. A debt is the gap between the two.
  paid_by      text        not null,
  spent_on     date        not null,
  split_mode   text        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Soft delete: excluded from balances, still visible, still recoverable.
  deleted_at   timestamptz,

  constraint expenses_title_present  check (length(btrim(title)) > 0),
  constraint expenses_amount_positive check (amount_minor > 0),
  -- Matches MAX_AMOUNT_MINOR in src/lib/money.ts. Above this is a typo, and
  -- it keeps every product in the split maths inside safe-integer range.
  constraint expenses_amount_sane    check (amount_minor <= 1000000000000),
  constraint expenses_split_mode     check (split_mode in ('equal', 'exact', 'percent')),
  -- Deferrable so that deleting a whole group works: the cascade removes
  -- members and expenses in one statement and the order is not guaranteed, so
  -- an immediately-checked reference would fail halfway through. Deferred, the
  -- check runs at commit when both are gone. Deleting a member who has paid
  -- for something still fails, which is the rule we actually want.
  constraint expenses_payer_in_group
    foreign key (group_id, paid_by) references public.members (group_id, id)
    deferrable initially deferred,
  constraint expenses_group_scoped unique (group_id, id)
);


-- --------------------------------------------------------- expense_shares ---

create table if not exists public.expense_shares (
  id           text   primary key,
  -- Denormalised from the expense, and safe to be: the composite foreign keys
  -- below mean it cannot disagree with the expense's group, and having it here
  -- is what lets Postgres prove the member belongs to the same group.
  group_id     text   not null,
  expense_id   text   not null,
  member_id    text   not null,
  -- What this member owes for this expense.
  share_minor  bigint not null,

  constraint expense_shares_non_negative check (share_minor >= 0),
  constraint expense_shares_expense_fk
    foreign key (group_id, expense_id) references public.expenses (group_id, id)
    on delete cascade,
  constraint expense_shares_member_fk
    foreign key (group_id, member_id) references public.members (group_id, id)
    deferrable initially deferred,
  constraint expense_shares_one_per_member unique (expense_id, member_id)
);


-- ----------------------------------------------------------- settlements ---

-- "I paid these people back." A payment to several people at once is several
-- rows sharing a settled_on and a timestamp — one row per payee keeps the
-- balance maths uniform.
create table if not exists public.settlements (
  id           text        primary key,
  group_id     text        not null references public.groups (id) on delete cascade,
  from_member  text        not null,
  to_member    text        not null,
  amount_minor bigint      not null,
  settled_on   date        not null,
  note         text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint settlements_amount_positive  check (amount_minor > 0),
  constraint settlements_amount_sane      check (amount_minor <= 1000000000000),
  constraint settlements_distinct_parties check (from_member <> to_member),
  constraint settlements_from_in_group
    foreign key (group_id, from_member) references public.members (group_id, id)
    deferrable initially deferred,
  constraint settlements_to_in_group
    foreign key (group_id, to_member) references public.members (group_id, id)
    deferrable initially deferred
);


-- -------------------------------------------------------------- activity ---

-- Not a security log — it cannot be, there is no auth. It exists so a group
-- can answer "why did this number change?" without guessing, which is the
-- difference between a disagreement being resolvable and not.
create table if not exists public.activity (
  id            text        primary key,
  group_id      text        not null references public.groups (id) on delete cascade,
  actor_member  text,
  kind          text        not null,
  subject_id    text,
  summary       text        not null,
  created_at    timestamptz not null default now(),

  -- The list of permitted kinds lives in an ALTER below rather than here.
  -- `create table if not exists` does nothing to a table that already exists,
  -- so a constraint that is expected to grow has to be (re)applied explicitly
  -- for a re-run of this file to converge.
  --
  -- MATCH SIMPLE: a null actor_member skips the check, which is what we want
  -- for events with no member behind them.
  constraint activity_actor_in_group
    foreign key (group_id, actor_member) references public.members (group_id, id)
    deferrable initially deferred
);


-- ------------------------------------------------- evolving constraints ---

-- Re-applied on every run so that adding a kind here is enough to update an
-- existing database. Drop-then-add is safe: it is validated against the
-- existing rows as it goes back on.
alter table public.activity drop constraint if exists activity_kind_known;
alter table public.activity add constraint activity_kind_known check (kind in (
  'group_created',
  'member_added', 'member_renamed', 'member_claimed',
  'expense_added', 'expense_edited', 'expense_deleted', 'expense_restored',
  'settlement_added', 'settlement_edited',
  'settlement_deleted', 'settlement_restored',
  'settings_changed'
));


-- --------------------------------------------------------------- indexes ---

create index if not exists members_group_idx     on public.members (group_id);
create index if not exists expenses_group_idx    on public.expenses (group_id, spent_on desc);
create index if not exists shares_expense_idx    on public.expense_shares (expense_id);
create index if not exists shares_member_idx     on public.expense_shares (group_id, member_id);
create index if not exists settlements_group_idx on public.settlements (group_id, settled_on desc);
create index if not exists activity_group_idx    on public.activity (group_id, created_at desc);


-- -------------------------------------------------------------- triggers ---

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();


-- A group's currency is fixed the moment it has an expense. Changing it later
-- would silently reinterpret every stored amount.
create or replace function public.lock_currency_once_spent()
returns trigger
language plpgsql
as $$
begin
  if new.currency is distinct from old.currency
     and exists (select 1 from public.expenses where group_id = old.id) then
    raise exception
      'Cannot change currency: this group already has expenses'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_currency_locked on public.groups;
create trigger groups_currency_locked
  before update on public.groups
  for each row execute function public.lock_currency_once_spent();


-- THE invariant, enforced by the database itself: an expense's shares sum to
-- exactly its amount_minor. If this can ever be false, every balance in the
-- app is quietly wrong.
--
-- Deferred to commit, because writing an expense and its shares takes several
-- statements. That is also why expenses are written through save_expense()
-- below rather than as separate requests — two HTTP calls are two
-- transactions, and the first one would fail this check on its own.
create or replace function public.assert_expense_reconciles()
returns trigger
language plpgsql
as $$
declare
  target   text;
  total    bigint;
  allotted bigint;
begin
  -- Deliberately IF branches rather than a CASE expression. plpgsql hands a
  -- whole expression to the SQL executor with `new` bound as a record, so both
  -- arms of a CASE are resolved against the same row type and `new.expense_id`
  -- fails when the trigger fired on `expenses`. Separate statements are only
  -- compiled when reached.
  if tg_table_name = 'expenses' then
    if tg_op = 'DELETE' then
      target := old.id;
    else
      target := new.id;
    end if;
  else
    if tg_op = 'DELETE' then
      target := old.expense_id;
    else
      target := new.expense_id;
    end if;
  end if;

  select amount_minor into total from public.expenses where id = target;
  if not found then
    -- The expense was hard-deleted and took its shares with it.
    return null;
  end if;

  select coalesce(sum(share_minor), 0) into allotted
    from public.expense_shares where expense_id = target;

  if allotted <> total then
    raise exception
      'Expense % does not reconcile: shares total %, expense is %',
      target, allotted, total
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

drop trigger if exists expenses_reconcile on public.expenses;
create constraint trigger expenses_reconcile
  after insert or update on public.expenses
  deferrable initially deferred
  for each row execute function public.assert_expense_reconciles();

drop trigger if exists expense_shares_reconcile on public.expense_shares;
create constraint trigger expense_shares_reconcile
  after insert or update or delete on public.expense_shares
  deferrable initially deferred
  for each row execute function public.assert_expense_reconciles();


-- ------------------------------------------------------------- functions ---

-- One consistent snapshot of a group. Six separate queries can interleave with
-- someone else's write and produce a report whose column totals do not match
-- its own grand total; this cannot.
create or replace function public.group_bundle(p_slug text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'group',       to_jsonb(g),
    'members',     coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at)
                             from public.members m where m.group_id = g.id), '[]'::jsonb),
    'expenses',    coalesce((select jsonb_agg(to_jsonb(e) order by e.spent_on desc, e.created_at desc)
                             from public.expenses e where e.group_id = g.id), '[]'::jsonb),
    'shares',      coalesce((select jsonb_agg(to_jsonb(s))
                             from public.expense_shares s where s.group_id = g.id), '[]'::jsonb),
    'settlements', coalesce((select jsonb_agg(to_jsonb(t) order by t.settled_on desc, t.created_at desc)
                             from public.settlements t where t.group_id = g.id), '[]'::jsonb)
  )
  from public.groups g
  where g.slug = p_slug;
$$;


-- Activity is deliberately not part of the bundle: balances do not need it,
-- it is its own screen, and it is the one table that grows without bound as
-- people edit things. Paged separately so a months-old group does not drag its
-- whole history into every page load.
create or replace function public.group_activity(
  p_group_id text,
  p_limit    int default 100,
  p_before   timestamptz default null
)
returns setof public.activity
language sql
stable
as $$
  select *
  from public.activity
  where group_id = p_group_id
    and (p_before is null or created_at < p_before)
  order by created_at desc
  limit least(greatest(p_limit, 1), 500);
$$;


-- Write an expense and its shares atomically, and log it. Doing this in one
-- transaction is not a nicety: a half-written expense is a corrupt ledger, and
-- the deferred reconcile trigger above would reject the halves anyway.
--
-- p_shares is [{"member_id": "...", "share_minor": 123}, ...] and must already
-- sum to p_amount_minor — src/lib/split.ts is what guarantees that.
create or replace function public.save_expense(
  p_id           text,
  p_group_id     text,
  p_title        text,
  p_description  text,
  p_amount_minor bigint,
  p_category     text,
  p_paid_by      text,
  p_spent_on     date,
  p_split_mode   text,
  p_shares       jsonb,
  p_actor_member text
)
returns void
language plpgsql
as $$
declare
  already_existed boolean;
  share_total     bigint;
begin
  select coalesce(sum((share->>'share_minor')::bigint), 0)
    into share_total
    from jsonb_array_elements(p_shares) as share;

  -- Checked here as well as in the trigger, purely so the failure names the
  -- numbers instead of surfacing as a constraint violation at commit.
  if share_total <> p_amount_minor then
    raise exception
      'Shares total % but the expense is %', share_total, p_amount_minor
      using errcode = 'check_violation';
  end if;

  select exists(select 1 from public.expenses where id = p_id) into already_existed;

  insert into public.expenses (
    id, group_id, title, description, amount_minor,
    category, paid_by, spent_on, split_mode
  )
  values (
    p_id, p_group_id, p_title, p_description, p_amount_minor,
    p_category, p_paid_by, p_spent_on, p_split_mode
  )
  on conflict (id) do update set
    title        = excluded.title,
    description  = excluded.description,
    amount_minor = excluded.amount_minor,
    category     = excluded.category,
    paid_by      = excluded.paid_by,
    spent_on     = excluded.spent_on,
    split_mode   = excluded.split_mode;

  -- Replace the whole share set rather than diffing it: the set is small, and
  -- an edit that changes who is in the split has no sensible partial update.
  delete from public.expense_shares where expense_id = p_id;

  insert into public.expense_shares (id, group_id, expense_id, member_id, share_minor)
  select
    p_id || '/' || (share->>'member_id'),
    p_group_id,
    p_id,
    share->>'member_id',
    (share->>'share_minor')::bigint
  from jsonb_array_elements(p_shares) as share;

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (
    gen_random_uuid()::text,
    p_group_id,
    p_actor_member,
    case when already_existed then 'expense_edited' else 'expense_added' end,
    p_id,
    p_title
  );
end;
$$;


-- Settling with several people at once is several rows written together, so it
-- either all lands or none of it does.
--
-- p_rows is [{"id": "...", "from_member": "...", "to_member": "...",
--             "amount_minor": 123}, ...]
create or replace function public.save_settlements(
  p_group_id     text,
  p_rows         jsonb,
  p_actor_member text,
  p_settled_on   date,
  p_note         text
)
returns void
language plpgsql
as $$
declare
  written int;
begin
  insert into public.settlements (
    id, group_id, from_member, to_member, amount_minor, settled_on, note
  )
  select
    row_data->>'id',
    p_group_id,
    row_data->>'from_member',
    row_data->>'to_member',
    (row_data->>'amount_minor')::bigint,
    p_settled_on,
    p_note
  from jsonb_array_elements(p_rows) as row_data;

  get diagnostics written = row_count;

  if written = 0 then
    raise exception 'No payments to record' using errcode = 'check_violation';
  end if;

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (
    gen_random_uuid()::text,
    p_group_id,
    p_actor_member,
    'settlement_added',
    null,
    written || ' payment' || case when written = 1 then '' else 's' end || ' recorded'
  );
end;
$$;


-- Soft delete and restore, with the log entry in the same transaction so the
-- history can never be missing the event that explains a changed balance.
create or replace function public.set_expense_deleted(
  p_id           text,
  p_deleted      boolean,
  p_actor_member text
)
returns void
language plpgsql
as $$
declare
  target_group text;
  target_title text;
begin
  update public.expenses
     set deleted_at = case when p_deleted then now() else null end
   where id = p_id
  returning group_id, title into target_group, target_title;

  if not found then
    raise exception 'No such expense: %', p_id using errcode = 'no_data_found';
  end if;

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (
    gen_random_uuid()::text,
    target_group,
    p_actor_member,
    case when p_deleted then 'expense_deleted' else 'expense_restored' end,
    p_id,
    target_title
  );
end;
$$;


create or replace function public.set_settlement_deleted(
  p_id           text,
  p_deleted      boolean,
  p_actor_member text
)
returns void
language plpgsql
as $$
declare
  target_group text;
begin
  update public.settlements
     set deleted_at = case when p_deleted then now() else null end
   where id = p_id
  returning group_id into target_group;

  if not found then
    raise exception 'No such settlement: %', p_id using errcode = 'no_data_found';
  end if;

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (
    gen_random_uuid()::text,
    target_group,
    p_actor_member,
    case when p_deleted then 'settlement_deleted' else 'settlement_restored' end,
    p_id,
    case when p_deleted then 'Payment removed' else 'Payment restored' end
  );
end;
$$;


-- Editing one recorded payment. Settlements are written in batches by
-- save_settlements (a payment to several people at once is several rows), but
-- they are corrected one at a time: a wrong amount on one row should not
-- disturb the others it was recorded alongside.
create or replace function public.save_settlement(
  p_id           text,
  p_from_member  text,
  p_to_member    text,
  p_amount_minor bigint,
  p_settled_on   date,
  p_note         text,
  p_actor_member text
)
returns void
language plpgsql
as $$
declare
  target_group text;
begin
  update public.settlements
     set from_member  = p_from_member,
         to_member    = p_to_member,
         amount_minor = p_amount_minor,
         settled_on   = p_settled_on,
         note         = p_note
   where id = p_id
  returning group_id into target_group;

  if not found then
    raise exception 'No such payment: %', p_id using errcode = 'no_data_found';
  end if;

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (
    gen_random_uuid()::text,
    target_group,
    p_actor_member,
    'settlement_edited',
    p_id,
    'Payment edited'
  );
end;
$$;


-- A device claims exactly one member per group, and a member is claimed by at
-- most one device. Without this, one phone could be two people in the same
-- group, which makes "who am I" unanswerable.
create unique index if not exists members_one_device_per_group
  on public.members (group_id, device_key)
  where device_key is not null;


-- Creating a group is three writes — the group, the person creating it, and
-- the log entry — so it is one function. A group that exists with nobody in it
-- is a dead end the creator cannot recover from.
create or replace function public.create_group(
  p_id           text,
  p_slug         text,
  p_name         text,
  p_currency     text,
  p_member_id    text,
  p_member_name  text,
  p_device_key   text
)
returns void
language plpgsql
as $$
begin
  insert into public.groups (id, slug, name, currency)
  values (p_id, p_slug, p_name, p_currency);

  insert into public.members (id, group_id, name, device_key)
  values (p_member_id, p_id, p_member_name, p_device_key);

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (gen_random_uuid()::text, p_id, p_member_id, 'group_created', p_id, p_name);
end;
$$;


create or replace function public.add_member(
  p_id           text,
  p_group_id     text,
  p_name         text,
  p_device_key   text,
  p_actor_member text
)
returns void
language plpgsql
as $$
begin
  insert into public.members (id, group_id, name, device_key)
  values (p_id, p_group_id, p_name, p_device_key);

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (
    gen_random_uuid()::text,
    p_group_id,
    coalesce(p_actor_member, p_id),
    'member_added',
    p_id,
    p_name
  );
end;
$$;


-- Rename, never delete. A member with expenses cannot be removed without
-- orphaning splits and breaking every balance, and the foreign keys enforce
-- that, so renaming is the only correction available.
create or replace function public.rename_member(
  p_id           text,
  p_name         text,
  p_actor_member text
)
returns void
language plpgsql
as $$
declare
  target_group text;
  former_name  text;
begin
  select group_id, name into target_group, former_name
    from public.members where id = p_id;

  if not found then
    raise exception 'No such member: %', p_id using errcode = 'no_data_found';
  end if;

  update public.members set name = p_name where id = p_id;

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (
    gen_random_uuid()::text,
    target_group,
    p_actor_member,
    'member_renamed',
    p_id,
    former_name || ' → ' || p_name
  );
end;
$$;


-- Someone arriving by link picks the member that is already them, rather than
-- creating a second "Sam" alongside the one holding all the expenses.
create or replace function public.claim_member(
  p_id         text,
  p_device_key text
)
returns void
language plpgsql
as $$
declare
  target_group text;
  target_name  text;
  claimed_by   text;
begin
  select group_id, name, device_key
    into target_group, target_name, claimed_by
    from public.members where id = p_id;

  if not found then
    raise exception 'No such member: %', p_id using errcode = 'no_data_found';
  end if;

  -- Re-claiming from the same device is a no-op, not an error: it happens
  -- whenever someone reopens the link.
  if claimed_by is not null and claimed_by is distinct from p_device_key then
    raise exception 'Someone is already using this name'
      using errcode = 'unique_violation';
  end if;

  update public.members set device_key = p_device_key where id = p_id;

  if claimed_by is null then
    insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
    values (gen_random_uuid()::text, target_group, p_id, 'member_claimed', p_id, target_name);
  end if;
end;
$$;


create or replace function public.set_group_settings(
  p_id                text,
  p_name              text,
  p_simplify_payments boolean,
  p_actor_member      text
)
returns void
language plpgsql
as $$
begin
  update public.groups
     set name = p_name, simplify_payments = p_simplify_payments
   where id = p_id;

  if not found then
    raise exception 'No such group: %', p_id using errcode = 'no_data_found';
  end if;

  insert into public.activity (id, group_id, actor_member, kind, subject_id, summary)
  values (
    gen_random_uuid()::text,
    p_id,
    p_actor_member,
    'settings_changed',
    p_id,
    case when p_simplify_payments
         then 'Simplified payments on'
         else 'Simplified payments off' end
  );
end;
$$;


-- ------------------------------------------------------------------- RLS ---

-- Enabled with no policies whatsoever. That is the whole access control story:
-- anon and authenticated can read nothing and write nothing, and the only way
-- in is the service_role key held by the Next.js server.
--
-- To verify: query any table with the publishable key and you get zero rows.
-- RLS denies by returning nothing rather than erroring, so proving a table is
-- protected means counting rows with the secret key and comparing.

alter table public.groups         enable row level security;
alter table public.members        enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements    enable row level security;
alter table public.activity       enable row level security;

-- Belt and braces: Supabase grants table privileges to anon/authenticated by
-- default, and RLS with no policies already denies them, but a future policy
-- added by accident should not silently open the door.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on functions from anon, authenticated;
