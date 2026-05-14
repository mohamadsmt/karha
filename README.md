# کارها

کارها یک تسک‌منیجر لوکال، فارسی و RTL-first است. هدف نسخه اول این است که
سادگی Todoist/Things را با چند قابلیت کاربردی TickTick ترکیب کند، بدون sync،
telemetry یا ذخیره داده شخصی داخل ریپو.

## قابلیت‌ها

- UI مینیمال شبیه Todoist: ناوبری کم‌نویز، ردیف‌های separator-style،
  ابزارهای پیشرفته در بخش جمع‌شونده، drawer جزئیات به جای پنل دائمی، و سوییچ
  تم روشن/تیره با ذخیره انتخاب روی همین مرورگر.
- ورودی سریع فارسی با تشخیص `امروز`، `فردا`، روزهای هفته، `هفته بعد`، تاریخ
  جلالی مثل `۱۴۰۵/۰۲/۲۰`، ساعت‌هایی مثل `ساعت ۹`، پروژه با `#کار`، بخش با
  `/جلسه`، برچسب با `@ایمیل`، اولویت با `!1` تا `!4` و تکرارهایی مثل
  `هر روز`، `هر هفته` و `هر ماه`.
- Inbox، امروز، پیش‌رو، پروژه‌ها، بخش‌ها، برچسب‌ها، اولویت‌ها، subtasks،
  توضیح، deadline، reminder، duration، کامنت/فعالیت شخصی، جستجو و فیلترهای
  ذخیره‌شده؛ برچسب‌های روی هر تسک از داخل drawer قابل حذف یا ویرایش هستند.
- تکمیل‌شده‌های مرتبط در صفحات امروز، پروژه و برچسب زیر یک separator جدا
  نمایش داده می‌شوند و این بخش برای هر صفحه قابل جمع/باز کردن و ذخیره‌شدن
  است؛ آرشیوشده‌ها هم از نمای آرشیو قابل مشاهده و بازگردانی هستند.
- مرتب‌سازی دستی با drag and drop برای تسک‌های هم‌سطح و زیرتسک‌های هم‌والد؛
  زیرتسک‌ها زیر parent با تورفتگی درست نمایش داده می‌شوند و قابلیت collapse،
  تکمیل و بازکردن دوباره دارند.
- امروز شامل تسک‌های عقب‌افتاده و امروز است؛ پیش‌رو بر اساس روزهای
  فارسی/جلالی گروه‌بندی می‌شود.
- نمای تقویم ماهانه/هفتگی/agenda، ماتریس آیزنهاور، عادت‌ها، Pomodoro/focus و
  آمار پایه.
- میانبرهای کیبورد: `q` برای افزودن سریع، `/` برای جستجو، `g` سپس `i/t/u`
  برای رفتن به Inbox/Today/Upcoming، `j/k` برای حرکت، `Enter` برای باز کردن
  drawer، `x` برای تکمیل، `Delete` برای آرشیو، `1..4` برای اولویت، `d` برای
  زمان‌بندی امروز و `?` برای راهنمای میانبرها.
- undo toast برای تکمیل، آرشیو، تغییر تاریخ و جابه‌جایی دستی.
- SQLite لوکال با migrationهای ساده.
- export/import JSON و export CSV.

## اجرا

```bash
npm install
npm run dev
```

رابط کاربری روی `http://127.0.0.1:5173` و API روی `http://127.0.0.1:3737`
اجرا می‌شود.

برای نسخه build شده:

```bash
npm run build
npm run start
```

## محل ذخیره داده

این checkout برای استفاده شخصی با فایل ignored `.env.local` به دیتابیس داخل
خود دایرکتوری پروژه وصل شده است:

```text
.local-data/karha.sqlite
```

`.local-data/`، فایل‌های SQLite، backupها، exportها و `.env.local` در
`.gitignore` هستند و نباید روی GitHub بروند.

اگر `.env.local` وجود نداشته باشد، مسیر پیش‌فرض سیستم‌عامل استفاده می‌شود:

- macOS: `~/Library/Application Support/karha/karha.sqlite`
- Linux: `~/.local/share/karha/karha.sqlite`
- Windows: `%APPDATA%/karha/karha.sqlite`

اگر مسیر سفارشی می‌خواهید:

```bash
TASKS_DATA_DIR=/absolute/path/outside/repo npm run dev
```

اگر `TASKS_DATA_DIR` داخل خود ریپو باشد، برنامه عمدا اجرا را متوقف می‌کند مگر
اینکه مثل تنظیمات شخصی همین checkout، `KARHA_ALLOW_REPO_DATA=1` ست شده باشد.
این flag را فقط برای مسیرهای ignored مثل `.local-data/` استفاده کنید.

## API محلی

مسیرهای اصلی:

- `GET/POST/PATCH/DELETE /api/tasks`
- `POST /api/tasks/quick-add`
- `GET/POST /api/tasks/:id/comments`
- `POST /api/tasks/:id/reorder`
- `POST /api/tasks/:id/reschedule`
- `GET/POST /api/projects`
- `GET/POST /api/tags`
- `GET/POST /api/habits`
- `POST /api/habits/:id/log`
- `GET/POST /api/focus-sessions`
- `GET/POST /api/saved-filters`
- `DELETE /api/saved-filters/:id`
- `GET /api/stats`
- `GET /api/backup/export`
- `POST /api/backup/import`
- `GET /api/backup/csv`
- `GET /api/settings`

## توسعه

```bash
npm run lint
npm run test
npm run build
git diff --check
```

این پروژه telemetry ندارد و هیچ داده‌ای به بیرون ارسال نمی‌کند.
