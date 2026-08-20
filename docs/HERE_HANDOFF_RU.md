# HERE — краткий handoff

Актуально на 20 августа 2026 года. Полный продуктовый handoff владельца прочитан и принят как контекст проекта.

## Состояние

- Sprint 1 реализован, live-проверен и опубликован.
- Sprint 2 реализован и live-проверен, frontend не опубликован.
- Sprint 3 реализован и функционально live-проверен, frontend не опубликован.
- Public URL: `https://here-social-room.spriprin.chatgpt.site` — Sites version 8, commit `ab8891e`, пока Sprint 1.
- Phase 0 production release: **VERIFIED RELEASE CANDIDATE**, публикации не было.

Live acceptance:

```text
Sprint 1 A–G       PASS, включая forged helper-RPC probes
Sprint 2 S2-A–S2-O PASS
Sprint 3 S3-A–S3-N PASS на полном повторном прогоне; первый прогон поймал cold-start Realtime timeout
typecheck/lint/static/build PASS
```

Найденный privacy-баг закрыт. Generic `is_room_member` и
`shares_active_room` больше нельзя вызвать через Data API ни как `anon`, ни как
`authenticated`. RLS использует отдельные wrappers, которые всегда получают
viewer из `auth.uid()`. Внутренние backend RPC сохранили generic-проверку двух
участников. Прямой клиентский запуск trigger helpers также закрыт.

## Неизменяемый продуктовый контракт

```text
Room Wall creates abundance.
Drops synchronize attention.
Your Drop limits choice.
Interest Budget limits spam.
Fair Exposure balances opportunity, not outcomes.
Interested in You shows the sender to the recipient.
Interested Too confirms reciprocity.
Match is created exactly once on the backend.
Realtime chat removes the final barrier.
Block and Report provide minimum safety.
IRL meeting remains the goal.
```

Нельзя возвращать `Hidden`, `Open to Meet`, `Selective` или blind-mutual discovery. Нельзя превращать Room Wall в полный каталог. Interests, declines, Matches и messages не участвуют в Fair Exposure. Organizer видит только агрегаты и не получает individual Interests, Matches, Reports или chats.

## Supabase

Подключён проект `Here MVP`, ref `xwycdnyxuluuhylcnnjh`, PostgreSQL 17. Доступны прямые инструменты Supabase для SQL, migrations, schema, advisors, logs, types и Edge Functions.

Live присутствуют таблицы:

```text
profiles rooms room_members
drops drop_items interests
matches messages blocks reports
```

На всех включён RLS. С явного разрешения владельца история миграций
восстановлена без повторного выполнения старого SQL: пять предварительно
сверенных baseline-версий зарегистрированы атомарно, затем live применены
`20260820085448_phase0_privilege_hardening.sql` и
`20260820103251_restore_internal_membership_checks.sql`. Remote migration API
видит все семь версий. Вторая migration отделяет generic внутренние проверки от
self-bound RLS wrappers; необходимость этого разделения обнаружил live Sprint 2
regression run, после исправления весь набор прошёл.

Supabase CLI 2.115.0 проверен через официальный `--help`. CLI-сессия по-прежнему
не аутентифицирована (`supabase login` / `SUPABASE_ACCESS_TOKEN` отсутствует),
поэтому repair и DDL выполнены через подключённую Supabase integration.

После DDL advisors просмотрены: 38 security notices (из них единственный anon
`SECURITY DEFINER` — намеренный public lookup join route), а также 9
unindexed-FK и 4 unused-index notices. RPC-only таблицы и anonymous guest model
намеренные; leaked-password protection остаётся ограничением organizer auth;
performance notices не являются release-correctness blocker на текущем объёме.

## Definition of Done

Каждое следующее изменение завершено только если:

- сохранён product/security contract;
- база изменена новой migration и проверена live, если это необходимо;
- RLS abuse cases и затронутые acceptance tests проходят;
- typecheck, lint и production build проходят;
- Supabase advisors просмотрены после DDL;
- секретов нет в browser bundle;
- README, архитектура и этот handoff обновлены в том же commit;
- deployment не выполнялся без явного разрешения;
- ограничения и результаты проверки сообщены честно.

Destructive database operations требуют отдельного подтверждения владельца.

## Следующий приоритет

1. После отдельного разрешения опубликовать точный release-candidate commit Sprint 3.
2. Выполнить production smoke на public URL и проверить соответствие frontend/backend.
3. Затем — privacy-safe aggregate analytics, multi-device QA и закрытый pilot.
