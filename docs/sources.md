# Источники Waystory

Открытый поиск включён по умолчанию: OSM для POI и местных названий,
Wikidata для идентичности и связей, Wikipedia для истории, Wikivoyage для
контекста поездки. В каталоге сохраняются публичные объекты, не пользовательские
координаты и запросы. Поиск: один радиус 1.5/5/10 км за запрос; клиент расширяет
только пустую выдачу. Общее ограничение 60 cache misses/минуту и 4 параллельных
поиска защищает источники и не ограничивает число рассказов пользователя.

Каждое место объединяется по общим идентификаторам. Одинаковое название рядом
не доказывает, что это один объект. Расхождение координат больше 250 м помечено;
маршрут заменяется поиском по местному названию. Центр полигона не является входом.
Региональная статья явно помечена и не считается историей конкретного здания.
Структурированные геоданные без текста не дают оснований выдумывать рассказ.

## Права и актуальность

Wikidata — CC0; OSM — ODbL и атрибуция, метаданные не используются как исторический
текст. Wikipedia/Wikivoyage — CC BY-SA 4.0; сохраняем revision URL и атрибуцию.
Производный рассказ и аудио помечаем CC BY-SA 4.0. Лицензия статьи не распространяется
автоматически на фотографии. Неизвестные права запрещают text cache/model input.
Кэш истории до 7 дней, visitor-info до 6 часов, пустого ответа 5 минут; максимум
500 документов/10 MiB. Смешанные ответы с непроверенными правами не кэшируются.
Дата проверки не означает свежесть фактов; дата публикации может быть неизвестна.
IDs цитат проверяются сервером, но это не автоматическая проверка истинности фактов.

## Платные источники

По умолчанию выключены. Для Tavily нужны одновременно:

- `WEB_ENRICHMENT_ENABLED=true`, `TAVILY_API_KEY`, положительный `WEB_SEARCH_MAX_CALLS_PER_DAY`.
- В `server/sources/official-domains.json` точный host, enabled, rightsVerified,
  ссылка на разрешение/условия, совместимая лицензия CC0 или CC BY-SA, атрибуция,
  разрешения `allowModelInput=true` и `allowTextCache=true`. Это изменение проходит PR.
- Для включения текста URL должен быть привязан к объекту через официальный website
  в OSM. Имя или соседство не подтверждают идентичность. Редиректы не принимаются.

Исходные домены — кандидаты, права не получены, все выключены. Максимум два
поиска на явное нажатие и три документа. Бюджет общий, атомарный, учитывает ошибки;
безлимит пользовательских рассказов его не отменяет. Он измеряет вызовы, не деньги;
оператор отдельно сверяет стоимость с текущим тарифом Tavily. Без подтверждённого
URL на разрешённом домене поисковые вызовы не выполняются. Политики без права
кэширования отключены: текущий сценарий передаёт документы в последующий запрос
рассказа; одноразовое использование без хранения требует отдельной реализации.
Google Maps grounding, Tripadvisor Terra, Lonely Planet и AWD не подключены:
нужны отдельная проверка API/ключей и права на хранение, переработку и аудио.

## Выпуск и откат

`MULTISOURCE_ENABLED=false` возвращает браузерный поиск Wikipedia. Базы/библиотека
не удаляются. Старые истории читаются; обновление только по кнопке. Секреты `.env`
не попадают в клиент, образ или diagnostic output.

Operations → `sources-test` проверяет три фиксированных публичных места без AI/web
расходов. Discovery и текстовое покрытие оцениваются отдельно: из bounded-выборки
до 3 мест на сценарий Alanya tower и Paris должны дать хотя бы один непустой
model-eligible текст. Sparse coverage может дать ноль; отчёт показывает testedPlaces,
withMaterials, materials и статусы провайдеров. OSM-метаданные не считаются текстом.
Проверка не вызывает LLM/TTS, не проверяет фактологию и не добавляет публичный endpoint.
`web-source-test` — отдельная платная операция, максимум два вызова,
с соблюдением общего бюджета и прав, для реально найденной в каталоге Kızıl Kule
и её явно связанного официального website. Diagnose не делает платных вызовов.

Оценка качества: по 10 объектам в Аланье (центр/редкое покрытие) и другом городе
сравнивать уникальные реальные POI, местные имена, координаты, неверные объединения,
долю историй с источниками, холодную/повторную задержку и платные вызовы.
CI проверяет контракты/интерфейс, не достоверность сгенерированной истории.
Ручная фактологическая оценка и живой AI/audio тест учитываются отдельно от CI.



Выбор отдельного места сначала собирает доступные материалы с обычным кэшем,
затем восстанавливает недостающие явные Wikipedia ссылки из OSM/Wikidata metadata
(до 12 ссылок, отдельный best-effort deadline 3 секунды) и сохраняет полученные refs.
Уже доступные тексты сохраняются при отказе восстановления; отмена пользователя
отменяет весь запрос. Здоровый кэш не требует повторного разрешения upstream ID. Общий discovery сохраняет
лимит 12 ссылок; совпадения по имени/близости не используются. Частично доступные
редакции Wikipedia сохраняют успешные тексты со статусом partial; такой результат
не записывается как здоровый в семидневный кэш и повторяется при следующем запросе.

Обновления каталога сохраняют первый canonical ID и все aliases. Для полей names
хранится source ID владельца, для координат — последнее наблюдение каждого source ID.
Повторный ответ того же источника обновляет его поля; другие источники сохраняются.
Конфликт координат пересчитывается между разными source ID, поэтому исправление
одного источника не конфликтует с его старой точкой. Старые записи без provenance
получают владельца names из первого sourceIds (native — из собственного sourceId);
это совместимая миграция при чтении/записи, без сброса базы.

## Global selected-place acquisition

GLOBAL_SOURCE_DISCOVERY_ENABLED enables the new automatic search path only when a
search key, positive WEB_SEARCH_MAX_CALLS_PER_DAY and reviewed
GLOBAL_WEB_USE_POLICY_JSON are configured. No country/domain list is used for
candidate discovery. The old explicit official-web operation remains separate.
The reviewed JSON requires reviewed=true, an HTTPS termsUrl, reviewedAt,
allowModelInput, allowGeneratedAudio and allowGeneratedTextCache. Raw-text
retention is controlled separately by allowTextCache and ttlMs. Unknown policies
are never silently treated as CC-BY-SA. These flags record an operator review,
not a legal grant from the software.

Acquisition preserves successful providers within a 3-second collection window,
then spends at most 1 second recovering explicit Wikipedia links. The overall
acquisition deadline is 20 seconds. Up to 2 search calls, 8 candidates and 3
accepted web documents are allowed; 4 acquisitions run concurrently, at most 60
new acquisitions per minute. Duplicate requests share work; caller cancellation
stops that caller without duplicating paid work. Refresh bypasses negative cache
but not limits. Retried upstream operations count against provider budgets.

Positive evidence is cached in SQLite only if every document permits retention,
with refresh TTL at most 6 hours and retention no longer than source policy.
Negative results last 15 minutes; transient failures last 30 seconds. Permitted
historical documents may be used during an outage up to their policy TTL and
carry stale=true with the original retrieval date. Visitor information is excluded.
Web evidence is not mixed with open-source narrative text under an invented
common license. Original identity metadata and all used source attributions remain.

Each acquisition emits safe waystory_sources diagnostics with a correlation ID,
public place ID, outcome, provider status/reason and duration. No request text,
user GPS, credentials or document bodies are logged. Diagnose reports global
configuration booleans separately from live coverage. See global-source-evaluation.md
for unverified benchmark candidates and activation limitations.
