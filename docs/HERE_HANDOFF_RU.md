# HERE — краткий handoff

Актуально на 22 августа 2026 года. Полный продуктовый handoff владельца прочитан и принят как контекст проекта.

## Состояние

- Sprint 1 реализован, live-проверен и опубликован.
- Sprint 2 реализован и live-проверен, frontend не опубликован.
- Sprint 3 реализован и функционально live-проверен, frontend не опубликован.
- Sprint 4 privacy-safe analytics реализован, применён в live Supabase и проверен, frontend не опубликован.
- Self-service регистрация organizer и актуальные landing/demo реализованы локально, не опубликованы.
- Public URL: `https://here-social-room.spriprin.chatgpt.site` — Sites version 8, commit `ab8891e`, пока Sprint 1.
- Текущий product release candidate: **VERIFIED LOCAL RELEASE CANDIDATE**, публикации не было.

Organizer теперь может самостоятельно создать постоянный email/password account,
войти, восстановить пароль и выйти. Organizer Auth хранится отдельно от anonymous
guest session, поэтому существующий guest не повышает права и не превращается в
organizer. В live-проекте включён `mailer_autoconfirm`, поэтому сейчас новый
account сразу получает session; интерфейс также умеет показать `Check your email`,
если confirmation будет включён. Recovery redirect ограничен доверенным origin.
Полный hosted email → click → new password нужно окончательно проверить во время
production smoke с доступом к реальному inbox.

Landing объясняет актуальный flow Room Wall → Your Drop → limited Interest →
Interested in You → Interested Too → Match → chat → IRL. `/demo` теперь повторяет
эту модель на локальных sample data, ничего не читает и не пишет в Supabase и
явно отличается от настоящей persistent Room. Старые Hidden/Open to Meet/
Selective, full People catalogue и blind-mutual механика удалены из актуального UI.

Live acceptance:

```text
Sprint 1 A–G       PASS, включая forged helper-RPC probes
Sprint 2 S2-A–S2-O PASS
Sprint 3 S3-A–S3-N PASS, включая настоящий Realtime между двумя sessions
Sprint 4 S4-A–S4-P PASS, 18/18 с Fair Exposure regression
Organizer Auth     PASS, 7/7
typecheck/lint/static/build PASS
```

Sprint 3 security coverage дополнен явными атаками: organizer read чужого chat,
reversed Match insert, forged `blocker_id` и forged `reporter_id`. Все запросы
должны быть отклонены клиентскими ролями.

Найденный privacy-баг закрыт. Generic `is_room_member` и
`shares_active_room` больше нельзя вызвать через Data API ни как `anon`, ни как
`authenticated`. RLS использует отдельные wrappers, которые всегда получают
viewer из `auth.uid()`. Внутренние backend RPC сохранили generic-проверку двух
участников. Прямой клиентский запуск trigger helpers также закрыт.

## Sprint 4 analytics

В реальном `/organizer` для выбранной Room добавлен адаптивный dashboard:
summary, funnel, per-Drop таблица, Interest response, median Match → first
message, aggregate Safety, `Last updated`, refresh, loading/empty/error и
`No data` для нулевого denominator. Dashboard не получает людей, профили,
пары, назначения, тексты или детали safety.

Единственный внешний analytics API — `room_analytics(room_id)`. Он доступен
только permanent organizer-владельцу Room. Другой organizer, participant и
unauthenticated caller получают отказ. Private instrumentation нельзя читать
или менять клиентскими ролями.

Точные коэффициенты:

- unlock = successful unique viewer+Drop unlocks / unique viewer+Drop claim attempts;
- completion = полностью просмотренные и обработанные viewer+Drop runs / все назначенные viewer+Drop runs;
- response = accepted + declined Interests / все Interests;
- acceptance = accepted / accepted + declined;
- decline = declined / accepted + declined;
- Match → conversation = Matches с минимум одним persisted message / все Matches.

Нулевой denominator возвращает `null` и отображается как `No data`. Card view —
только `first_seen_at is not null`; assignment не считается impression.
Исторически вычисляются memberships, Drops, card views/runs, Interests, Matches,
conversations и Reports. Только с Sprint 4 корректно собираются claim/forming/
unlock, фактический open входящего Interest и Room-attributed Block. Backfill не
делался. Analytics не участвует в Fair Exposure.

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
private.drop_claim_states private.interest_opens
```

На всех включён RLS. С явного разрешения владельца история миграций
восстановлена без повторного выполнения старого SQL: пять предварительно
сверенных baseline-версий зарегистрированы атомарно, затем live применены
`20260820085448_phase0_privilege_hardening.sql` и
`20260820103251_restore_internal_membership_checks.sql`. Remote migration API
сначала видел эти семь версий. Вторая migration отделяет generic внутренние
проверки от self-bound RLS wrappers; необходимость этого разделения обнаружил
live Sprint 2 regression run. Затем применены три additive Sprint 4 migrations:

```text
20260822140308_sprint4_privacy_safe_room_analytics.sql
20260822140512_sprint4_instrumentation_fk_indexes.sql
20260822140736_sprint4_no_historical_claim_backfill.sql
```

Remote migration API видит все десять версий. Sprint 4 SQL сначала проверен в
транзакции с rollback, затем применён live. Применённые migration-файлы
неизменяемы.

Supabase CLI 2.115.0 запускался через официальный package runtime: им созданы
новые migration-файлы и проверены команды. Постоянной CLI-сессии нет, поэтому
live schema/history и применение DDL выполняются через подключённую Supabase
integration.

После Sprint 4 DDL advisors просмотрены: ERROR findings нет. Security: 42
notice (4 informational deny-all/RPC-only tables, 1 намеренный anon join lookup,
26 проверенных authenticated `SECURITY DEFINER`, 10 anonymous guest warnings и
1 leaked-password warning). Performance: 19 INFO (8 unindexed-FK heuristics,
11 unused indexes). Private tables без policies — намеренный deny-all. Новый
composite FK уже покрыт подходящим equality index/leading key, поэтому
дублирующий index не добавлялся. Новые unused indexes ожидаемы на тестовом
объёме. Leaked-password protection остаётся ограничением organizer auth.

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

1. После отдельного разрешения опубликовать точный новый release-candidate commit.
2. Выполнить production smoke: organizer signup/sign-in/recovery, Room + QR, полный двухустройственный Sprint 1–3 flow и Sprint 4 dashboard.
3. Проверить hosted recovery email/click и production redirect allow-list.
4. Не начинать pilot, Sprint 5, moderation console, notifications или Premium без отдельного задания.
