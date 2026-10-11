# Waystory Multiple Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Альтернатива при явно выбранной работе агентами — superpowers:subagent-driven-development. Целевой исполнитель: Sol. Не запускать реализацию только потому, что открыт этот документ; текущая задача была подготовить план.

**Goal:** Находить больше реальных мест и создавать проверяемые рассказы из нескольких источников, сохраняя исходные имена и координаты.

**Architecture:** Серверный каталог мест, независимые адаптеры источников, ограниченный сбор материалов и генерация с source ID. Поиск объектов отделён от платного обогащения. Клиент продолжает пользоваться существующим плеером, библиотекой и картографическими ссылками.

**Tech Stack:** Node.js 22/24, ESM, native fetch, node:sqlite, node:test, существующий Playwright smoke test; без обязательного MCP SDK и новых сервисов БД.

**Spec:** [2026-10-11-multiple-sources.md](../specs/2026-10-11-multiple-sources.md)

## Global Constraints

- Языки интерфейса/рассказа `ru`, `en`; источники первой очереди `ru`, `en`, `tr`.
- Не менять Google OAuth, приглашения и текущий безлимит AI/TTS для вошедших пользователей.
- Ключи только на сервере; тесты CI — только fixtures, без платных запросов.
- Не хранить историю геопозиции; не логировать координаты, вопросы, source text и секреты.
- Не добавлять PostgreSQL, Redis, векторную БД, новый UI framework и произвольный web-fetch endpoint.
- Сохранять текущий device speech fallback, накопительную подробность, паузу, карты и старую библиотеку.
- Лицензирование/атрибуция относятся к каждой записи источника, а не к адаптеру в целом.
- Никаких shell-действий от пользователя для обычной диагностики и деплоя.

## Review Focus

1. Одноимённые соседние район, мечеть и остановка: не объединять по имени/близости — тесты задач 1–2.
2. Координаты центра района вместо входа: сохранить тип точности и подписать назначение ссылки — задачи 1, 5.
3. Региональный текст, устаревший отзыв или противоречащие даты: не выдавать за точный свежий факт объекта — задачи 3–4.
4. Старые записи localStorage, офлайн и переключение карточки во время загрузки: не терять данные и не показывать чужой ответ — задача 5.
5. SSRF, инструкции внутри источника и платный поиск при безлимитном аккаунте: проверять происхождение, scope, ограничивать операции провайдера — задачи 2, 4, 6.

## Стартовая точка: прочитать до реализации

Репозиторий `pastukhov/Waystory`, рабочая копия при подготовке `/workspace/sites/poputi`. Production `https://ws.nayg.ru`. План проверен после PR #19; перед началом получить актуальный `main`, не опираться на локальные SHA: ранее публикация через connector создавала другую историю при одинаковых файлах.

| Сейчас | Что учитывать |
|---|---|
| `dist/wiki.mjs` | Браузерный поиск Wikipedia ru/en/tr, dedup по Wikidata, координаты; `loadPlace` сразу возвращает старые `blocks` |
| `dist/app.mjs` | `selectPlace`, `ask`, `translateDiscovery`, `translateLibrary`, epoch/cancellation; сейчас отправляет текст источника с клиента |
| `dist/maps.mjs` | `mapLink(place)`, `originalPlaceName(place)`; координаты = маршрут, иначе поиск оригинала |
| `dist/language.mjs` | `STORY_VERSION=2`, критерий повторного использования рассказа |
| `server/guide.mjs` | Валидация payload, Wikipedia-only URL, source text max 14000; prompt, JSON schema, валидация блоков, memory cache |
| `server/index.mjs` | HTTP API, allowlisted endpoints для auth, POST Origin checks, cancellation; новые routes сами автоматически не защищаются |
| `server/auth.mjs` | SQLite аккаунтов и request quotas; не смешивать с каталогом или материалами |
| `server/diagnostics.mjs` | Allowlisted provider logs; новые типы нужно добавлять явно и тестировать |
| `scripts/standalone.mjs` | Явный список frontend-модулей для HTML-сборки; каждый новый модуль добавить сюда |
| `.github/workflows/ci.yml` | Тесты Node22/24, Docker, mobile Playwright, `Required checks` |
| Operations/Deploy | Идемпотентный `ops/request.json`; не запускать платные тесты на каждом deploy |

README частично устарел (в частности про демо на главной). Источник истины — код и действующие tests; обновить затронутые разделы в соответствующих PR.

## Зафиксированные интерфейсы

Ниже TypeScript-подобная запись для документации; реализация остаётся JavaScript с runtime validation.

```ts
type Language = 'ru' | 'en';
type Provider = 'wikipedia' | 'wikidata' | 'osm' | 'wikivoyage' | 'official-web';
type PlaceRef = {provider:'wikipedia', language:'ru'|'en'|'tr', pageId:number}
  | {provider:'wikidata', id:string} // строго Q + цифры
  | {provider:'osm', kind:'node'|'way'|'relation', id:number};
type PlaceRecord = {
  id:string; // неизменяемый ID первой записи: wiki:<lang>:<pageId>, wd:<QID>, osm:<kind>:<id>
  refs:PlaceRef[];
  names:{original:string, native?:{text:string,language?:string,sourceId:string}, ru?:string,en?:string};
  coordinates:null|{lat:number,lon:number,kind:'point'|'centroid'|'unknown',sourceId:string};
  category:string; sourceIds:string[];
};
type SourceDocument = {
  id:string; provider:Provider; url:string; title:string; language:string;
  kind:'identity'|'history'|'visitor-info'|'opinion'|'legend';
  scope:'place'|'area'; placeIds:string[];
  retrievedAt:string; publishedAt:string|null; updatedAt:string|null;
  text:string; revision:string|null;
  license:{id:string,url:string|null,attribution:string,policyId:string};
};
type SourceStatus = {provider:Provider,status:'ok'|'empty'|'unavailable'|'disabled'|'budget-exhausted'};
type SourceBundle = {place:PlaceRecord,documents:SourceDocument[],statuses:SourceStatus[],fingerprint:string};
```

`sourceId` карточки должен разрешаться в provenance-запись (identity document может иметь пустой text). Отдавать клиенту `sources` как метаданные документов без полного текста. Сохранять `id` после обогащения, новые внешние IDs добавлять в refs; alias-таблица сопоставляет старые wiki IDs. Координаты только finite, диапазоны ±90/±180; неизвестные = null, не `[0,0]`. При `coordinateConflict` поле coordinates остаётся выбранным provenance-кандидатом для диагностики, но toLegacyPlace передаёт coords=null: UI предлагает поиск, а не маршрут к спорной точке.

Адаптер: `createXProvider({fetchFn,now,policy,requestGate})` возвращает методы по возможностям: `nearby({lat,lon,radius,language,signal})`, `search({query,language,signal})`, `resolve(ref,{signal})`, `documents(place,{language,signal})`. Результат каждого метода `{places:PlaceRecord[],documents:SourceDocument[],status:SourceStatus}`. Поддерживаемые методы фиксируются в registry, неподдерживаемые не вызываются. `fetchFn` не разделять случайно с mock Yandex fetch: отдельная зависимость `sourceFetchFn` в createApp.

API:
- `GET /api/places/nearby?lat=&lon=&radius=&language=` — публично, только открытые источники; `{places,sources,statuses}`.
- `GET /api/places/search?q=&language=` — публично, Wikipedia search + имеющийся локальный каталог; Overpass не используется как глобальный текстовый поиск.
- `POST /api/places/resolve` `{ref,language}` — вход + Origin, только открытые источники; гидратация старой библиотеки/нового ID. Нет произвольных URL и текста.
- `POST /api/guide` story/question принимает `{action,placeId,language,question?,heardBlockIds?}`. Сервер сам собирает bundle. Старый `{place:{...}}` временно поддерживается через разбор допустимого Wikipedia URL и resolve; присланный `place.text` не считается проверенным источником.
- `POST /api/places/enrich` `{placeId,language}` — вход + Origin, явный платный web-поиск, только после задачи 6.

## Этапы и задачи (один PR на задачу)

### 1. Модель, лицензии, каталог и совместимость IDs

**Files:** create `server/places/model.mjs`, `server/places/store.mjs`, `server/sources/policies.mjs`; tests `tests/place-model.test.mjs`, `tests/place-store.test.mjs`; config `.env.example`.

**Interfaces:** `normalizePlace(raw) -> PlaceRecord`, `mergePlaces(records) -> PlaceRecord[]`, `createPlaceStore({dbPath,now}) -> {upsert,getById,getByRef,close}`, `sourcePolicy(policyId) -> {allowModelInput,allowTextCache,ttlMs,attributionRequired}`.

- [ ] Написать тесты: одинаковый QID объединяется с сохранением ID первой записи; разные QID с одинаковым именем остаются разными; OSM relation и node без общей ссылки не сливаются; две точки с общей сущностью на расстоянии >250 м дают конфликт и не меняют ранее выбранную точку. Имена не теряют `ı/İ/ç/ğ/ş`.
- [ ] Проверить FAIL, реализовать модель и deterministic merge; конфликт хранить в отдельном поле `coordinateConflict` с двумя кандидатами для диагностики/интерфейса. Не строить маршрут из конфликтующей карточки.
- [ ] SQLite каталог в `SOURCE_DB_PATH=/app/data/sources.sqlite` (локально `data/sources.sqlite`), отдельный от auth. Additive migrations, WAL, close on server close. Не сохранять пользовательские поиски и исходную геопозицию.
- [ ] Политики initial: Wikidata CC0, OSM ODbL metadata, Wikipedia/Wikivoyage CC-BY-SA-4.0 c атрибуцией и revision URL. Не считать автоматически все картинки лицензированными так же. Unknown policy = запрещён model input/text cache, только ссылка. Для CC BY-SA хранить версию и атрибуцию, отмечать переработку; определить совместимую лицензию производного текста/аудио до публикации, не считать перефразирование автоматическим снятием ShareAlike. Для несовместимых прав исключать материал из общего генерируемого рассказа, оставляя отдельную ссылку.
- [ ] Run `node --test tests/place-model.test.mjs tests/place-store.test.mjs`, затем `npm test`; PASS. Commit `feat: add source-aware place catalog`.

### 2. Поиск OSM/Wikidata/Wikipedia и публичные endpoints

**Files:** create `server/sources/http.mjs`, `server/sources/wikipedia.mjs`, `server/sources/osm.mjs`, `server/sources/wikidata.mjs`, `server/places/service.mjs`; modify `server/index.mjs`, `server/config.mjs`, `.env.example`; tests `tests/source-http.test.mjs`, `tests/place-discovery.test.mjs`, `tests/places-http.test.mjs`; fixtures `tests/fixtures/sources/`.

**Interfaces:** адаптеры выше; `createPlaces({store,providers,now}) -> {nearby,search,resolve,collect}`. `collect` возвращает SourceBundle; до задачи 3 только Wikipedia/Wikidata документы.

- [ ] Fixtures: Alanya — башня с ru/en/tr именами, мечеть без Wikipedia, одноимённый район; второй набор — пустая ru Wikipedia; третий — объект вне Турции. Все fixtures статические, с происхождением/лицензией, не реальные пользовательские координаты.
- [ ] Тесты FAIL: один провайдер timeout, другие дают места; все недоступны != empty; недопустимые координаты/язык/радиус ->400 без upstream; URL/Overpass injection не исполняется; abort прекращает оставшиеся запросы.
- [ ] `sourceFetch(url,{signal,maxBytes,timeoutMs})`: только фиксированные HTTPS API hosts, redirect:error, 10 s на запрос, 2 MiB ответ, общий deadline discovery 15 s, максимум 4 upstream запроса одновременно, без скрытых retries. Endpoints из server config, не из запроса/LLM. OSM endpoint выбирается оператором, не failover на случайные публичные instances.
- [ ] Nearby radius: 1500 по умолчанию, допускается 1500/5000/10000; максимум 30 результатов. Начальный выпуск: один radius на запрос, клиент увеличивает при пустой выдаче максимум до 10000. Публичные cache misses ограничить общим gate 60/min и concurrency=4 на процесс; вернуть 429 с Retry-After. Это защита upstream, не новый AI user quota.
- [ ] OSM: fixed Overpass query для `tourism` (museum, attraction, viewpoint, artwork, gallery) и `historic`; не все здания/магазины. Point для nodes, centroid для ways/relations. Забрать `name`, `name:ru`, `name:en`, `name:tr`, `wikidata`, `wikipedia`, `website` как метаданные; website не скачивать автоматически.
- [ ] Wikidata: batch `wbgetentities` максимум 30 QIDs, labels/aliases/claims/sitelinks. Native name P1705; координаты P625 только для Земли; связи с Wikipedia/Wikivoyage. Не строить общепланетный SPARQL запрос на каждую прогулку.
- [ ] Wikipedia серверный адаптер сохраняет текущие edition fallback и extracts; не импортировать браузерный модуль с global fetch. `/api/places/search` ограничить q 2–200 символами. Обработчики query auth не нужны, но paid adapters исключены registry allowlist.
- [ ] Run новые tests + `npm test`, Docker smoke. Commit `feat: discover places from open geographic sources`.

### 3. Wikivoyage и ограниченный сбор материалов

**Files:** create `server/sources/wikivoyage.mjs`, `server/sources/collect.mjs`, `server/sources/cache.mjs`; extend store with source_documents; tests `tests/source-collection.test.mjs`.

**Interfaces:** `collectSources(place,{language,signal,includeWeb:false}) -> SourceBundle`; `bundleFingerprint(place,documents,policyVersion) -> string`.

- [ ] Тесты FAIL: путеводитель по Аланье не становится историей конкретной мечети; одинаковые revision не дублируются; конфликт дат остаётся видимым; неизвестные даты = null; запрещённый policy не попадает в prompt/cache.
- [ ] Wikivoyage через MediaWiki API, прямой sitelink объекта или административного региона Wikidata P131 (не более двух переходов). Региональные документы `scope:area`; без надёжной связи не выбирать статью по похожему названию. Иерархия place→region сохраняется в метаданных документов, UI подписывает региональные источники.
- [ ] Сбор: максимум 6 документов, каждый ≤6000 символов, общий context ≤18000 символов. Сначала объектные/официальные исторические материалы, затем региональный контекст. Структурированные identity facts отдельно от текстов; не превращать координаты/теги в выдуманную историю.
- [ ] Кэш разрешённых открытых текстов: history 7 дней, visitor-info 6 часов, negative 5 минут; максимум 500 документов и 10 MiB текста, LRU eviction. Policy с меньшим TTL имеет приоритет. Single-flight по place+language+provider; отмена одного клиента не отменяет запрос другим подписчикам.
- [ ] Fingerprint включает source IDs, revision/content hash, policy version, place refs; изменённый источник инвалидирует AI cache. Expired visitor-info не выдавать как актуальное при отказе upstream.
- [ ] Run `node --test tests/source-collection.test.mjs` + `npm test`. Commit `feat: collect attributed travel guide sources`.

### 4. Генерация с источниками и защита новых API

**Files:** modify `server/guide.mjs`, `server/index.mjs`, `dist/language.mjs`; create `server/sources/evidence.mjs`; tests `tests/grounded-guide.test.mjs`, extend `tests/auth-http.test.mjs`, `tests/ai.test.mjs`.

**Interfaces:** `createGuide({...existing,collectSources})`; output story `{title,language,storyVersion:3,detailLimited,blocks:[{id,title,depth,text,sourceIds:string[]}],sources:[publicMetadata]}`; question `{text,sourceIds,sources}`. `publicMetadata` = SourceDocument без text, плюс признак лицензии; URL берётся только из server bundle.

- [ ] Тесты FAIL: неизвестный source ID/пустые ссылки у factual блока отклоняются; source prompt injection не меняет инструменты/инструкции; payload с произвольным URL/поддельным source text не вызывает fetch; 401/403 не вызывает ни LLM, ни enrichment.
- [ ] Поддержать `placeId` и legacy Wikipedia ref. Для legacy parse только разрешённые editions/curid/wiki title; получить canonical page ID через API, не скачивать пользовательский URL. `question` максимум 500 символов, heardBlockIds максимум 20; проверять их по server story cache, не доверять клиентскому heard text. Если cache утрачен после рестарта, отвечать по bundle без утверждения о том, что пользователь уже слышал; это не должно ломать вопрос или запускать автоматическую регенерацию всего рассказа.
- [ ] Сохранить identify/translatePlaces контракты; новая обработка только story/question. Вход + canonical Origin проверить также для resolve/enrich (явно добавить routes в auth dispatch). Auth quota consume для story/question остаётся как сейчас; не списывать его ещё раз внутри collect.
- [ ] Prompt разделяет source type/scope/dates, сохраняет native/original spelling, не выдумывает транспорт/вход. Citation IDs подтверждают принадлежность материалу, а не истинность — тесты не должны объявлять факт проверенным только из-за ссылки.
- [ ] Для отсутствующих текстовых доказательств вернуть 422 `Недостаточно источников для рассказа об этом месте.` без LLM-вызова. Клиент оставляет карту. Для внешнего отказа 503 с отдельным статусом; не подменять отсутствием места.
- [ ] Story cache key включает version=3, language, bundle fingerprint и выбранную модель. Старые сохранённые истории остаются читаемыми, но не представляются заново проверенными. Их обновление — явное действие, не массовая фоновая генерация.
- [ ] Run новые tests, весь `npm test`, Node22/24 CI. Commit `feat: ground narration and answers in cited sources`.

### 5. Клиент: новые места, источники, библиотека и карты

**Files:** create `dist/places-client.mjs`, `dist/sources-view.mjs`; modify `dist/app.mjs`, `dist/index.html`, `dist/styles.css`, `dist/i18n.mjs`, `dist/maps.mjs`, `dist/core.mjs`, `scripts/standalone.mjs`, `scripts/ci-browser-smoke.cjs`; tests `tests/places-client.test.mjs`, `tests/maps.test.mjs`, `tests/core.test.mjs`.

**Interfaces:** `discoverNearby`, `searchCatalog`, `resolvePlace` вызывают новые endpoints; `toLegacyPlace(record,sources,language)` сохраняет поля текущего UI (`title`, `originalTitle`, `coords`, `source`) и добавляет `placeId`, `nativeName`, `coordinateKind`, `sources`. `source` может отсутствовать: OSM-only карточка всё равно работает.

- [ ] Тесты FAIL: old localStorage wiki-* запись читается и сохраняет id; resolve error не стирает её; карта без координат = name search; centroid/conflict корректно подписаны; русский перевод не заменяет nativeName. Региональные источники явно отличимы от объектных.
- [ ] Перевести discovery на same-origin API, `selectPlace`/`ask` — на placeId; photo identify query продолжает работать через searchCatalog. Статический standalone без API сохраняет старый Wikipedia discovery fallback, но не заявляет платную multi-source поддержку.
- [ ] Блок «Источники»: заголовок, провайдер, язык, дата публикации/обновления если есть, отдельно дата проверки, атрибуция/лицензия, ссылки у блоков. Safe https anchors, textContent, без сырого HTML. Удалить жёсткие «Материалы Википедии» для mixed/OSM мест.
- [ ] Места без рассказа остаются на карте; объяснение с кнопкой повторного поиска материалов. Исходные имена и nativeName показывать отдельно с понятной подписью, не дублировать совпадающие строки.
- [ ] Сохранить epoch guards, не менять выбранный объект поздним ответом. Отказ одной системы — ненавязчивое уведомление о частичных результатах. Добавить i18n RU/EN для всех новых состояний.
- [ ] Browser fixtures RU/EN: OSM-only место; mixed sources; отказ Wikivoyage; быстрый переход A→B; old saved story; widths320/390/780; source links; cloud/device speech regression. В standalone добавить новые modules и проверить сборку.
- [ ] Run `npm test`, `node scripts/ci-browser-smoke.cjs`, `node scripts/standalone.mjs`; CI browser при локальном sandbox запрете запуска. Commit `feat: show multi-source places and citations`.

### 6. Опциональный поиск официальных материалов через Tavily

**Files:** create `server/sources/tavily.mjs`, `server/sources/official-domains.json`, `server/sources/budget.mjs`; modify collect/index/config/.env.example; UI enrich button; tests `tests/web-enrichment.test.mjs`, `tests/source-budget.test.mjs`.

**Interfaces:** `enrichPlace(place,{language,signal}) -> SourceBundle`; `reserveProviderCall({provider,day}) -> boolean` atomic SQLite. Endpoint `/api/places/enrich` не принимает список URL/domains от клиента.

- [ ] По умолчанию `WEB_ENRICHMENT_ENABLED=false`, `TAVILY_API_KEY=''`, `WEB_SEARCH_MAX_CALLS_PER_DAY=0`. Отсутствие ключа или бюджета = disabled, Wikipedia/open-data продолжают работать. Эти условия видны Sol как внешняя зависимость, не как причина остановить задачи1–5.
- [ ] Domains policy содержит exact hosts, права на model input/storage, атрибуцию и ссылку на проверенные условия/разрешение. Не включать весь `.gov` и не считать robots.txt лицензией. Начальные турецкие сайты — кандидаты с disabled policy, пока права не установлены; metadata/search links можно показывать отдельно, если разрешено провайдером.
- [ ] Два поиска максимум на нажатие (местный язык, затем язык интерфейса), до5 результатов каждый, до3 разрешённых документов в bundle, общий deadline20s. Только Tavily official API; не добавлять автономный crawler/Firecrawl одновременно. Проверять возвращённые hosts и relevance по идентичности места; nearby name совпадения недостаточно.
- [ ] Тесты FAIL: anonymous не тратит ключ; exhausted global budget не вызывает провайдера; 10 параллельных запросов не превышают остаток бюджета; failed calls учитываются; unlimited AI user не обходит web budget; поддомен-обман, localhost, redirects, prompt injection и неизвестная лицензия не попадают в model input.
- [ ] Rate-limit одного и того же place+language через single-flight/cache, retry только явным новым действием. Число платных вызовов/исход без текста логируются. Бюджет — calls, не денежная сумма; стоимость показывать оператору по текущему тарифу отдельно.
- [ ] Run новые tests + полный CI. Commit `feat: add opt-in official-source web enrichment`.

### 7. Диагностика, rollout и документирование

**Files:** modify `scripts/ops-probe.mjs`, `scripts/ops-request.mjs`, `scripts/operations-vm.sh`, `.github/workflows/operations.yml`, `docs/operations.md`, `.env.example`, README; create `docs/sources.md`; tests `tests/ops.test.mjs`.

- [ ] Ввести `MULTISOURCE_ENABLED=false` при промежуточных PR; после задач1–5 тестового rollout можно изменить default на true в отдельном PR. При false сохранить legacy Wikipedia flow; rollback не требует удаления SQLite или localStorage.
- [ ] `sources-test` — фиксированные три public fixture locations, без AI/web calls, bounded open-data queries. `web-source-test` — отдельная явно платная операция с фиксированным запросом и лимитом2. Защитить existing idempotency и main-only runner; не объединять оба теста в обычный diagnose.
- [ ] Обычный diagnose сообщает доступность конфигурации, cache/status счётчики и budget remaining без значений ключей/пользовательских данных. Тест валидатора запрещает произвольные op args/URL.
- [ ] Метрики сравнения до/после: число уникальных реальных POI, число корректно найденных оригинальных имён/координат, доля рассказов с источниками, число неверных слияний, задержка cold/cache, число платных вызовов. Ручная выборочная проверка 10 объектов на набор; не требовать «больше результатов» ценой мусора.
- [ ] Обновить README, описать ограничения: не все объекты имеют материал, даты источников ≠ свежесть, центр района ≠ вход, лицензии per-source, web/Maps отключены до ключей и прав. CI не подтверждает фактическую правильность сгенерированных рассказов — live result отмечать отдельно.
- [ ] Полный CI + Deploy + `sources-test` через runner; отчёт с SHA, ссылкой Actions, тремя сценариями и незакрытыми зависимостями. Commit `ops: verify multi-source discovery without SSH`.

## Следующие отдельные планы, не часть первого выпуска

**Google Maps Grounding Lite:** после оценки первых источников и доступности биллинга. Использовать официальный REST/MCP через новый адаптер для resolve_names/search_places, не заменять текущую модель Yandex автоматически. Проверить конкретные условия хранения/атрибуции и совместимость обработки Yandex. Не помещать Google content в общий долговременный CC cache. OAuth login пользователя не является API-ключом Maps. Полный план после подтверждения API доступа, допустимых LLM и полей хранения; пошаговую навигацию оставить Google Maps.

**Tripadvisor Terra:** сначала договор/пакет с допустимым AI grounding и аудио-сценарием; проверить фактический набор MCP tools и права аккаунта. Не брать старые Content API wrappers. Отзывы показывать как мнения с датой, не сливать рейтинги разных провайдеров. Реализация отдельным адаптером после контракта.

**Lonely Planet / forum.awd.ru:** сначала письменные права/партнёрство. До этого только ссылки на релевантные страницы, без массового импорта/переозвучивания. Thorn Tree не планировать как действующий форум.

## Общая проверка каждого PR

```bash
npm run check
npm test
node scripts/standalone.mjs
bash tests/image-state.test.sh
git diff --check
```

CI дополнительно запускает Node22/24, Browser language and audio, Docker smoke и production proxy smoke. Новые server subdirectories включить в syntax check рекурсивно: существующий `server/*.mjs` их не охватит. Не запускать тесты с настоящими provider keys и не добавлять их в Actions output.

## Передача Sol

Прочитай spec и этот plan, проверь актуальный main и AGENTS.md. Реализуй последовательно задачи1–7 отдельными PR, начиная с1. В каждом PR дай проверяемый пользовательский результат, тесты и ограничения. Заверши открытые источники независимо от отсутствия платных ключей. Не подключай платные провайдеры и не выдавай права на контент за полученные. Пользователь уже выбрал направление; не перепридумывай архитектуру, а фиксируй конкретное отклонение от плана, если код или условия API ему противоречат. Готовые MCP — возможный транспорт, не обязательный первый шаг.

## Самопроверка плана

Покрытие: источники/идентичность1–3; генерация4; интерфейс/карты/совместимость5; web6; стоимость/права1,6; эксплуатация7. Все пять Review Focus привязаны к тестам. Сначала открытые данные, затем платное обогащение; новые внешние зависимости не блокируют базовый выпуск. Текущий результат — документы, не утверждение о работающей интеграции.
