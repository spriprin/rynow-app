# RYNOW — самостоятельный запуск и владение проектом

Обновлено 8 октября 2026 года.

## Короткий ответ

Проект уже принадлежит владельцу, а не ChatGPT:

- исходный код находится в GitHub-репозитории `spriprin/rynow-app`;
- база, Auth и Storage находятся в Supabase-проектах владельца;
- локальная копия может запускаться на любом компьютере с Node.js и Git;
- прежний адрес `*.chatgpt.site` был лишь вариантом размещения frontend, а не частью базы;
- текущий тестовый frontend размещён в собственном Cloudflare-аккаунте владельца на `staging.rynowqr.com`.

ChatGPT/Codex удобен для разработки, но не нужен ни для локального запуска, ни для работы уже размещённого сайта.

### Статус переименования

В интерфейсе, метаданных, изображении предпросмотра, package name и Cloudflare Worker теперь используется RYNOW. Два отображаемых имени проектов в Supabase Dashboard ещё требуется вручную переименовать через **Project Settings → General**: project ref `orkkwgxuzudawiailyen` — в `RYNOW staging`, ref `xwycdnyxuluuhylcnnjh` — в `RYNOW production`. Не создавайте новые проекты и не меняйте refs, URL, ключи или схему ради названия. Подключённый инструмент Supabase может читать проекты, но не изменяет их display name.

Новый browser cookie организатора называется `rynow-organizer-auth`; после смены имени ранее вошедшему организатору может понадобиться войти заново. Данные Rooms и пользователей при этом не удаляются. Старые имена в уже применённых SQL-миграциях и переменных тестового harness сохранены как техническая история/совместимость.

## 1. Что установить на Windows

1. Git: <https://git-scm.com/download/win>
2. Node.js 22.13 или новее: <https://nodejs.org/>
3. pnpm, если команда ещё не установлена:

```powershell
npm install --global pnpm
```

Проверка:

```powershell
git --version
node --version
pnpm --version
```

## 2. Скачать свою копию с GitHub

Выберите обычную папку, например `C:\Projects`, откройте в ней PowerShell и выполните:

```powershell
git clone https://github.com/spriprin/rynow-app.git
cd rynow-app
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
```

После этого проект физически находится на вашем компьютере. Папку можно открыть в VS Code, Cursor или другом редакторе.

## 3. Настроить локальное окружение

Создайте локальный файл из безопасного шаблона:

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Заполните четыре публичных значения:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-STAGING-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_STAGING_KEY
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_TURNSTILE_SITE_KEY=YOUR_PUBLIC_TURNSTILE_SITE_KEY
```

Для повседневной разработки используйте staging, а не production. Publishable key и Turnstile site key предназначены для браузера. Никогда не добавляйте сюда `service_role`, `sb_secret_...`, пароль базы или Turnstile secret. Файлы `.env*` игнорируются Git и не должны попадать в commit.

## 4. Запустить сайт локально

```powershell
pnpm dev
```

Откройте <http://localhost:3000>. Остановка сервера — `Ctrl+C` в окне PowerShell.

Если после нажатия кнопки браузер показывает `ERR_CONNECTION_REFUSED`, проверьте окно PowerShell. Сайт на `localhost` доступен только пока в нём работает `pnpm dev`. Вернитесь в папку `C:\Users\palve\rynow-app`, снова выполните `pnpm dev`, дождитесь строки `Local: http://localhost:3000/` и оставьте окно открытым. Покупка домена эту локальную ошибку не исправит. Если сервер завершится сам, сохраните последние строки из PowerShell: они покажут причину. 7 октября `/demo` и `/organizer` в обычной локальной копии вернули HTTP 200 при работающем сервере.

Перед отправкой изменений в GitHub:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Папки `.vinext`, `.wrangler` и `dist` создаются инструментами сборки. Они исключены из проверки `pnpm lint`: проверять нужно исходный код, а не автоматически созданные файлы.

`pnpm-workspace.yaml` разрешает установочные build scripts только трём используемым инструментам — `esbuild`, `sharp` и `workerd`; общего разрешения на scripts других зависимостей нет.

Обычный цикл обновления кода:

```powershell
git switch main
git pull --ff-only
pnpm install --frozen-lockfile
pnpm dev
```

## 5. Рекомендуемая независимая схема hosting

Для этого репозитория самый прямой путь — Cloudflare Workers: текущая сборка Vinext уже создаёт совместимый Worker и статические assets.

Владельцу нужны собственные аккаунты:

1. GitHub — хранение исходного кода.
2. Supabase — база/Auth/Storage.
3. Cloudflare — Turnstile и размещение frontend Worker.
4. Регистратор домена — только если позже потребуется собственный брендированный адрес.

Первый публичный адрес может быть бесплатным `*.workers.dev`; покупать домен для технической проверки и пилотной подготовки не требуется. Пока аккаунты, recovery email и 2FA принадлежат владельцу, проект не зависит от конкретного разработчика или чата.

### Как изменения кода попадут на опубликованный сайт

Локальное редактирование само по себе меняет только файлы на компьютере. Рабочая цепочка: разработчик или ИИ меняет код → изменения попадают в GitHub Pull Request → владелец проверяет и объединяет его с `main` → Cloudflare Workers Builds собирает `main` и публикует новую версию. После подключения GitHub к Worker новые изменения в `main` могут публиковаться автоматически; статус сборки виден в Cloudflare. Для production разумно оставить отдельный выпуск после проверки staging, чтобы экспериментальный код не попадал к гостям сразу.

Для Workers Builds понадобятся собственный Cloudflare-аккаунт владельца, подключение GitHub-репозитория `spriprin/rynow-app`, команда сборки `pnpm build`, команда deploy из следующего раздела и четыре публичных `NEXT_PUBLIC_*` значения как **build variables**. Укажите адрес этого Worker в `NEXT_PUBLIC_APP_URL`; `localhost` в опубликованной сборке использовать нельзя. Название Worker должно совпадать с именем, используемым при deploy. Staging Worker `rynow-staging-web` уже опубликован вручную; автоматическую сборку из GitHub пока не подключали. Простое изменение файлов на компьютере или в GitHub пока не обновляет опубликованный сайт.

## Перед пилотом с реальными гостями

На 8 октября 2026 года `RYNOW staging` активен, а прежний Supabase-проект `RYNOW production` неактивен. Тестовый frontend опубликован на [staging.rynowqr.com](https://staging.rynowqr.com) и подключён только к `RYNOW staging`; в метаданных страниц запрещена поисковая индексация. Основной `rynowqr.com` пока не подключён к Worker; это не готовый пилот. HTTPS и основные страницы staging ответили HTTP 200. Не выдавайте QR реальным гостям, пока не пройдены следующие проверки:

1. Добавить `https://staging.rynowqr.com` в Supabase Auth URL Configuration и `staging.rynowqr.com` в разрешённые hostnames Turnstile. Проверить реальную пару Turnstile site/secret key через вход нового гостя и организатора, подтверждение email и восстановление пароля. Автоматический тест с фиктивным CAPTCHA-токеном теперь ожидаемо отклоняется Supabase; HTTP 200 страниц не доказывает работу входа.
2. На staging уже включена 60-дневная очистка; пройти отдельный end-to-end тест удаления нового анонимного гостя и аватара с настоящей CAPTCHA, затем проверить мониторинг ежедневного задания. `Delete My Data` пока только создаёт заявку: отдельно реализовать удаление имени, фото и доступа с сохранением общей истории собеседника под нейтральной подписью.
3. Указать юридического оператора и контакт в Terms/Privacy, проверить формулировки для конкретного места проведения и аудитории пилота. Текущие страницы помечены `DRAFT`.
4. Staging platform-admin уже выдан подтверждённому organizer-аккаунту владельца; войти тем же логином на `/admin` и проверить очередь жалоб. Проверить полный цикл фото в Storage, Realtime, модерацию и восстановление после ошибок.
5. Пройти [физический чек-лист](PHYSICAL_QA_RU.md) на iPhone Safari и Android Chrome, затем проверить минимум 40 одновременных гостей через общую сеть/NAT для события от 20 человек. Для более крупного события увеличить нагрузочный тест.
6. Перед публичным пилотом отдельно подготовить совместимый production Supabase, резервную копию, порядок обновления базы и frontend, откат и финальный smoke test. Staging-миграции нельзя считать уже применёнными к production.

Владелец решил остаться на Supabase Free; автоматическая проверка паролей по базе утечек там недоступна. Используйте длинные уникальные пароли и 2FA на аккаунтах владельца. Security Advisor staging не показывает `ERROR`; оставшиеся предупреждения об анонимных гостях и доступных RPC требуют архитектурного контроля, а не механического отключения гостевого входа.

## 6. Первый ручной deploy в свой Cloudflare

Это действие публикует frontend, поэтому выполнять его нужно только после отдельного Go/No-Go.

В корне проекта:

```powershell
pnpm exec wrangler login
pnpm build
pnpm exec wrangler deploy dist/server/index.js --config dist/server/wrangler.json --no-bundle --assets dist/client
```

Первая команда привязывает компьютер к вашему Cloudflare-аккаунту. Вторая создаёт проверенную production-сборку. Третья отправляет её в Cloudflare Workers и возвращает технический адрес `*.workers.dev`.

Перед `pnpm build` создайте игнорируемый файл `.env.production.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PRODUCTION-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PRODUCTION_KEY
NEXT_PUBLIC_APP_URL=https://app.your-domain.com
NEXT_PUBLIC_TURNSTILE_SITE_KEY=YOUR_PRODUCTION_TURNSTILE_SITE_KEY
```

Значения `NEXT_PUBLIC_*` встраиваются в frontend во время сборки. После изменения домена или ключа сайт нужно собрать и опубликовать заново.

Безопасная проверка упаковки без публикации:

```powershell
pnpm exec wrangler deploy dist/server/index.js --config dist/server/wrangler.json --no-bundle --assets dist/client --dry-run
```

Эта точная команда проверена на текущей сборке: Wrangler собрал пакет Worker и завершился на `--dry-run`, не отправляя его в Cloudflare.

## 7. Подключить свой домен

Текущее состояние: Cloudflare Worker `rynow-staging-web` уже привязан к `staging.rynowqr.com`; Cloudflare создал DNS-запись и HTTPS работает. Корневой `rynowqr.com` не привязан к приложению. Не направляйте его на staging-базу как на готовый пилот.

Рекомендуется отдельный адрес вроде `app.your-domain.com`.

1. Добавьте домен в свой Cloudflare-аккаунт и переключите его nameservers у регистратора.
2. Выполните первый Worker deploy и убедитесь, что технический `workers.dev` адрес открывается.
3. В Cloudflare откройте **Workers & Pages → ваш Worker → Settings → Domains & Routes → Add → Custom Domain**.
4. Введите `app.your-domain.com`. Cloudflare создаст DNS-запись и TLS-сертификат.
5. Если нужен и `www`, и корневой домен, выберите один основной адрес, а со второго сделайте redirect.

## 8. Что обязательно поменять вместе с доменом

### В сборке frontend

Укажите новый адрес в `.env.production.local`:

```env
NEXT_PUBLIC_APP_URL=https://app.your-domain.com
```

Код больше не содержит обязательного fallback на `chatgpt.site`: Auth redirects используют настроенный адрес или текущий безопасный HTTPS-origin браузера.

### В Supabase Auth

В **Authentication → URL Configuration**:

- Для текущего `RYNOW staging` установите Site URL `https://staging.rynowqr.com` и добавьте точные Redirect URLs:
  - `https://staging.rynowqr.com/organizer?auth=confirmed`
  - `https://staging.rynowqr.com/organizer?recovery=1`
- Не меняйте настройки отдельного production-проекта ради проверки staging.

При будущем выпуске production:

- Site URL: `https://app.your-domain.com`
- Redirect URLs:
  - `https://app.your-domain.com/organizer?auth=confirmed`
  - `https://app.your-domain.com/organizer?recovery=1`
  - `http://localhost:3000/**` для локальной разработки

Для production лучше разрешать точные пути, а не широкий wildcard.

### В Cloudflare Turnstile

Откройте Turnstile widget → Settings и добавьте `staging.rynowqr.com` в разрешённые hostnames текущего staging-виджета. При будущем production-выпуске добавьте также его hostname. Public site key остаётся во frontend env. Secret остаётся только в настройках Supabase Auth CAPTCHA.

### После переключения

Проверьте:

1. `/`, `/organizer`, `/privacy`, `/terms` открываются по HTTPS.
2. Signup, подтверждение email, login и password recovery возвращают на новый домен.
3. QR ведёт на новый `/r/{join_code}`.
4. Turnstile работает на новом hostname.
5. Guest может войти в staging Room, а organizer видит только свои Rooms.

Старый `chatgpt.site` адрес можно оставить на короткий переходный период, но новые QR и ссылки должны использовать только собственный домен.

## 9. Решение по Supabase Free

Владелец решил не переходить на Pro. Поэтому Advisor продолжит показывать `auth_leaked_password_protection`: на Free нельзя включить автоматическую проверку пароля по базе утечек.

Рабочая компенсация до отдельной реализации MFA:

- отдельный случайный пароль не короче 16 символов для каждого organizer/admin;
- password manager вместо повторного использования пароля;
- email confirmation для постоянных аккаунтов;
- 2FA на GitHub, Supabase, Cloudflare, регистраторе и почте владельца;
- не выдавать platform-admin обычным organizer-аккаунтам;
- рассмотреть TOTP MFA в самом приложении до реального административного доступа.

## 10. Минимальный набор для независимости

Храните у владельца компании:

- доступ и recovery codes от GitHub, Supabase, Cloudflare и регистратора;
- список production/staging project refs и публичных ключей;
- приватный список секретов и место их хранения, но не сами секреты в Git;
- резервную копию DNS-записей;
- инструкции из этого файла и физический QA checklist;
- хотя бы ещё одного доверенного администратора аккаунтов на случай потери доступа.

Исходный код плюс эти четыре owner-controlled аккаунта достаточны, чтобы другой разработчик продолжил проект без ChatGPT/Codex.

## Официальные справочники

- Cloudflare Workers custom domains: <https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>
- Cloudflare Turnstile widget/hostnames: <https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/>
- Supabase Auth Site URL и redirect URLs: <https://supabase.com/docs/guides/auth/redirect-urls>
- Supabase MFA: <https://supabase.com/docs/guides/auth/auth-mfa>
