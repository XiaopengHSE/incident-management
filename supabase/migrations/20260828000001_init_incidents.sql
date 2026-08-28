-- ============================================================
-- 异常事件登记台 - Supabase 数据库初始化迁移
-- 表结构: incidents (事件主表) + incident_history (事件历史表)
-- 保留能力: 乐观锁 (version)、版本号、历史记录、幂等键 (idempotency_key)
-- ============================================================

-- ---------- 事件主表 ----------
create table if not exists public.incidents (
    id              text primary key,                 -- 事件唯一标识 (沿用 inc_xxx 格式)
    title           text not null,                    -- 标题
    severity        text not null,                    -- 严重度
    assignee        text not null default '',         -- 负责人
    status          text not null,                    -- 处理状态
    remark          text not null default '',         -- 备注
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    closed_at       timestamptz,                      -- 关闭时间
    idempotency_key text unique,                      -- 幂等键 (唯一约束)
    version         integer not null default 1,       -- 乐观锁版本号
    constraint incidents_severity_check check (severity in ('紧急', '高', '中', '低')),
    constraint incidents_status_check   check (status   in ('待处理', '处理中', '已解决', '已关闭'))
);

-- ---------- 事件历史表 ----------
create table if not exists public.incident_history (
    id          bigint generated always as identity primary key,
    incident_id text not null references public.incidents (id) on delete cascade,
    status      text not null,
    time        timestamptz not null default now(),
    remark      text not null default ''
);

-- ---------- 索引 ----------
create index if not exists idx_incidents_status         on public.incidents (status);
create index if not exists idx_incidents_severity       on public.incidents (severity);
create index if not exists idx_incidents_created_at     on public.incidents (created_at desc);
create index if not exists idx_incidents_idempotency    on public.incidents (idempotency_key);
create index if not exists idx_incident_history_incident on public.incident_history (incident_id, time);

-- ---------- updated_at 自动更新触发器 ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_incidents_updated_at on public.incidents;
create trigger trg_incidents_updated_at
    before update on public.incidents
    for each row
    execute function public.set_updated_at();

-- ---------- 行级安全 (RLS) ----------
-- 后端使用 service_role key 自动绕过 RLS；
-- 此处不开放 anon / authenticated 访问（默认全拒绝），保证数据安全。
alter table public.incidents        enable row level security;
alter table public.incident_history enable row level security;

-- 若未来需要给已登录用户开放访问，可追加策略，例如：
-- create policy "authenticated_full_access" on public.incidents
--     for all to authenticated using (true) with check (true);
