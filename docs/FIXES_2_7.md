# VocabFlow – Fixes 2–7

تم إصلاح المشاكل التي ظهرت في التدقيق السابق دون تغيير رقم الإصدار إلى Public Release.

## 2. Legacy migration safety

- أزيلت عملية إسناد البيانات القديمة تلقائيًا إلى أول مستخدم.
- عند اكتشاف صفوف قديمة بدون `user_id` يتوقف التطبيق بدل اختيار حساب عشوائي.
- توجد أداة صريحة: `python migrate_legacy.py --owner-id <existing-user-id>`.
- يمكن أيضًا استخدام `VOCABFLOW_LEGACY_OWNER_ID` للتشغيل/الترحيل لمرة واحدة.
- إعدادات المستخدم القديمة المتعارضة لا تتسبب في كسر `UNIQUE(user_id)`؛ إذا كان للمالك إعدادات موجودة يتم الاحتفاظ بها.

## 3. Sentence Writing persistence

- تقييم Sentence Writing يُرسل إلى `/api/sentence-reviews`.
- الخادم يحسب حالة المراجعة القادمة ويعيد السجل الجديد.
- الواجهة تحدّث حالتها المحلية من نتيجة الخادم بدل حساب جدولة محلية منفصلة.
- يمنع الإرسال المكرر أثناء انتظار الاستجابة.

## 4. Per-user quotas

تمت إضافة حدود صلبة لكل مستخدم:

- 10,000 كلمة
- 10,000 جملة
- 50,000 مراجعة للكلمات
- 50,000 مراجعة للجمل
- 10,000 سجل Quiz
- 10,000 سجل Sentence Quiz
- 10,000 سجل Practice

يتم فحص الحد داخل Flask، ويوجد SQLite trigger كحاجز إضافي ضد تجاوز الحد بسبب طلبات متزامنة.

## 5. Date validation

- `createdAt` يُفحص كـISO-8601.
- التواريخ غير الصالحة أو غير النصية تُرفض.
- التواريخ المستقبلية تُرفض (مع سماح بسيط لفرق الساعة على العميل).
- عند إنشاء كلمة أو جملة، تاريخ الإنشاء النهائي يحدده الخادم.
- عند تعديل عنصر موجود، يبقى `createdAt` الأصلي ولا يستطيع العميل تغييره.
- تواريخ المراجعة لا تأتي من العميل كحالة موثوقة؛ الخادم هو صاحب قرار المراجعة.

## 6. Dependency integrity

- تم تحديث Click إلى `8.5.0`.
- `requirements-lock.txt` يحتوي الآن على SHA-256 hashes للـruntime dependencies.
- يمكن استخدام:

```powershell
python -m pip install --require-hashes -r requirements-lock.txt
```

## 7. pytest cache / release cleanliness

- تمت إضافة `.pytest_cache/` إلى `.gitignore`.
- لا يتم تضمين `.pytest_cache` أو `__pycache__` أو ملفات `.pyc` في الحزمة النهائية.

## Verification

- Python compile check: PASS
- JavaScript syntax check: PASS
- Contract tests: 21 passed
- SQLite legacy-migration smoke test: PASS
- SQLite hard-quota trigger smoke test: PASS

ملاحظة: لم يتم تشغيل Flask runtime/integration suite في بيئة الفحص الحالية لأن Flask/Werkzeug غير مثبتين فيها. هذا لا يعني أن اختبار التشغيل في بيئة التطوير لديك سيفشل؛ يجب تشغيل الاختبارات كاملة بعد تثبيت `requirements-dev.txt`.
