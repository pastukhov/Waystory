# Progressive Tours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Не делегировать без отдельного разрешения. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить ошибки озвучки и проверки фактов, затем добавить экскурсии с тематическими главами по запросу.
**Architecture:** Существующие Node HTTP API, RouterAI и acquisition сохраняются. Новый модуль tours хранит снимок разрешённых источников, план и независимо проверенные главы в SQLite. Генерация запускается явными POST; готовые главы читаются GET.
**Tech Stack:** Node >=22, ESM, node:sqlite, vanilla browser modules, node:test, Playwright, GitHub Actions, Loki, VictoriaMetrics/Grafana.
**Spec:** `docs/superpowers/specs/2026-10-31-progressive-tours-design.md` — прочитать до выполнения.

## Global Constraints

- Выполнять задачи по порядку, отдельный PR на задачу. Прочитать AGENTS.md; автомерж после зелёных проверок, затем проверить main CI и Deploy.
- Не менять поставщиков, модели, ключи, тарифы или лимит WEB_SEARCH_MAX_CALLS_PER_DAY без отдельного решения пользователя.
- Не генерировать сразу двухчасовой текст. Не вводить Kafka, Redis, очереди или новый фреймворк.
- Не отключать grounding, source matching, политику лицензий, Google auth или проверку Origin.
- Не переносить сырые тексты источников, email, cookie, токены или ответы модели в Loki/Actions.
- Для тестов — фикстуры и внедрение fetchFn/now. Платные проверки только отдельным Operations probe после деплоя.
- Не менять существующий STORY_VERSION глобально ради нового формата: у tours собственный version=1.
- Никакого кэша аудио на диске сервера в v1. Готовые главы и снимки источников — только в ограниченном SQLite-хранилище.
- Сайт используется только владельцем после входа. Готовые возможности доступны сразу после проверок и выкладки, без отдельного флага или этапа включения. Материальные изменения записывать в план.

## Что установлено, а что нет

Логи 2026-10-31: Кусково `wiki:ru:173387`, review: incomplete_response, затем missing_evidence на обеих попытках. Это не доказывает ложность рассказа или бедность источников. Два speech POST получили 401; три последующих — 200. Ошибка воспроизведения конкретного скриншота пока не воспроизведена. Белорусский вокзал `wiki:en:8392086` также стабильно попадал в missing_evidence.

Текущие места изменений:
- `server/guide.mjs`: весь рассказ 4000 output tokens, 1–9 блоков; повторная генерация и проверка целого рассказа.
- `server/sources/facts.mjs`: 1800 tokens на review; требует точную скопированную цитату.
- `server/sources/collect.mjs`: до 6 документов, 6000 символов на документ, 18000 суммарно.
- `server/sources/acquire.mjs`: acquisition 20 секунд; official discovery в основном выдаёт ссылки.
- `server/index.mjs`: auth/origin/rate consumption, /api/guide, /api/speech.
- `dist/speech.mjs`: режет текст на 1000 символов для TTS и заранее загружает один следующий фрагмент.
- `dist/wiki.mjs`: после PR59 сохраняет исходные абзацы без искусственных глав. Это поведение сохранить.

## Review Focus

1. Двойной POST/две вкладки/разрыв соединения: одна активная генерация на главу, без потери готового результата. Тесты задач 4–6.
2. Перезапуск контейнера во время работы: запись не остаётся навечно generating, старый исполнитель не перезаписывает новый. Тест задачи 4.
3. Источник поменялся или запрещает хранение: старые цитаты не привязываются к новому тексту; сырой текст не сохраняется незаконно. Тесты 2–4.
4. Истёкшая сессия во время предварительной загрузки: не перескакивать через ещё не прослушанный звук. Тесты 1, 7.
5. Бедный, противоречивый или иностранный источник: отказ конкретной главы/ограниченный план вместо выдуманного объёма. Тесты 2, 3, 5, 8.

## Зафиксированные контракты

### Типы (JSON, время в UTC epoch milliseconds)

`EvidenceSpan={id,sourceId,revision,start,end,text,scope,language}`.
start/end — индексы UTF-16 в неизменном разрешённом тексте; `text===document.text.slice(start,end)`.
id = SHA256(JSON.stringify([sourceId, revision, SHA256(document.text), start, end])), hex. Явные границы полей исключают коллизии склейки разных sourceId/revision.

`Topic={id,title,summary,evidenceIds:string[],status:'available'|'limited',reason:null|string}`.
`Chapter={id,topicId,status:'planned'|'generating'|'ready'|'failed'|'insufficient',text:null|string,evidenceIds:string[],claims:Claim[],coveredFactKeys:string[],estimatedSeconds:number,error:null|PublicError}`.
`Claim={text,evidenceIds:string[]}`. Claim text должен дословно присутствовать в главе; review дополнительно проверяет ВСЕ утверждения главы, чтобы нельзя было опустить неудобное утверждение из claims.
`PublicError={code,message,retryable,diagnosticId}`; коды: auth_required, budget_exhausted, source_unavailable, insufficient_evidence, verification_failed, provider_timeout, provider_error, busy.
`Tour={id,version:1,placeId,language:'ru'|'en',sourceFingerprint,status:'planning'|'ready'|'failed',topics:Topic[],chapters:Chapter[],createdAt,updatedAt,expiresAt}`.
Публичный Tour НЕ содержит сырой source snapshot, ownerId, SQL lease или полный evidence corpus. Метаданные лицензий/ссылки выдаются как в существующих stories.

### Лимиты v1 — реализовать константами в server/tours/config.mjs

- Отдельный флаг tours не вводить. Существующая авторизация и доступность AI/store определяют возможность работы.
- 1 обзор, до 6 тематических глав; у темы 1–3 предложения summary, максимум 300 символов.
- Обзор 120–220 слов, глава ориентировочно 250–600 слов; текст максимум 6000 символов. Это ориентир, а не причина отвергать короткий подтверждённый текст.
- План: 2500 output tokens; глава: 4500; review: 3000. Всегда проверять finish_reason.
- До 2 generation attempts на главу; не более одного repair review при технически некорректном ответе. Общий счётчик вызовов принадлежит service и передаётся generator/reviewer; максимум 5 модельных вызовов на главу: generate, review, repair-review, regenerate, review.
- Deadline плана 60 секунд, главы 90 секунд; lease 120 секунд. HTTP POST немедленно возвращает 202, GET опрос раз в 2 секунды.
- Не больше 1 generation job на пользователя и 2 на процесс. Существующие user/global AI квоты расходовать за каждый реальный вызов модели, не за polling/cache hit.
- Исследование: до 4 поисковых обращений суммарно (включая резервного провайдера), 12 загруженных страниц, глубина ссылок 1, 4 страницы с одного домена, 60 секунд. Дневной существующий лимит имеет приоритет.
- Corpus: до 24 документов, 20000 символов/документ, 180000 суммарно; запрос модели главы до 18000 символов evidence. Не отправлять весь corpus каждой модели.
- 1 preview следующей главы только при включённом пользователем непрерывном воспроизведении. Не создавать обзор повторно при каждом открытии.
- Tour TTL 7 суток; хранение снимков подчинено sourcePolicy. SQLite cap 50 MiB логического JSON payload и 100 tours, LRU удаляет только неактивные tours; если всё активно — 429, не превышать cap. Не делать VACUUM на каждом запросе.

### HTTP (все /api/tours требуют session; POST требует Origin)

- `POST /api/tours {placeId,language}` → 202 `{tourId,status:'planning'}`, либо 200 для существующего готового плана того же owner/place/language и непросроченного snapshot.
- `GET /api/tours/:id` → 200 публичный Tour; чужой/неизвестный → 404; auth missing → 401.
- `POST /api/tours/:id/chapters/:topicId {}` → 202 для planned/generating, 200 готовая глава. topicId='overview' разрешён. Произвольный текст/URL/topic от клиента запрещён.
- `POST /api/tours/:id/chapters/:topicId/retry {}` → только failed с retryable=true; не сбрасывать ready/insufficient. 429 при бюджете/занятости.
- `PUT /api/tours/:id/progress {chapterId,chunkIndex,offsetSeconds,completedChapterIds}` → 200; проверка принадлежности chapterId, чисел, максимум 7 completed IDs. Хранить отдельно от chapter content.
- Ошибки до принятия работы — HTTP 400/401/403/404/409/429/503; ошибки принятой работы — в status/error, GET остаётся 200.
- Контент и прогресс принадлежат auth user.id. Не связывать два tour по координатам или похожему названию.

## Task 1 / PR1 — Диагностика и авторизация озвучки

Files: modify `dist/speech.mjs`, `dist/app.mjs`, `dist/i18n.mjs`, `server/sources/facts.mjs`, `server/observability.mjs`, `server/diagnostics.mjs`; tests `tests/cloud-speech.test.mjs`, `tests/source-facts.test.mjs`, `tests/diagnostics.test.mjs`.
Interfaces: сохранить onError(message); добавить optional `onAuthRequired()` в CloudNarrator. Вызвать его только для актуального 401 после завершения текущего уже загруженного фрагмента.
- [x] Добавить падающие тесты: 401 при первом фрагменте открывает авторизацию; 401 prefetch не обрывает текущий фрагмент; не вызывает device fallback; поздний 401 после stop игнорируется; 5xx сохраняет существующий fallback.
- [x] В app onAuthRequired сбросить state.user/ai/vision, открыть account-dialog, loadAccount; сохранить текущую главу/позицию. Текст RU: «Чтобы продолжить озвучку, войдите снова.» EN: «Sign in again to continue listening.» Не начинать проигрывание автоматически после входа.
- [x] Для missing_evidence добавить allowlisted evidenceFailures: missing_item, unknown_source, uncited_source, short_quote, quote_not_found; для incomplete_response — allowlisted finishReason и usage token counts. Только индексы/коды, без цитат.
- [x] Пропустить новые поля через observability И экспорт диагностики; тест неизвестного поля/секрета должен показывать его удаление.
- [x] Проверить `node --test tests/cloud-speech.test.mjs tests/source-facts.test.mjs tests/diagnostics.test.mjs`; затем npm test, npm run check; commit, PR, CI/Deploy.
Deliverable: авторизация перестаёт выглядеть как ошибка синтеза; можно точно объяснить отказ проверки.

Task 1 implementation note: diagnostics.mjs delegates to safeTelemetryEntry, so the shared allowlist covers both live and exported logs. Auth continuation preserves unfinished chunks in-session; login redirect/reload persistence remains Task 7. Tests: 338 passing; syntax/diff checks passing. Review/CI/Deploy must be confirmed before proceeding.

## Task 2 / PR2 — Проверка по неизменным фрагментам

Create `server/sources/spans.mjs`; modify `server/sources/facts.mjs`; create `tests/evidence-spans.test.mjs`, `tests/chapter-review.test.mjs`.
Interfaces: `buildEvidenceSpans(documents):EvidenceSpan[]`; `reviewChapter({text,claims},spans,{fetchFn,headers,model,endpoint,signal}):Promise<{outcome:'supported'|'rejected'|'error',issues:{claimIndex:number|null,reason:string}[]}>`.
- [x] Тесты: исходные offsets воспроизводят текст; одинаковый snapshot даёт одинаковые IDs; изменение текста/revision меняет IDs; foreign-language source не переводится при создании spans; запрещённый allowModelInput документ пропускается.
- [x] Делить на исходные абзацы; большие абзацы — куски до 1200 символов по пробелу с перекрытием до 150 символов, сохраняя offsets. Не применять splitSentences. Отдельный span не считается предложением.
- [x] Модель возвращает для claims evidenceIds, а reviewer проверяет смысл по соответствующим исходным spans и отсутствие непокрытых фактов во всём тексте. Не просить перепечатывать цитаты.
- [x] Тесты: существующий, но нерелевантный span → rejected; придуманный ID → rejected до модели; факт о районе вместо объекта → rejected; противоречие → rejected; перевод подтверждённого факта → supported; finish_reason=length → error, а не unsupported.
- [x] Один repair-review разрешён только для invalid_json/incomplete_response/invalid schema, с меньшим заданием и оставшимся deadline; смысловой отказ исправляет generator, не бесконечный reviewer.
- [x] Legacy validateSupport пока сохранить для /api/guide. Новый путь включить только tours, чтобы не менять старый контракт одним PR.
- [x] node --test tests/evidence-spans.test.mjs tests/chapter-review.test.mjs; npm test; commit/CI/Deploy.

Task 2 implementation note: reviewer accepts optional `consumeCall()` (awaited before every real model request; false/throw denies), `deadline` (epoch ms), and injected `now`. The later tour service owns their shared budget/quota. Review uses at most one technical repair (2000 output tokens after the initial 3000), keeps all chapter text and supplied original spans, and never repairs semantic rejection. Existing guide review is unchanged. Fixture tests verify the request and response contract without paid model calls. Local targeted tests: 22 passing; full suite: 360 passing; syntax/diff checks passing. Astra found ambiguous hash field concatenation; the identity tuple now uses JSON encoding, with a regression test. Astra review passed; merged main 81c50c39d9c515977ff411a2bcae8584a7ad9812, CI 41192536258 and Deploy 41192589509 successful.

## Task 3 / PR3 — Исследование тем и полные разрешённые материалы

Create `server/tours/research.mjs`, `server/tours/config.mjs`; modify `server/sources/search-provider.mjs`, `server/sources/collect.mjs`, `server/sources/wikipedia.mjs`, `server/sources/official-discovery.mjs`; tests `tests/tour-research.test.mjs`.
Interface: `createTourResearch({collect,search,loadPage,now})` returns `research(place,{language,signal,budget}):Promise<{documents,spans,statuses,fingerprint}>`.
- [x] Сначала fixture Кусково: Wikipedia + официальный музей + страницы дворца/парка; fixture одноимённого другого объекта; fixture бедного источника.
- [x] Добавить opt-in collection profile 'tour', не увеличивать legacy лимиты глобально. Профиль должен доходить до Wikipedia provider ДО обрезки extract и до sourceBundle. Официальные ссылки превращать в документы только после безопасной загрузки, matching и sourcePolicy.
- [x] Расширить searchCandidates опциональными `{querySuffix,maxProviderCalls}`; suffix формируется сервером из place context и одной из тем history/architecture/collections/visitor-guide. Счётчик обращений учитывает оба провайдера и extraction API; остановить до reserveProviderCall при исчерпании локального бюджета.
- [x] Исследование: существующие docs → официальный домен/страницы → тематический поиск, пока есть budget. Не искать по каждой теме отдельно, если уже есть подтверждённый материал. Дедуп по canonical URL и hash текста.
- [x] Использовать существующие безопасные загрузчики; если loadPage недостаёт, выделить его из official-discovery, не добавлять fetch произвольного URL. Тест private IP, DNS rebinding, redirect в private IP, oversized body, timeout.
- [x] Политика неизвестного сайта не становится разрешённой автоматически. Ссылку можно показать, но текст допускается в модель/кэш только по policy.
- [x] Тесты точных лимитов, fallback Brave, no-key, дневного лимита, смешанных языков, исключения wrong-object; 0 поисковых вызовов при достаточном сохранённом corpus.
- [x] node --test tests/tour-research.test.mjs tests/search-provider-fallback.test.mjs tests/source-policies.test.mjs; npm test; commit/CI/Deploy.

Task 3 implementation note: `profile:tour` separates collector cache/flight entries and propagates through selected-place recovery. Wikipedia tour requests omit `exchars` because MediaWiki clamps it to 1200 even for 6000/20000; full plaintext extracts are bounded to 20000 characters after retrieval. Legacy requests and collection limits are preserved. Research accepts lower-only budget caps (`maxSearchCalls`, `maxPages`, `maxPagesPerDomain`, `timeoutMs`); sufficient distinct saved text skips further acquisition, while the later planner still decides supported themes. Safe page loading uses the existing DNS-pinned HTTPS transport and approved domain/policy metadata, never an automatic grant for official websites. Result adds bounded-discovery link metadata alongside the specified corpus contract. Generic visitor navigation fixes the real Kuskovo chain to `/posetitelyam/independent_visit/` and its endorsed izi search/tiflo links in existing guide discovery. The user-supplied palace QR URL is tested separately as a synthetic endorsed-link fixture; the real visitor page does not currently link that exact palace URL. Local checks and independent review/CI/Deploy are recorded in PR #64. Astra approved head 2239163; merged main 35374139b0a7d08bd4b80752273716c1935860a1, CI 41193143986 and Deploy 41193249670 successful. Task 5/6 must pass the collector through addOfficialIdentity as the legacy adapter does. Research chapter_grounding telemetry remains deferred to Tasks 5/8.

## Task 4 / PR4 — SQLite и жизненный цикл работ

Create `server/tours/store.mjs`, `server/tours/jobs.mjs`; tests `tests/tour-store.test.mjs`, `tests/tour-jobs.test.mjs`.
Interfaces:
- `createTourStore({db,now})` → `create(ownerId,input)`, `get(ownerId,id)`, `findActive(ownerId,placeId,language)`, `claimJob(ownerId,tourId,topicId)`, `completeJob(jobToken,result)`, `failJob(jobToken,error)`, `saveProgress(ownerId,tourId,progress)`, `cleanup()`.
- `createTourJobs({store,now,maxActive:2})` → `start({ownerId,tourId,topicId,run}):{accepted:boolean}`; run получает `{signal,jobToken}`. Очереди в v1 нет: если оба места заняты — 429.
Schema: tours(id TEXT PK, owner_id TEXT, place_id TEXT, language TEXT, fingerprint TEXT, data TEXT, snapshot TEXT NULL, created INTEGER, updated INTEGER, expires INTEGER); tour_chapters(tour_id TEXT, topic_id TEXT, data TEXT, lease_until INTEGER NULL, job_token TEXT NULL, PRIMARY KEY(tour_id,topic_id)); tour_progress(tour_id TEXT, owner_id TEXT, data TEXT, updated INTEGER, PRIMARY KEY(tour_id,owner_id)); FK tour_id ON DELETE CASCADE. Миграции additive; никакого DROP существующих таблиц.
- [x] Тесты isolation owner A/B, JSON roundtrip, миграция повторно, unique глава, два concurrent start → один run, exhausted cap → 429, active tour не удаляется.
- [x] Claim через короткую BEGIN IMMEDIATE транзакцию: planned/expired generating → generating, новый UUID token и lease. Не держать SQL-транзакцию во время await/fetch.
- [x] complete/fail выполняют UPDATE только при совпадении token и непросроченной lease. Старый результат не перезаписывает новый. На startup expired lease → failed/provider_timeout, retryable=true; НЕ запускать платные jobs автоматически.
- [x] При disconnect HTTP принятая job может закончиться и сохраниться до deadline. Stop в плеере отменяет polling/prefetch клиента, но не обещает отмену уже оплаченного вызова. При shutdown прекратить принимать jobs и abort активные.
- [x] snapshot сохранять только если все содержащиеся тексты разрешают allowTextCache. Иначе хранить метаданные и in-memory snapshot с тем же TTL; после рестарта повторно загрузить источник, проверить fingerprint; при изменении вернуть source_unavailable и предложить новый tour, не использовать старые evidenceIds.
- [x] Сохранение готовой адаптации также зависит от политики output/cache: запрещённый результат хранить только в памяти; публичный контракт отмечает `volatile:true`, UI сообщает, что после перезагрузки нужна подготовка. Не смешивать allowModelInput и allowTextCache.
- [x] Тест lease expiry с fake now без sleep, crash recovery, stale completion, TTL, byte cap, forbidden persistent snapshot.
- [x] node --test tests/tour-store.test.mjs tests/tour-jobs.test.mjs; npm test; commit/CI/Deploy.

Task 4 implementation note: `topicId=plan` is the internal plan-job sentinel and never a public chapter. `run({signal,jobToken})` returns its result; jobs persist completion/failure and expose `drain()`/awaitable `shutdown()` for service/server lifecycle. `claimJob(...,{retry:true})` and jobs `start({...retry:true})` accept only retryable failed chapters; ordinary starts never reset terminal output. `getSnapshot(ownerId,id,{snapshot,fingerprint})` is owner-scoped: after volatile snapshot loss, research must reload documents, match the original fingerprint and content identity hash, then supply them for rehydration; mismatch raises source_unavailable. `get()` exposes only public fields plus owner progress. Snapshot TTL is bounded by tour TTL and source-policy TTL; explicit zero TTL refuses retained snapshots with source_unavailable. `allowOutputCache:false` independently denies output persistence; absent output-specific policy falls back conservatively to allowTextCache. Denied topics, chapter text/claims and snapshots remain only in bounded process memory; disk contains attribution/revision metadata and planned volatile placeholders. Every logical JSON byte in all three tables and volatile memory counts toward the cap; lower-only optional factory caps support fixture tests and cannot raise production limits. Read/polling recovers leases that expire after startup. Claims reserve 1024 real JSON bytes for both possible plan failure copies before acceptance; private reservation bytes never appear publicly. Abort-raced job promises release hung slots at deadline and observe late rejection without touching a newer job. Task 4 delivered as PR65, main c75c11327eb19d44d1bbac705c3b6ad7ea2952f4; main CI 41194204892, Deploy 41194267659 and Operations diagnose 41194299220 all successful.

## Task 5 / PR5 — Планировщик и генерация одной главы

Create `server/tours/planner.mjs`, `server/tours/generator.mjs`, `server/tours/service.mjs`; tests `tests/tour-planner.test.mjs`, `tests/tour-generator.test.mjs`.
Interfaces:
- `planTour({place,language,spans},{complete,signal}):Promise<Topic[]>`.
- `generateChapter({place,language,topic,spans,previousChapters},{complete,review,signal}):Promise<Chapter>`.
- `createTours({store,jobs,research,complete,review,resolvePlace,consume,now})` → `start(ownerId,{placeId,language})`, `get(ownerId,id)`, `chapter(ownerId,id,topicId,{retry:false})`, `progress(ownerId,id,value)`.
- `complete({messages,schema,maxTokens,signal})` — небольшой RouterAI adapter с существующей конфигурацией ai-provider, injectable fetchFn; `consume(ownerId)` вызывается непосредственно перед каждым upstream POST. Не имитировать HTTP-запрос к собственному /api/guide.
- [x] Тест plan: каждая тема имеет реальные evidenceIds и хотя бы один scope=place span; до 6 тем; стабильный серверный topicId = hash(normalized title + sorted evidenceIds). Модель не назначает внутренние ID. Нет материалов → empty topics, понятный insufficient_evidence.
- [x] Обзор — отдельная серверная тема overview. Создание плана не запускает все главы; overview запускается после успешного плана как единственная первая job. План доступен до готовности обзора. Запуск overview происходит после освобождения plan job slot; при занятости overview остаётся planned и запускается явным POST клиента.
- [x] Выбирать для главы spans её темы (до 18000 символов), сохранять контекст предыдущих глав в кратких verified claims, а не полный текст. Не подменять нехватку evidence данными соседнего объекта.
- [x] Проверить structured JSON, язык ru/en, text <=6000 символов, evidenceIds subset input, непустые claims, отсутствие служебных ID в spoken text. Длительность рассчитывать той же скоростью слов, что durationLabel; вынести общую константу вместо второй несовпадающей формулы.
- [x] review supported → ready; rejected → один regeneration с конкретными issues; повторный reject → failed/verification_failed. Недостаточный corpus → insufficient. Ошибка отдельной темы не изменяет соседние главы.
- [x] coveredFactKeys = hash(normalized claim + sorted evidenceIds). Generator получает уже использованные claims; тест на дублирующий ответ требует regeneration/limited, а не заполнение минут повтором. Hash ловит точные дубли; смысловые повторы reviewer проверяет отдельно.
- [x] Тесты: overview + 3 темы fixture Кусково; бедный объект без искусственных тем; противоречие; иностранные источники → русский текст; max call count=5; aborted deadline; no retries on 401/403/budget; готовый chapter cache hit → 0 model calls.
- [x] node --test tests/tour-planner.test.mjs tests/tour-generator.test.mjs; npm test; commit/CI/Deploy.


Task 5 implementation note: `createTours` returns `{status:200|202,tourId,tour}` from start and `{status,chapter,accepted?}` from chapter; get returns the public owner-scoped Tour or null, progress delegates to validated storage. `createTourModel({env,fetchFn})` supplies complete/review using existing provider settings; service-owned `consume(ownerId)` must compose user/global quotas and is called for every upstream generation/review/repair. `createTourCollector({collect,request})` enriches wiki-only seeds through addOfficialIdentity before research. Reviewer now explicitly checks semantic repetition against previous verified claims. Busy auto-overview remains planned for explicit POST. Scheduled overview is safe if shutdown closes storage first; normal lifecycle still awaits jobs.shutdown() before closing the DB. Store adds owner-scoped invalidate (marks a source-incompatible plan failed while keeping ready chapters) and discardUnclaimed (deletes only a planning tour without an active lease after rejected reservation). Snapshot mismatch invalidates the old plan; volatile topic loss permits a fresh explicit start instead of caching an unusable plan forever. No HTTP routes are enabled until Task 6. Final verification: 440 fixture tests passing; npm run check and syntax/diff checks passing. Astra approved head 58b8621; PR66 merged main cf3164abfea7865950f0ab0156d7a6a3d38db6bf; main CI 41195008465, Deploy 41195081027 and Operations diagnose 41195116861 successful. chapter_grounding telemetry maps to the review operation.

## Task 6 / PR6 — HTTP, конфигурация и контракт клиента

Create `server/tours/routes.mjs`, `dist/tours-client.mjs`; modify `server/index.mjs`; tests `tests/tours-http.test.mjs`, `tests/tours-client.test.mjs`.
Interfaces: `handleTourRoute(req,res,{auth,tours,settings,readJson,json}):Promise<boolean>`; browser `createToursClient({fetchFn,pollMs:2000})` → `start`, `get`, `prepareChapter`, `retryChapter`, `saveProgress`, `waitFor(id,predicate,{signal})`.
- [x] Реализовать endpoints из контракта. Все методы кроме перечисленных → 405. JSON size limit переиспользовать из server/index.mjs. Валидация placeId/id/language до job reservation.
- [x] /api/config отдаёт tours:true при действующей session, настроенном AI и доступном store. Это признак доступности API, а не переключатель выпуска. Без session API возвращает 401, без необходимых сервисов — 503.
- [x] Auth errors сохраняют HTTP status и PublicError в клиенте; error message от неизвестного backend не показывать как HTML. GET no-store; polling не расходует auth.consume.
- [x] Не добавлять настроек включения в GitHub, env или compose. Существующие credentials и способ авторизации сохранить.
- [x] Тесты 401, wrong Origin403, чужой tour404, malformed400, cache hit200, accepted202, duplicate202 без новой job, retry terminal409, квоты429, stale polling cancellation, недоступный сервис503.
- [x] npm test; npm run check; commit/CI/Deploy; проверить доступность нового API после входа (authenticated fixture; owner browser unavailable).

Task 6 implementation note: HTTP errors are `{error:PublicError}`; validation/method/ownership failures use a safe provider_error code with the HTTP status distinguishing the cause. `POST /api/tours` 202 is exactly `{tourId,status:'planning'}`; cached 200 is `{tourId,status:'ready',tour}`. Chapter POST responses are the public Chapter, GET is the public Tour, and progress PUT returns saved progress. Client calls accept optional `{signal}` as the final argument; `start({placeId,language},options)`, `get(id,options)`, `prepareChapter(id,topicId,options)`, `retryChapter(id,topicId,options)`, `saveProgress(id,value,options)`. Client errors retain `status`, PublicError fields and `publicError`; unknown/HTML backend messages use fixed text. All requests use same-origin credentials and no-store. The client races abort against transports that ignore cancellation so a late result cannot satisfy the previous selection's predicate.

Task 6 Ruling: preserve asynchronous acceptance when a quota is exhausted inside an accepted job — the job records budget_exhausted while GET remains 200, as the HTTP contract requires. Reservation errors remain 429 and do not create reusable planning records. Quotas are consumed only at each actual generation/review/repair call through `auth.consume({id:ownerId},'ai')`; polling/cache hits remain free and existing unlimited-account behavior is unchanged. Production composition uses the full tour collector, addOfficialIdentity, existing search configuration/policy, and existing AI configuration. No new release switch or provider credentials. SIGTERM/SIGINT now immediately close job admission and abort active jobs, drain HTTP with a five-second connection bound, await settlement, then close auth and source SQLite; repeated signals do not initiate duplicate shutdown. Astra found the initial close-event timing allowed an existing partial POST to reserve work during drain; a real partial-POST regression went RED→GREEN after moving job shutdown to server.close entry. Local verification: 455 full tests, 15 targeted tests, npm run check, syntax/diff checks, Docker container smoke, and existing RU/EN mobile browser/nearby smoke pass. Authenticated real-service behavior is fixture-tested; no owner browser session is available here, so a production post-login browser check remains unverified. PR67 approved exact head 767e539 and merged main a2e11228417d1b402881916a54aac9dd105c87da; main CI 41196106588 and Deploy 41196182473 successful. Public config/API/auth rejection and deployed browser client asset verified; no owner-authenticated production browser or paid probe ran in Task 6.

## Task 7 / PR7 — Экран экскурсии, непрерывная озвучка и прогресс

Create `dist/tours-view.mjs`, `dist/tour-player.mjs`; modify `dist/app.mjs`, `dist/index.html`, `dist/styles.css`, `dist/i18n.mjs`, `dist/speech.mjs`; tests `tests/tour-player.test.mjs`, new `scripts/ci-tours-smoke.cjs`, wire into `.github/workflows/ci.yml` browser job.
Interfaces: `renderTour(container,tour,{onOverview,onTopic,onContinue,onRetry})`; `createTourPlayer({client,narrator,saveProgress,onChange})` → `open(tour)`, `play(topicId)`, `pause()`, `resume()`, `stop()`, `setContinuous(boolean)`, `dispose()`.
- [x] До UI написать browser fixture с планом/готовой/генерирующей/failed главой; никаких оплачиваемых providers в CI.
- [x] При tours:true карточка показывает «Слушать обзор», темы с состояниями и фактической длительностью готовых глав; нет трёх уровней для одной главы. «Продолжить экскурсию» включает continuous=true и следующую тему. Отдельный topic click continuous=false.
- [x] Подготовка не блокирует чтение уже готового текста. «Недостаточно материалов по этой теме» отличать от «Не удалось подготовить главу. Повторить». Источники/лицензии оставить в существующем сворачиваемом блоке.
- [x] Добавить в CloudNarrator optional progress callback `{blockId,chunkIndex,offsetSeconds}` и resume cursor. chunkIndex привязан к неизменному textHash и алгоритму chunking v1; на изменении текста сбросить cursor, не применять старые секунды.
- [x] В одной сессии сохранять подготовленный следующий audio blob (максимум 2 blobs/8 MiB); URL.revokeObjectURL при замене/stop/dispose. Никаких audio blobs в localStorage.
- [x] Сохранение прогресса раз в 5 секунд и на pause/ended/pagehide best effort; локальный backup только cursor/tourId/textHash, без cookie. После reload сначала получить owner-authorized tour; при logout удалить локальный cursor. Не гарантировать фоновое проигрывание на Android без отдельной проверки.
- [x] Завершение главы отмечать только после onComplete последнего фрагмента. Ошибка prefetch не перепрыгивает главу. Ручной выбор темы отменяет устаревший polling; поздний response не меняет выбранную тему.
- [x] Не объявлять chapter completed при закрытии вкладки или ошибке. 401 показывает вход; после входа пользователь сам нажимает продолжить.
- [x] RU/EN Playwright: ready→playing→next; failed retry; выбор темы во время загрузки; login expiration; reload resume; нет headings у исходной статьи. Unit: blob cleanup, bounded prefetch, no auto work when continuous=false, changed textHash resets cursor.
- [x] npm test; npm run check; node scripts/ci-tours-smoke.cjs (Playwright из CI setup); commit/CI/Deploy; новый интерфейс сразу доступен владельцу.

Task 7 delivery: PR #68 merged as `6a8e3a46d3efa979d26a277a85f190e686f2c76d`; main CI `41197672045` and Deploy `41197759100` succeeded. Public served assets match reviewed revision (PR evidence comment `6542897760`).

Task 7 implementation note: tour mode replaces the legacy automatic story/enrichment requests; sources remain as original paragraphs and tour source/licence metadata uses the existing collapsed panel. Cloud audio keeps the playing blob and one lookahead blob, each capped at 4 MiB while reading; a continuous-only next-chapter first fragment uses the same lookahead slot only on the final current fragment, then is reused at the boundary. Stop/dispose abort lookahead and revoke object URLs. Cursor backup contains only tour/chapter IDs, chunk index/seconds, exact-text hash and chunking version; audio stays in memory. Progress writes are serialized, saved at five-second playback intervals and pause/completion/pagehide, with owner-authorized GET before reload restore and no autoplay after login. Local hash/version mismatch resets seconds and chunk while retaining the selected chapter. Ruling: server progress can restore without a local hash because ready chapter IDs/text are immutable in the authorized Tour snapshot; this applies to current chunking v1. A future chunking change must migrate/reset server cursors. Local checks and delivery evidence are recorded in the PR; physical Android/background playback and an actual owner-authenticated browser remain unverified.

## Task 8 / PR8 — Наблюдаемость и реальные пробы

Modify `server/observability.mjs`, `server/diagnostics.mjs`, `scripts/ops-probe.mjs`, `scripts/ops-request.mjs`, `scripts/operations-vm.sh`, `.github/workflows/operations.yml`, `scripts/generate-monitoring.mjs`, `monitoring/grafana-dashboard.json`, `docs/observability.md`; tests `tests/observability.test.mjs`, `tests/diagnostics.test.mjs`, `tests/ops.test.mjs`, `tests/monitoring-assets.test.mjs`.
- [x] Counters `waystory_tour_jobs_total{stage,outcome}`, `waystory_tour_review_failures_total{reason}`, histogram `waystory_tour_job_duration_seconds{stage}`, gauge `waystory_tour_storage_bytes`. Labels строго enum: stage research/plan/generate/review; outcome success/limited/rejected/error/timeout/budget. Не использовать placeId/userId/tourId как labels.
- [x] Логи correlation: requestId, diagnosticId, tourId, chapterId, revision, stage, reason, durationMs; без source text/claims/email/credentials.
- [x] Для first-audio/gap добавить `POST /api/tours/:id/playback-events` с auth+Origin: `{chapterId,type:'first_audio'|'gap'|'playback_error',durationMs?,code?}`; duration 0..120000, code allowlist; max30/min/user, max1 first_audio и gap на chapter/play attempt. Это диагностические недоверенные измерения клиента, не биллинг. Тест чужого tour и cardinality.
- [x] Dashboard: jobs by outcome, review reasons, p50/p95 duration, speech401 отдельно от upstream5xx, cache effectiveness, search usage, first audio/gap, storage. Прогнать существующий generator и monitoring smoke; не править только сгенерированный JSON.
- [x] Operations `kuskovo-tour-test`: фиксированный placeRef wikipedia/ru/173387, ru; research → overview + первые 3 подтверждённые темы ПОСЛЕДОВАТЕЛЬНО; максимум 4 search calls и 1 plan + 4*5 chapter model calls; TTS только первый fragment overview. Вывести лишь число глав, слов, источников, reasons, timings, estimated cost если usage известен. Нельзя вывести ключи, тексты или весь ответ модели.
- [x] `tour-fixtures-test` без сети: Белорусский вокзал, бедный объект, иностранный объект; запуск в CI. Реальная проверка иностранных мест отдельным запуском, не на каждый deploy.
- [x] Существующие реальные probes не получают произвольный URL/model/prompt из inputs. Operations choice, validator и tests обновить совместно.
- [ ] npm test; monitoring smoke; PR/CI/Deploy; запустить один kuskovo-tour-test, проанализировать результат. Если fail — исправить конкретный слой, не повышать лимиты и не отключать проверку.

Task 8 probe ruling: fixed Operations uses internal `start(...,{fresh:true})` so every acceptance run exercises research/planning/model/review even if an owner tour is cached. Existing owner tours are retained under the same cap/TTL; successful probe chapters are available through the regular owner API. The HTTP contract cannot request fresh generation.

Task 8 implementation ruling: playback payload adds a UUID `attemptId` so first_audio/gap deduplication can distinguish explicit replay. Values never become metric labels or logs. Dedupe is process-local for the tour TTL (7 days), capped at 10,000 entries, with 30 validated requests/min/user and at most 1,000 active minute buckets. Diagnostic saturation returns 429 and never affects playback. Measurements start only after fulfilled audio.play(); they are untrusted client measurements, not audible-device verification.

## Task 9 — Проверка работающей экскурсии

- [ ] Убедиться, что main CI и Deploy успешны для точного SHA. Запустить Operations diagnose. Проверить место на диске и размер source DB через существующую диагностику; при нехватке места разобраться с её причиной, а не добавлять переключатель функции.
- [ ] Выполнить probe задачи 8 на выложенной версии. Зафиксировать run URL, revision, точные pass/fail, число источников/глав и стоимость из usage (если цены неизвестны — токены/вызовы, не придумывать рубли).
- [ ] Проверить /api/config и экскурсию в авторизованной сессии. Отдельных ручных действий для включения от владельца не требуется.
- [ ] Ручная приёмка Chrome Android: открыть Кусково → обзор → продолжить → выбрать другую тему → pause → reload → resume; отдельная проверка истёкшей сессии. Не объявлять проверку на устройстве успешной по одному Playwright.
- [ ] Цели: обзор + минимум 3 уникальные проверенные темы; глава не повторяет предыдущую; нет разрывов исходных абзацев; права/атрибуция доступны. Первый звук после готового текста ориентир p95<8s, gap при готовом prefetch<1s; это измеряемые цели, а не гарантии провайдера.
- [ ] Прогнать бедный объект: обзор/insufficient без искусственных глав; другой язык: правильный язык рассказа; подмена названия: источник другого объекта отклоняется.
- [ ] При критической регрессии использовать существующий rollback на предыдущую рабочую версию приложения. Миграции additive, таблицы и готовые главы не удалять. Документировать в docs/operations.md.

## Порядок работы Sol и отчётность

1. Прочитать spec, AGENTS.md и соответствующие файлы задачи. Проверить HEAD: другие задачи могли изменить те же файлы.
2. Реализовывать только одну задачу. Сначала регрессионный тест → ожидаемый fail → реализация → targeted tests → npm test + npm run check → необходимые browser tests.
3. Перед commit просмотреть diff на секреты, случайный рефакторинг, сломанные контракты. Не менять тестовые ожидания лишь ради зелёного статуса.
4. Создать PR с конкретным поведением и проверками; включить auto-merge. Дождаться required checks, main CI, Deploy; при ошибке разбирать её до следующего PR.
5. Обновлять чекбоксы плана в своём PR. В конце каждой задачи сообщать SHA, PR, checks, Deploy, остаточные ограничения. «Код готов» не равно «в продакшене проверено».
6. Если этап требует изменения контракта, сначала обновить этот план и зависимые тесты. Если задача не проходит приёмку, остановить продвижение к следующему этапу и сообщить конкретный blocker.

## Передача Sol — вставить как стартовое сообщение

> Реализуй план docs/superpowers/plans/2026-10-31-progressive-tours.md. Сначала прочитай связанный spec и AGENTS.md. Начни с Task 1, выполняй по одному PR, не пропускай диагностику и проверки. Сайт частный, только для владельца после входа: не добавляй feature flag или ручной этап включения. После выкладки проверь реальную экскурсию по Кусково. Автомерж разрешён; подтверждение на каждое слияние не требуется. Не меняй поставщиков, тарифы и бюджеты, не ослабляй проверку фактов. Сохраняй прогресс в чекбоксах плана и сообщай фактический статус деплоя.

## Task 8/9 real probe follow-up — 2026-10-31

PR #69 merged `c3bee91c0b97cc52d65e589b2886261385fa64c4`; main CI `41198820581` and Deploy `41198884981` succeeded. Operations diagnose `41198921591` succeeded: source DB 741,376 bytes, free disk 23,063,228,416 / 42,090,168,320 bytes; no cleanup performed. Anonymous session/config gating was checked; owner browser and physical Android remain unverified.

Real fixed fresh Kuskovo probe [41198945928](https://github.com/pastukhov/Waystory/actions/runs/41198945928) failed honestly. Research: 5 documents, 28,856 characters, ru/en/be, positive snapshot TTL for admitted text, 0 searches / 0 loaded web pages, 2,361 ms. Configured search-snippet policy has TTL=0; its text was not admitted or persisted. Planning succeeded in 8,097 ms. Overview failed output validation after two model attempts (29,464 ms), before any grounding request: one tour_plan and two tour_chapter calls, 45,038 input / 6,225 output tokens, complete usage reporting. No price estimate or review bypass.

Follow-up adds enum-only chapter output diagnostics to identify the exact rejecting predicate on the next deployed bounded probe. Validation, providers, quotas and model/search limits remain unchanged. This failed run does not satisfy Task 8/9 acceptance.

Diagnostic PR #70 merged `88dd6d59bce0352ae944aadb708ab9c1300b7c61`; main CI `41199429098`, Deploy `41199505264` and automatic diagnose `41199556765` succeeded. The second fresh [real probe 41199578602](https://github.com/pastukhov/Waystory/actions/runs/41199578602) reached a different boundary: research same 5 permitted documents/28,856 chars, zero searches, 675 ms; planning succeeded in 8,795 ms; the first overview completion was rejected by the model adapter as provider_error before structural validation (29,062 ms). Usage: 2 calls, 31,041 input / 5,747 output tokens. No grounding request or TTS call occurred. Exact finish reason was not yet exported, so a narrow follow-up adds per-call finish/token diagnostics; no limit increase or speculative contract change.


Task 9 chapter producer contract follow-up: the fresh [probe 41200140967](https://github.com/pastukhov/Waystory/actions/runs/41200140967) on `89d96407da2ce73d270e0d04147925f13b86d84c` confirmed `invalid_evidence` on both overview attempts before grounding. Both responses finished with `stop` (4,047 and 3,058 completion tokens); plan used 1,335. Total: three calls, 45,038 input / 8,440 output tokens. This does not establish a claim-verbatim failure.

The chapter producer now receives request-scoped `e1`, `e2`, … references, including matching topic references and a schema enum restricted to the selected spans. Source/topic hashes and previous claim evidence references are omitted from that producer payload. Output references map back to the original canonical span IDs before the existing evidence, duplicate, claim-verbatim and whole-chapter semantic checks; canonical snapshots, topic/store IDs, reviewer input and covered fact keys remain unchanged. Unknown (including supplied canonical IDs), duplicate, subset and unused references remain rejected. Enum-only evidence subtypes identify the rejecting evidence predicate without source/model text. Models, token/call budgets, source policies and factual review are unchanged. Local regressions exercise the actual JSON model adapter and canonical review boundary. Deployment and fresh real acceptance remain to be recorded after delivery.


Task 9 next concrete boundary: PR #72 merged as `9ac151dea8ca67c75d0daecd6eb27da86b6b5414`; main CI `41200770177`, Deploy `41200842119`, diagnose `41200889418` succeeded. Diagnose: source DB 1,228,800 bytes; free disk 23,055,687,680 / 42,090,168,320 bytes. Fresh [real probe 41200921234](https://github.com/pastukhov/Waystory/actions/runs/41200921234) validated compact evidence: overview ready after successful whole-chapter review, 88 words / four evidence references / one claim, generate+review 5,530 ms. First theme failed both attempts at confirmed `claim_not_verbatim`, before grounding. Total five model calls: 37,223 input / 2,868 output tokens; zero missing usage, zero searches/pages. No TTS occurred and acceptance remains incomplete.

Chapter producer wire contract is now `{language,segments:[{text,evidenceIds}]}` with 1–100 ordered nonempty prose segments and the same selected local-reference enum. The server deterministically joins exact segment text with two newlines, derives claims from those unchanged texts, maps their references to canonical spans, and derives the top-level evidence union. This removes the duplicate prose-copy task that the actual theme failed. Unknown fields, malformed/blank segments and duplicate references within a segment fail closed; invalid segments are never filtered into a partial success. The existing canonical chapter validator (including verbatim, subset/union and 6,000-character total bounds), fact keys, previous-claim duplicate checks, entire-text and each-claim semantic grounding, retries and shared call budget all remain in force. No source policy, provider, model or limits change. Regression tests exercise the JSON adapter boundary and reject contradictions inside otherwise valid segments. Delivery and the next bounded real acceptance remain to be recorded.
