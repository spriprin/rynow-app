# HERE — краткий handoff

Актуально на 29 августа 2026 года. Полный продуктовый handoff владельца прочитан и принят как контекст проекта.

## Состояние

- Sprint 1 реализован, live-проверен и опубликован.
- Sprint 2 реализован, live-проверен и опубликован.
- Sprint 3 реализован, функционально live-проверен и опубликован.
- Sprint 4 privacy-safe analytics реализован, применён в live Supabase, проверен и опубликован.
- Sprint 5 pilot reliability реализован, применён в live Supabase, live-проверен и опубликован.
- Sprint 5.1 Pre-Pilot Core Revision реализован и применён в live Supabase:
  always-on Explore, разделённое presence, Leave/Rejoin, adaptive Interest Budget
  и aggregate Explore analytics. Функциональный PP-набор зелёный, frontend опубликован.
- Self-service регистрация organizer и актуальные landing/demo опубликованы.
- Подготовлен узкий pre-pilot UX patch: на Welcome Back экране существующий guest
  может изменить имя и фото перед входом в новую Room. Session, profile ID, 18+
  confirmation и memberships при этом не пересоздаются. Patch опубликован в
  Sites version 10 и не является Sprint 6. Его RLS hardening уже применён как
  production migrations 17–18/18: для постороннего пользователя подписывается
  только актуальный `avatar_path`, а owner SELECT сохранён для штатного Storage
  cleanup старого объекта.
- В production добавлена официальная Supabase Auth CAPTCHA-интеграция с Cloudflare
  Turnstile для новых anonymous sessions и organizer Auth. Существующая session
  не получает повторный challenge. Live anonymous limit уже безопасно настроен;
  production Managed widget создан для публичного hostname, public site key
  добавлен в Sites environment revision 2, а secret хранится только в Supabase
  Auth. CAPTCHA включена.
- Public URL: `https://here-social-room.spriprin.chatgpt.site` — Sites version 10,
  проверенный application commit `25d6613ece09ccaf8268fdb3fd0b45a0b2908dd8`,
  Sites environment revision 2.
- Текущий статус: **PRE-PILOT RELEASE GATES PASS (P0=0, P1=0)**.
  Точный release опубликован на существующем URL; Sprint 6 не начинался.

24 августа была предпринята разрешённая попытка создать временную Supabase
Branch, но Management API вернул: `Branching is supported only on the Pro plan
or above`. Branch не была создана и списаний не было. С разрешения владельца
затем создан отдельный временный Free project
`HERE Auth Gate Temporary 20260826` (`rgenouyngkgfurrffcgw`, `eu-west-1`,
$0/month). В него применена полная migration chain и test-only Auth/CAPTCHA
конфигурация. Production не использовался как CAPTCHA token farm. Временный
проект 29 августа безвозвратно удалён официальным CLI после решения владельца
закончить оставшийся двухтелефонный smoke из-за отсутствия второго телефона.
Его отсутствие подтверждено и CLI, и подключённым Supabase project list;
одноразовая локальная CLI session затем удалена.

27 августа обязательный isolated same-NAT gate прошёл. AUTH-P1 создал 100/100
действительно новых distinct anonymous users за 588,973 секунды: 0 HTTP 429,
0 других ошибок, p95 473 мс. После полного естественного refill AUTH-P2 создал
50/50 новых users за 49,487 секунды: 0 HTTP 429, 0 других ошибок, p95 336 мс.
Старый depleted-bucket результат 1/100 остаётся только историческим негативным
свидетельством и не используется как capacity proof. Isolated official
always-fail и always-pass Turnstile phases прошли по 3/3. Production PP-R
отклонил отсутствующий и malformed proof 3/3 без 429. Настоящий Managed-widget
token принят production anonymous Auth один раз, replay отклонён CAPTCHA-specific
HTTP 400; существующая guest session после refresh вошла в Room без widget.
На exact hostname подтверждены widget/fail-closed поведение и отсутствие обхода.
Два независимых автоматизированных in-app Browser контекста не получили новый
Managed-challenge token, поэтому запрос и тестовые данные не создавались. Этот
этап был продолжен на одном реальном телефоне; двухтелефонная часть завершена со
статусом NOT EXECUTED из-за отсутствия второго устройства.
После этого обычный браузер успешно создал organizer Room `Test1`; production
строка открыта, exact `/r/f190cd5feeb6b808e4625921` отвечает HTTP 200. Первый
returning guest использовал Auth identity/profile от 19 августа, создал ровно
один active membership, а refresh через 209 секунд обновил `last_seen_at` без
дубля identity/profile/member. Затем тот же телефон открыл реальную Room `Test2`
и через опубликованный Welcome Back editor поменял `Pavel` на `Rooney` и фото.
Production сохранил тот же UUID, 18+ и Test1 membership, создал ровно один Test2
membership и обновил presence после refresh. Старый Storage object удалён,
остался только новый avatar. Второй fresh guest и двухтелефонный social-loop не
выполнялись, потому что второго устройства нет; reused sessions не выдавались за
fresh-user evidence.

Отдельный isolated live-тест profile edit прошёл 1/1: собственные имя и фото
обновились, UUID/18+/membership не изменились, новый путь подписался, заменённый
сразу перестал подписываться посторонним пользователем, а Storage подтвердил
удаление точного старого object path. Owner SELECT до удаления необходим самому
Storage API для последовательности SELECT → DELETE. Новые uploads и signed
tokens имеют TTL пять минут. Уже закэшированная в браузере legacy-фотография
может сохраняться до прежнего TTL в один час. Потерянный ответ UPDATE теперь
сверяется повторным чтением перед rollback; cleanup использует bounded retry.
Production smoke version 10 получил HTTP 200 для `/`, `/organizer`, `/demo` и
реального `Test1` join route. Все 13 browser bundles загрузились, `Edit profile`
присутствует в deployed bundle, service-role/Supabase secret/database credentials
не обнаружены.

Authenticated Dashboard показал фактическое значение Free-project:
`rate_limit_anonymous_users = 30/hour/IP`; поле доступно для редактирования, IP
forwarding выключен. Dashboard официально принял pilot target `1800/hour/IP`, а
полная перезагрузка страницы снова показала 1800. Фиксированный hosted bucket
остаётся 30 токенов, refill теперь 30/minute. Никакого spoofed/forwarded IP нет.

Turnstile-код уже fail-closed: новый гость без public site key не создаётся;
валидная сохранённая guest session идёт сразу к profile/Room. CAPTCHA включается
в Supabase на весь Auth project, поэтому токен также добавлен в organizer signup,
password sign-in и recovery. В browser разрешён только public site key. Turnstile
secret передан напрямую из Cloudflare в Supabase Auth settings и не записан в
репозиторий; service-role/secret key в клиент не добавлялись.

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
Organizer Auth     PASS, 8/8
Sprint 5 S5-A–S5-R PASS, 17/17 dedicated live run
PP functional       PASS, 10/10 групп (PP-A–O, PP-S/PP-T)
PP-P/PP-Q Auth      PASS: 100/100 + 50/50 fresh same-NAT, 0 × 429
PP-R abuse guard    PASS: isolated accept/reject + production-negative + exact-host fail-closed
full live regression PASS, 92/92, 0 fail, 0 skip
typecheck/lint       PASS
Auth/static/render   PASS, 20/20 local tests, 0 skip
production build    PASS
local route smoke    PASS
credential scan      PASS
```

После Auth-capacity gate строгий release runner повторил Organizer Auth,
Sprint 1–5 и Sprint 5.1 полностью: 92/92 PASS, 0 fail, 0 skip. Прогон включал
реальный 603-секундный presence expiry, 20 одновременных joins, 10 конкурентных
Drop claims и проверку exposure variance 2. P0=0, P1=0.

Последний зелёный Sprint 5 load run: 20 participant sessions, 20 одновременных
join RPC за 249 мс; 10 конкурентных Drop claims за 458 мс; exposure variance 2.
Исторический Sprint 5 five-minute expiry был проверен до изменения модели.
Новая модель отдельно проверена server-time состояниями: на 11-й минуте
`recent=false`, `eligible=true`; на 61-й минуте оба false; recovery возвращает
оба true. S5-H Realtime reconnect прошёл с
восстановлением persisted history и без дубликатов.

Локальная финальная проверка того же кандидата: TypeScript PASS, lint PASS,
Auth harness 7/7, static/render/security 13/13, production build PASS и
`git diff --check` PASS. Всего 20/20 локальных тестов без skip.

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
20260827163024_restore_closed_room_error_precedence.sql
20260828092916_restrict_replaced_avatar_reads.sql
20260829125141_allow_owner_avatar_cleanup.sql
```

Remote migration API видит все восемнадцать версий. Две последние additive
migrations ограничивают non-owner avatar reads актуальным `avatar_path` и
сохраняют owner SELECT, необходимый штатному Storage cleanup; чужая папка по-
прежнему недоступна. Предыдущая compatibility migration восстанавливает контракт
ошибки `This Room has ended.` в `claim_your_drop` и `send_interest`, не меняя
eligibility, данные или сохранение Match/chat.
Sprint 4–5.1 SQL сначала проверен в транзакции с rollback, затем применён live.
Применённые migration-файлы неизменяемы.

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

1. При наличии 10–20 пилотных устройств выполнить двухустройственный production
   smoke: fresh guests, Room Wall, Explore + Drop, Interest → Match → Chat,
   block/report и aggregate analytics. Текущий статус этой части — NOT EXECUTED,
   а не PASS/FAIL.
2. **DONE 29 августа:** временный Free Supabase project
   `rgenouyngkgfurrffcgw` безвозвратно удалён; отсутствие подтверждено двумя
   независимыми project listings.
3. Уже подтверждено на production: landing, полный isolated `/demo`, closed Room
   без новой identity/membership, organizer route с fail-closed Turnstile и scan
   всех 13 browser bundles version 10 без service-role/secret credentials.
4. Провести 10–20 physical-device QA, затем только blocking bug fixes и closed pilot.
5. Не начинать Sprint 6, growth, monetization, notifications или новые product features до pilot data.
