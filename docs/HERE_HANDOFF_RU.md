# HERE — handoff владельцу продукта

Актуально на 16 сентября 2026 года.

## Главное

В локальном Git-проекте подготовлен **Pilot RC1 Phase 2A candidate**. Это ещё не новая production-версия.

- Исходники изменены локально.
- Созданы две новые forward-only миграции, но они никуда не применялись.
- Production Supabase, hosting, DNS и production-конфигурация не менялись.
- Ничего не опубликовано.
- Production Supabase был отмечен как INACTIVE, поэтому никакие live-результаты в этой фазе не заявляются.
- Локально проходят TypeScript, lint, автоматические unit/contract тесты, чистая production-сборка и HTTP smoke шести UI-маршрутов. Встроенный browser был недоступен, поэтому это не считается visual или physical-device QA.

## Что теперь представляет собой Pilot RC1

```text
QR события
→ минимальный профиль
→ Room
→ постоянный curated Explore
→ Interest
→ Interested Too
→ Match
→ текстовый чат
→ встреча в реальности
→ post-event вопрос о фактической встрече
```

Drops больше не являются частью продукта для гостя или организатора. Старые таблицы/исторические миграции физически не удалены: это сделано специально, чтобы не рисковать данными. Подготовленная миграция один раз копирует факты уже просмотренных карточек в закрытый служебный реестр, чтобы Explore не повторял этих людей, и отключает доступ клиента к старым Drop RPC. Активный frontend их больше не вызывает.

## Что реализовано локально

### Continuous Explore

- Небольшой серверный буфер до 10 профилей.
- Автоматический refill при остатке около трёх карточек.
- Фоновая проверка новых доступных людей каждые 15 секунд без полной перезагрузки.
- Исключаются сам пользователь, Block, существующий Match, любая прежняя Interest-связь, уже просмотренные и неактивные/неeligible люди.
- Справедливость основана на количестве показов и уже зарезервированных показов, а не на количестве лайков.
- Полный список участников в браузер не передаётся.
- Если никого нового нет, UI честно сообщает, что новые люди появятся после присоединения к событию.
- Пустые server batches не создаются при каждом polling-запросе.

### Interests, Match, chat

- Жёсткого лимита Interests для пилота нет и счётчик не показывается.
- Одна пара sender → target в одной Room может иметь только один Interest.
- Rejected Interest нельзя отправить повторно.
- Блокированной паре нельзя взаимодействовать.
- Повтор одного сетевого запроса не создаёт второй Interest.
- Очень быстрый автоматизированный поток ограничивается приватной настраиваемой защитой (по умолчанию 20 новых Interests за 60 секунд на отправителя). Это не продуктовый budget.
- Mutual response создаёт ровно один Match.
- Chat остаётся доступен только участникам Match.

### Leave и возврат

Исправлен точный P0-сценарий:

1. пользователь нажимает Leave Event;
2. закрывает браузер, не нажимая Rejoin;
3. позже снова сканирует тот же QR;
4. переиспользуются тот же Auth user, profile и membership;
5. до чтения Room Wall/Explore определяется `left_at`;
6. показывается **Rejoin this event?**;
7. Rejoin активирует ту же membership-строку, не создавая дубликаты.

Обычное закрытие браузера, refresh или background не считается Leave. При возвращении активная Room восстанавливается автоматически.

### Profile, Connections, notifications

- В Room появился общий Profile/User Area.
- Профиль можно отредактировать.
- Connections не показывается, пока нет ни одного Match.
- После Match видны фото, имя, Room события и возможность снова открыть чат.
- Connections загружаются сразу по всем событиям текущего пользователя.
- Badge-состояние существует для нового входящего Interest, Match и сообщения; оно обновляется фоновым polling и при возвращении вкладки на экран.
- При открытии конкретного чата read-state ограничивается именно этим Match.

### Post-event IRL feedback

После завершения события каждый участник Match независимо получает вопрос:

> Did you meet [Name] in person?

Ответы: Yes, No, Not yet, Prefer not to say. Ответ другого человека недоступен пользователю. Организатор видит только суммарные числа.

### Safety и moderation

Категории Report приведены к согласованному списку. Работают отдельные действия Report и Report & Block. Пользователь отдельно подтверждает, можно ли передать релевантные детали staff события.

Создан `/admin` для platform operations:

- сводка активных Rooms;
- joined/recent/eligible;
- Explore users/views;
- Interests, Matches, начатые conversations;
- Blocks и Reports;
- очередь Open/Reviewed/Resolved.

Доступ требует постоянный Auth-аккаунт **и** запись в приватном allowlist. Organizer-владение Room или client-side флаг не дают admin-доступ. В organizer dashboard не раскрываются reporter identity, пары, отказы или тексты чатов.

### Terms, Privacy, retention, deletion

- Созданы `/terms` и `/privacy`, явно помеченные DRAFT.
- Они не заявляют юридическую или GDPR compliance.
- Onboarding сохраняет 18+, принятую версию документов и server timestamp.
- Retention-предложения 30/90/180 дней вынесены в приватную конфигурацию.
- Cleanup жёстко выключен; destructive job не создан.
- В Settings есть Delete my data, но сейчас это создаёт заявку, а не выполняет опасный cascade delete.

## Что НЕ проверено live

Из-за неактивного production backend и ограничений Phase 2A не проверялись:

- применение двух миграций на настоящем PostgreSQL;
- фактические RLS/grant/RPC результаты в Supabase;
- новый anonymous onboarding с CAPTCHA;
- два/несколько реальных устройства в одной Room;
- live continuous Explore/refill;
- concurrent mutual Match;
- notification triggers и chat polling/realtime;
- IRL feedback privacy на двух реальных Auth identities;
- `/admin` allowlist и moderation queue;
- aggregate organizer analytics;
- mobile Safari/Chrome;
- production smoke, shared Wi‑Fi/NAT и нагрузка.

Подготовлен отдельный staging acceptance test. Он специально отказывается работать с production project ref, secret/service-role ключом или неавторизованным CAPTCHA test setup.

## Решения, которые ещё нужны от владельца

1. Финальный юридический оператор, контакты, юрисдикция и тексты Terms/Privacy.
2. Финальные retention-периоды вместо рабочих 30/90/180.
3. Политика Delete My Data для shared Match/chat и safety evidence.
4. Какие постоянные аккаунты внести в приватный platform-admin allowlist.
5. Подтвердить или изменить anti-abuse threshold 20 Interests/60 секунд.
6. Разрешить staging Supabase и применение миграций после code review.
7. Разрешить production rollout отдельно после staging + physical mobile QA.

## Безопасная стратегия Delete My Data

Текущий UI только создаёт заявку. Будущий trusted backend worker должен:

- зафиксировать и аудитировать запрос;
- удалить avatar object и скрыть/анонимизировать profile;
- деактивировать Room memberships;
- удалить unmatched operational data по утверждённому сроку;
- не уничтожать вслепую общую историю другого участника;
- анонимизировать сторону Match/chat согласно финальной политике;
- сохранять Reports/safety evidence только на утверждённый срок и с ограниченным доступом;
- сохранить обезличенные aggregate analytics;
- удалять Auth user только после проверки всех FK и shared records.

## Риски миграции

- Новые constraints нормализуют старые Report reason/status; сначала нужна staging-копия и проверка фактических значений.
- Revoke старых RPC изменит поведение старых опубликованных frontend bundle. База и новый frontend должны выпускаться согласованно; нужен короткий maintenance/rollback план.
- Новые notification triggers начнут работать только для новых событий, исторического backfill нет.
- `private.platform_admins` специально пустой: admin должен быть добавлен trusted database operator способом.
- Retention пока не исполняется; сроки в интерфейсе остаются предложением.
- Физическое удаление Auth user сегодня опасно из-за shared Matches/messages/Reports и существующих cascade FK.
- SQL ещё не исполнялся на staging, поэтому статическая проверка не заменяет настоящий migration test.
- Auth/Turnstile/shared-NAT capacity нужно повторно подтвердить в актуальном окружении перед пилотом.

## Что делать дальше перед Pilot RC1

1. Поднять или создать изолированный staging Supabase.
2. Сделать snapshot и применить всю migration chain по timestamp.
3. Проверить таблицы, функции, grants, RLS и Storage.
4. Создать permanent organizer test account и отдельного allowlisted platform admin.
5. Запустить `pilot-rc1-acceptance` и полный release regression без skips.
6. Провести concurrency и негативные RLS/API проверки.
7. Пройти iPhone Safari и Android Chrome checklist на физических устройствах.
8. Отдельно подтвердить Turnstile и 2× ожидаемую нагрузку/shared NAT.
9. Утвердить legal/retention/deletion/admin решения.
10. Только после этого согласовать production migration + frontend deployment + smoke.

## Где смотреть код

- Guest flow: `app/components/RoomJoinApp.tsx`
- User area: `app/components/UserArea.tsx`
- Organizer: `app/components/OrganizerFoundationApp.tsx`
- Aggregate analytics: `app/components/OrganizerAnalytics.tsx`
- Platform operations: `app/components/AdminOperations.tsx`
- RC1 state helpers: `lib/rc1-state.ts`
- Database migrations: `supabase/migrations/20260914135346_*` и `20260914135348_*`
- Local contracts: `tests/pilot-rc1-state.test.mjs`, `tests/pilot-rc1-contract.test.mjs`
- Isolated live test: `tests/pilot-rc1-acceptance.test.mjs`
- Полный отчёт: `docs/PILOT_RC1_PHASE2A.md`

Phase 2A не начинал Sprint 6 и не менял production.
