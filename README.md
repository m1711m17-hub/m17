# M17

تطبيق تواصل اجتماعي عربي (RTL) — واجهة ويب (HTML/CSS/JS بدون أطر) داخل Capacitor، والخلفية Supabase.

- `www/` الواجهة: `js/lib` (عميل Supabase خفيف + أدوات DOM)، `js/pages` (الصفحات)، `css/app.css`.
- قاعدة البيانات: جداول + سياسات RLS + دوال الإدارة + سجل التدقيق + تخزين الملفات (مُطبّقة على مشروع Supabase `m17`).
- الدخول باسم المستخدم وكلمة المرور؛ الحسابات تُنشأ عبر Edge Function باسم `signup`.
- إعداد اتصال WebRTC موجود في `www/js/config.js`: خوادم STUN/TURN احتياطية، مع محاولة جلب بيانات TURN مؤقتة من Edge Function باسم `turn-credentials`.
- يجب ضبط أسرار خدمة TURN داخل Edge Function وعدم وضع أسرار مزوّد TURN طويلة الأمد داخل التطبيق.
- بناء APK: شغّل الـ workflow `Build M17 APK` من تبويب Actions ثم نزّل `M17-apk`.
- الـ APK الناتج من هذا الـ workflow نسخة debug للاختبار، وليس إصداراً موقّعاً للنشر على المتجر.
