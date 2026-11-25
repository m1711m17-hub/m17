# M17

تطبيق تواصل اجتماعي عربي (RTL) — واجهة ويب (HTML/CSS/JS بدون أطر) داخل Capacitor، والخلفية Supabase.

- `www/` الواجهة: `js/lib` (عميل Supabase خفيف + أدوات DOM)، `js/pages` (الصفحات)، `css/app.css`.
- قاعدة البيانات: جداول + سياسات RLS + دوال الإدارة + سجل التدقيق + تخزين الملفات (مُطبّقة على مشروع Supabase `m17`).
- الدخول باسم المستخدم وكلمة المرور؛ الحسابات تُنشأ عبر Edge Function باسم `signup`.
- بناء APK: شغّل الـ workflow `Build M17 APK` من تبويب Actions ثم نزّل `M17-apk`.

- المجموعات: شغّل `database/groups.sql` مرة واحدة في Supabase SQL Editor قبل استخدام صفحة المجموعات والمحادثات الجماعية.
