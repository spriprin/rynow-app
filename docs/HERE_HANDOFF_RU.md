# HERE — краткий handoff

Актуально на 20 августа 2026 года. Полный продуктовый handoff владельца прочитан и принят как контекст проекта.

## Состояние

- Sprint 1 реализован, live-проверен и опубликован.
- Sprint 2 реализован и live-проверен, frontend не опубликован.
- Sprint 3 реализован, hardened и live-проверен, frontend не опубликован.
- Public URL: `https://here-social-room.spriprin.chatgpt.site` — пока Sprint 1.
- Последний проверенный source-кандидат: commits `724f7dc` и `8cb9bd6` плюс последующие documentation-only изменения.

Live acceptance:

```text
Sprint 1 A–G       PASS
Sprint 2 S2-A–S2-O PASS
Sprint 3 S3-A–S3-N PASS, включая двусторонний Realtime
typecheck/lint/static/build PASS
```

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

На всех включён RLS. Remote migration history пустая, потому что Sprint 1–3 ранее применялись вручную через SQL Editor. Старые migration-файлы нельзя накатывать повторно без сверки. Для следующего schema change сначала требуется безопасно установить baseline/repair strategy, затем использовать только новые additive migrations.

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

1. Безопасно синхронизировать remote migration history с существующей live schema.
2. Классифицировать Supabase security advisor warnings.
3. Перед release ещё раз прогнать full regression и clean production build.
4. После отдельного разрешения опубликовать Sprint 3 и выполнить production smoke.
5. Затем — privacy-safe aggregate analytics, multi-device QA и закрытый pilot.
