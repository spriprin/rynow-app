# HERE — самостоятельный запуск и владение проектом

Актуально на 29 сентября 2026 года.

## Короткий ответ

Проект уже принадлежит владельцу, а не ChatGPT:

- исходный код находится в GitHub-репозитории `spriprin/rynow-app`;
- база, Auth и Storage находятся в Supabase-проектах владельца;
- локальная копия может запускаться на любом компьютере с Node.js и Git;
- текущий адрес `*.chatgpt.site` — только один вариант размещения frontend, а не часть базы и не обязательная зависимость приложения;
- новый frontend можно разместить в собственном Cloudflare-аккаунте и подключить собственный домен.

ChatGPT/Codex удобен для разработки, но не нужен ни для локального запуска, ни для работы уже размещённого сайта.

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

Перед отправкой изменений в GitHub:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

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
3. Регистратор домена — право собственности на домен.
4. Cloudflare — DNS, Turnstile и размещение frontend Worker.

Пока эти аккаунты, recovery email и 2FA принадлежат владельцу, проект не зависит от конкретного разработчика или чата.

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

- Site URL: `https://app.your-domain.com`
- Redirect URLs:
  - `https://app.your-domain.com/organizer?auth=confirmed`
  - `https://app.your-domain.com/organizer?recovery=1`
  - `http://localhost:3000/**` для локальной разработки

Для production лучше разрешать точные пути, а не широкий wildcard.

### В Cloudflare Turnstile

Откройте Turnstile widget → Settings и добавьте `app.your-domain.com` в разрешённые hostnames. Public site key остаётся во frontend env. Secret остаётся только в настройках Supabase Auth CAPTCHA.

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
