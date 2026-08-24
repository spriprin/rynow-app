# HERE — краткий handoff

Актуально на 24 августа 2026 года. Полный продуктовый handoff владельца прочитан и принят как контекст проекта.

## Состояние

- Sprint 1 реализован, live-проверен и опубликован.
- Sprint 2 реализован и live-проверен, frontend не опубликован.
- Sprint 3 реализован и функционально live-проверен, frontend не опубликован.
- Sprint 4 privacy-safe analytics реализован, применён в live Supabase и проверен, frontend не опубликован.
- Sprint 5 pilot reliability реализован, применён в live Supabase и live-проверен, frontend не опубликован.
- Sprint 5.1 Pre-Pilot Core Revision реализован и применён в live Supabase:
  always-on Explore, разделённое presence, Leave/Rejoin, adaptive Interest Budget
  и aggregate Explore analytics. Функциональный PP-набор зелёный, frontend не опубликован.
- Self-service регистрация organizer и актуальные landing/demo реализованы локально, не опубликованы.
- Public URL: `https://here-social-room.spriprin.chatgpt.site` — Sites version 8, commit `ab8891e`, пока Sprint 1.
- Текущий статус: **PRE-PILOT RELEASE BLOCKED BY AUTH CAPACITY**. Публикации не было, Sprint 6 не начинался.

Обязательный same-NAT тест 24 августа: 100 действительно новых anonymous
sessions, пакеты по 10 запросов каждые 1,5 секунды. За 15,094 секунды прошла
**1 session**, **99 запросов получили HTTP 429**. Median latency 123 мс, p95
240 мс, диапазон 103–384 мс. Поэтому PP-P/PP-Q не проходят. В публичных Auth
settings anonymous signup включён, но настроенный CAPTCHA/Turnstile не виден;
PP-R также не закрыт. По прямому release contract публикация запрещена до
официального решения лимита и повторного успешного 50/100 теста.

Organizer теперь может самостоятельно создать постоянный email/password account,
войти, восстановить пароль и выйти. Organizer Auth хранится отдельно от anonymous
guest session, поэтому существующий guest не повышает права и не превращается в
organizer. В live-проекте включён `mailer_autoconfirm`, поэтому сейчас новый
account сразу получает session; интерфейс также умеет показать `Check your email`,
если confirmation будет включён. Recovery redirect ограничен доверенным origin.
Полный hosted email → click → new password нужно окончательно проверить во время
production smoke с доступом к реальному inbox.

Landing объясняет актуальный flow Room Wall → always-on curated Explore → limited
Interest → Interested in You → Interested Too → Match → chat → IRL. Scheduled
Drops остаются опциональными синхронными моментами. `/demo` повторяет
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
Sprint 5 S5-A–S5-R PASS, 17/17 dedicated live run
PP functional       PASS, 10/10 групп (PP-A–O, PP-S/PP-T)
PP-P/PP-Q Auth      BLOCKED, 1/100 success, 99 × 429
PP-R abuse guard    BLOCKED, Turnstile/CAPTCHA не подтверждён
typecheck/lint       PASS
static/render        PASS, 12/12
production build    PASS
local route smoke    PASS
credential scan      PASS
```

Новый полный Sprint 1–5 live rerun после 100-session теста не объявлен зелёным:
Auth bucket доказанно исчерпан/ограничен. Предыдущий зелёный ledger остаётся
историческим regression evidence, но перед публикацией его нужно повторить уже
после исправления Auth capacity.

Последний зелёный Sprint 5 load run: 20 participant sessions, 20 одновременных
join RPC за 249 мс; 10 конкурентных Drop claims за 458 мс; exposure variance 2.
Исторический Sprint 5 five-minute expiry был проверен до изменения модели.
Новая модель отдельно проверена server-time состояниями: на 11-й минуте
`recent=false`, `eligible=true`; на 61-й минуте оба false; recovery возвращает
оба true. S5-H Realtime reconnect прошёл с
восстановлением persisted history и без дубликатов.

После восстановления Auth quota текущий post-Sprint-5 build отдельно прошёл
Sprint 1 A–G и Organizer Auth 7/7. Вместе с уже зелёными текущими прогонами
Sprint 2–4 это даёт полный live regression ledger без подмены live-проверок
source inspection.

Повторные полные прогоны быстро исчерпывают проектные anonymous/signup quotas.
Test harness теперь создаёт identities небольшими пакетами, делает bounded
backoff на 429 и запускает 20 Room joins отдельно и одновременно. Тест, которому
нужен настоящий anonymous user, не подменяется permanent fallback. Точный ledger
последней регрессии и инфраструктурные ограничения находятся в
`docs/SPRINT5_REPORT.md`.

## Pre-Pilot presence и discovery

- heartbeat раз в 60 секунд только для visible/online tab;
- recently active = open Room + discovery enabled + server `last_seen_at` не старше 10 минут;
- discovery eligible = те же explicit-state условия + complete profile + `last_seen_at` не старше 60 минут;
- membership/profile/Match/chat при expiry не удаляются;
- явный Leave сразу убирает пользователя из Room Wall и новых Explore/Drop assignments, но сохраняет membership, profile, Matches и chat;
- heartbeat/refresh не отменяют explicit Leave; `Rejoin event` снова включает discovery только в открытой Room;
- Explore доступен весь вечер маленькими persistent batches: до 5, затем 6/8/10 по размеру eligible unseen pool;
- завершённый ambient batch имеет cooldown 15 минут, либо открывается раньше после 3+ действительно новых eligible unseen arrivals;
- Fair Exposure общий для Explore и Drop: real impressions + pending reservations; outcomes не влияют;
- Interest Budget: `<=5 → batch size`, иначе `ceil(batch size × 0.5)`, отдельно для каждого Explore/Drop batch;
- organizer отдельно видит `joined`, `recently active` и `discovery eligible`, только агрегаты;
- один guarded Room poll раз в 15 секунд, без hidden/offline duplicate loops;
- foreground/online сразу обновляет Room, Drop, incoming Interests, Matches и presence;
- Realtime — ускорение доставки, Postgres history — source of truth; есть bounded reconnect и polling fallback;
- signed avatars переиздаются после expiry/fetch error, bucket остаётся private;
- messages/reports получили client action UUID и backend idempotency;
- raw PostgREST/RPC/fetch errors заменены на безопасные recoverable states;
- privacy-safe diagnostics не содержат chat bodies, report details, pair graph, profiles или credentials.

Mobile status: **EMULATED PASS** на viewport 390×844 для landing, organizer Auth,
demo и closed QR Room. Горизонтального overflow нет, проверенные touch targets
не меньше 44 px. Физические iOS Safari/Android Chrome ещё не тестировались;
чеклист готов в `docs/REAL_DEVICE_QA.md`.

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
Explore works all evening in small curated batches.
Drops create optional synchronized attention bursts.
Explore and Your Drop limit choice.
Adaptive Interest Budget limits spam.
Fair Exposure balances opportunity, not outcomes.
Interested in You shows the sender to the recipient.
Interested Too confirms reciprocity.
Match is created exactly once on the backend.
Realtime chat removes the final barrier.
Block and Report provide minimum safety.
IRL meeting remains the goal.
```

Deprecated-модель `Room → wait for Drop → discovery` нельзя возвращать. Нельзя
возвращать `Hidden`, `Open to Meet`, `Selective` или blind-mutual discovery.
Нельзя превращать Room Wall/Explore в полный каталог или infinite swipe.
Interests, declines, Matches и messages не участвуют в Fair Exposure. Organizer
видит только агрегаты и не получает individual Interests, Matches, Reports или chats.

## Supabase

Подключён проект `Here MVP`, ref `xwycdnyxuluuhylcnnjh`, PostgreSQL 17. Доступны прямые инструменты Supabase для SQL, migrations, schema, advisors, logs, types и Edge Functions.

Live присутствуют таблицы:

```text
profiles rooms room_members
drops drop_items interests
explore_batches explore_items
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
20260822170732_sprint5_presence_reliability.sql
```

После Sprint 5 применены additive Pre-Pilot migrations:

```text
20260824093231_pre_pilot_core_revision.sql
20260824094220_fix_explore_replacement_position.sql
20260824094426_fix_left_presence_state.sql
20260824095156_pre_pilot_fk_indexes.sql
```

Remote migration API видит все пятнадцать версий. Sprint 4–5.1 SQL сначала
проверен в транзакции с rollback, затем применён live. Применённые
migration-файлы неизменяемы.

Supabase CLI 2.115.0 запускался через официальный package runtime: им созданы
новые migration-файлы и проверены команды. Постоянной CLI-сессии нет, поэтому
live schema/history и применение DDL выполняются через подключённую Supabase
integration.

После Sprint 5.1 DDL advisors просмотрены: ERROR findings нет. Security: 6 INFO
и 51 WARN в категориях намеренных deny-all/RPC-only таблиц, проверенных
identity-bound `SECURITY DEFINER` product RPC, anonymous guest model и
leaked-password protection. Новые Explore FK paths получили отдельные covering
indexes. Private/assignment tables без policies — намеренный deny-all; клиент
работает только через narrow RPC.

## Definition of Done

Каждое следующее изменение завершено только если:

- сохранён product/security contract;
- база изменена новой migration и проверена live, если это необходимо;
- RLS abuse cases и затронутые acceptance tests проходят;
- typecheck, lint и production build проходят;
- Supabase advisors просмотрены после DDL;
- секретов нет в browser bundle;
- README, архитектура и этот handoff обновлены в том же commit;
- deployment выполняется только после явного разрешения и всех release gates;
- ограничения и результаты проверки сообщены честно.

Destructive database operations требуют отдельного подтверждения владельца.

## Следующий приоритет

1. Через официальный Supabase Auth configuration/support поднять безопасную
   anonymous event capacity и подключить совместимый invisible Turnstile/CAPTCHA.
   Не использовать spoofed IP, browser secret, service role или ослабление RLS.
2. Повторить контролируемые PP-P 50 и PP-Q 100 same-NAT sessions; PP-R должен
   подтвердить abuse protection без challenge на каждом refresh.
3. После зелёного Auth gate повторить full Sprint 1–5 + PP regression,
   typecheck/lint/static/build/secret scan. Только затем опубликовать точный commit.
4. Выполнить production smoke полного Room → Explore + Drops → Match → Chat flow.
5. Провести 10–20 physical-device QA, затем только blocking bug fixes и closed pilot.
6. Не начинать Sprint 6, growth, monetization, notifications или новые product features до pilot data.
