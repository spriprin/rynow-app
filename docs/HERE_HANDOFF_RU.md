# HERE — краткий handoff

Актуально на 20 августа 2026 года. Полный продуктовый handoff владельца прочитан и принят как контекст проекта.

## Состояние

- Sprint 1 реализован, live-проверен и опубликован.
- Sprint 2 реализован и live-проверен, frontend не опубликован.
- Sprint 3 реализован и функционально live-проверен, frontend не опубликован.
- Public URL: `https://here-social-room.spriprin.chatgpt.site` — Sites version 8, commit `ab8891e`, пока Sprint 1.
- Phase 0 production release: **BLOCKED**, публикации не было.

Live acceptance:

```text
Sprint 1 A–G       PASS для исходного набора; новый helper-RPC probe FAIL live
Sprint 2 S2-A–S2-O PASS
Sprint 3 S3-A–S3-N PASS на полном повторном прогоне; первый прогон поймал cold-start Realtime timeout
typecheck/lint/static/build PASS
```

Найден реальный privacy-баг: `is_room_member` и `shares_active_room` позволяют
authenticated-клиенту подставить чужой UUID и проверять присутствие вне своей
Room. Локально подготовлены additive migration
`20260820085448_phase0_privilege_hardening.sql` и regression-тесты. Миграция не
применена в live из-за обязательной остановки на расхождении migration history.

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

На всех включён RLS. Remote migration history не просто пустая: таблица
`supabase_migrations.schema_migrations` отсутствует. Для локальных migrations
`202608110001`–`202608200004` verified live equivalents существуют, но applied
status нельзя заявлять без исторических записей. Старые файлы нельзя накатывать
повторно. Нужен explicit выбор baseline/repair strategy; только после него можно
применить pending `20260820085448` и снова прогнать expanded A–G.

Supabase CLI 2.115.0 проверен через официальный `--help`. CLI-сессия не
аутентифицирована (`supabase login` / `SUPABASE_ACCESS_TOKEN` отсутствует), но
подключённая Supabase integration дала read-only доказательства schema/history,
запустила advisors и не выполняла history repair.

Advisor warnings классифицированы: RPC-only таблицы и anonymous guest model —
намеренные; public trigger helpers и forged-user helper RPC — fixable pending
migration; leaked-password protection — известное ограничение organizer auth;
performance notices по FK/index usage — не release-correctness blocker на
текущем объёме, но требуют отдельной оптимизации после baseline.

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

1. Получить explicit решение владельца по migration-history baseline/repair для пяти уже существующих migrations.
2. Применить pending migration `20260820085448` через поддерживаемый migration flow.
3. Проверить advisors и прогнать expanded Sprint 1 A–G, Sprint 2 A–O, Sprint 3 A–N и clean build.
4. После отдельного разрешения опубликовать Sprint 3 и выполнить production smoke.
5. Затем — privacy-safe aggregate analytics, multi-device QA и закрытый pilot.
