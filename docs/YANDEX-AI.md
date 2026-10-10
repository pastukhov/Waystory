# Yandex AI Studio for Waystory

## Starting models

Verified against the official catalogue on 2026-10-10:

| Task | Environment variable | Initial model |
| --- | --- | --- |
| Layered narratives | `YANDEX_STORY_MODEL` | `aliceai-llm` |
| Short contextual answers | `YANDEX_QUESTION_MODEL` | `aliceai-llm-flash` |
| Landmark photo hypotheses | `YANDEX_VISION_MODEL` | `qwen3.6-35b-a3b` |

These are starting choices, not measured quality or latency rankings. Compare
real outputs before a commercial rollout. `yandexgpt-5.1` is a text alternative;
`yandexgpt-5-lite` is another candidate for short answers. Model values are names
inside your folder, not full URIs. The server constructs `gpt://FOLDER/MODEL`.
No automatic fallback silently changes the model or makes another paid call.

Sources: [current catalogue](https://aistudio.yandex.ru/ru/docs/ai-studio/concepts/generation/models),
[structured responses](https://aistudio.yandex.ru/ru/docs/ai-studio/operations/generation/completions-structured),
[vision requests](https://aistudio.yandex.ru/ru/docs/ai-studio/operations/generation/multimodels-request).

## Configuration and behavior

The server uses Yandex's OpenAI-compatible Chat Completions endpoint with an
API key and folder ID. Reuse `YANDEX_API_KEY` and `YANDEX_FOLDER_ID` from
dogovorovoi. The service account needs `ai.languageModels.user` and the key scope
`yc.ai.foundationModels.execute`. No new npm dependency is required.

The app generates a complete set of short narrative fragments at depths 0/1/2.
Changing detail changes the playback queue without another model call. Completed
fragments are not repeated; an interrupted fragment restarts. Questions include
the source text and heard fragments. Follow-up chat history is not retained.
Photo recognition returns a hypothesis and optional Wikipedia search query.
SpeechKit provides audio when configured; see the voice configuration below.

Source texts are supplied by the browser from Wikipedia or the prepared demo
material, not independently verified by the server. Source URLs are restricted
to Wikipedia. Prompts instruct the model to avoid unsupported claims and ignore
instructions in source content. This reduces, but does not eliminate, invented
facts. Answers are rendered as text, not HTML.

By default the process allows two simultaneous paid requests and 120 attempts
per hour across all visitors. `AI_REQUESTS_PER_HOUR` changes that limit.
`AI_TIMEOUT_MS` defaults to 60000 (maximum 90000). Failed upstream calls count;
invalid input does not. These are request limits, not currency budgets. No user
accounts or persistent per-user usage tracking exist in this pilot.

Up to 100 successful stories are cached in process memory for 24 hours. Cached
stories do not consume the request budget. Cache and counters reset at restart.
Saved generated stories in the browser can be reopened without regeneration.
Questions and photos are not cached. Photos are limited to 5 MiB, sent only on
button press, and not written to disk. Request data logging is disabled in the
provider request header; no provider response/error body or credential is logged
by this adapter.

`/api/config` reports whether credentials are configured, not whether the key,
quota or models have been verified by a live call. Without both credentials it
returns the previous demo response and does not send provider requests.

## Enable on the existing VM

Wait until the feature PR is merged and the Deploy workflow succeeds. On the VM:

```bash
cd /opt/waystory/source
source_owner="$(stat -c '%U' .git)"
sudo -H -u "$source_owner" git -C "$PWD" pull --ff-only origin main
sudo python3 scripts/import-yandex-settings.py
```

The migration reads only the two Yandex credentials from the running
`dogovorovoi-api-1` container into `/opt/waystory/.env`, preserves other settings
and the file owner, and sets mode 0600. Values are not printed. It does not modify
dogovorovoi. No credential needs to be sent through chat or added to GitHub.

To select other models, edit `/opt/waystory/.env` directly on the VM, for example:

```dotenv
YANDEX_STORY_MODEL=aliceai-llm
YANDEX_QUESTION_MODEL=aliceai-llm-flash
YANDEX_VISION_MODEL=qwen3.6-35b-a3b
AI_REQUESTS_PER_HOUR=120
```

Apply the credentials and the updated upload-size limit for photos:

```bash
sudo -v
bash scripts/deploy-vm.sh
sudo install -m 0644 deploy/nginx/waystory.conf /opt/nginx-sites/waystory.conf
sudo docker exec dogovorovoi-nginx-1 nginx -t && \
  sudo docker exec dogovorovoi-nginx-1 nginx -s reload
curl --fail --show-error https://ws.nayg.ru/api/config
```

Expected configuration: `{"ai":true,"mode":"live","vision":true,"tts":true}`. Refresh the
browser to pick up the new configuration. The Nginx update is needed because a
5 MiB image becomes a larger Base64 JSON request. Existing default 1 MiB limits
would reject normal phone photos before they reach the app.

## Live verification and model comparison

The following sends one story, one question, and one synthetic blank image. It
can incur three paid provider requests; the story may already be cached.
It prints timings and generated text, never provider credentials:

```bash
sudo docker exec -i waystory-waystory-1 node --input-type=module \
  < scripts/check-ai.mjs
```

Expect three HTTP 200 results. The blank image should not yield a confident
landmark name. In the browser, also check a real landmark photo, one unrelated
photo, an ordinary question and a question whose answer is absent from the
source. Confirm all three detail levels remain coherent during playback.

Compare candidate text models by changing one model variable, redeploying and
running the same cases. Evaluate factual grounding, spoken fluency, useful detail
without repetition, uncertainty on missing evidence, and end-to-end latency.
Keep the best model per task, not necessarily the largest for every task.

Local tests use a stubbed provider to verify HTTP contracts and error paths;
they cannot establish real Yandex availability, model output quality or costs.
The live verification must be run on the VM where the credentials exist.

## Cloud voice

SpeechKit API v1 synthesizes MP3 with the neural `filipp` voice by default.
`YANDEX_TTS_VOICE` selects another v1-compatible Russian voice (for example
`marina`); no quality ranking is implied. SpeechKit uses `YANDEX_TTS_API_KEY`
when set, otherwise `YANDEX_API_KEY`. API-key authentication uses the service
account's folder, without a folderId parameter.

The service account needs `ai.speechkit-tts.user`, and a scoped API key needs
`yc.ai.speechkitTts.execute`. A key that can generate stories is not necessarily
allowed to synthesize speech. For 401/403 the app explains the missing access;
it does not silently switch back to the disliked device voice.

Defaults: `YANDEX_TTS_ENABLED=true`, `TTS_REQUESTS_PER_HOUR=120`, 2 concurrent
calls, 30-second provider timeout. This is a separate limit from text/vision.
Audio cache: at most 100 entries / 32 MiB / 24 hours, in memory only. Failed
provider attempts count, cached responses do not. Restart clears both. Browser
playback splits long fragments into <=1000-character pieces. Only the last
audio piece marks the original fragment heard. No prefetch bills unseen text.
Changing playback speed does not resynthesize audio.

Deploy normally; no Nginx configuration change is required for speech. The
existing Yandex key enables cloud mode automatically unless explicitly disabled
with `YANDEX_TTS_ENABLED=false`. `/api/config` reports configuration, not a
verified SpeechKit permission. To test one short paid synthesis from your laptop:

```bash
curl --fail-with-body --show-error https://ws.nayg.ru/api/speech \
  -H 'Content-Type: application/json' \
  --data '{"text":"Привет! Я ваш гид. Давайте узнаем историю этого места."}' \
  --output waystory-voice.mp3
```

Open the MP3 after a successful request. If curl reports an error, its output
file contains the readable error response, not audio. Then test playback, pause,
resume and detail switching on Android. This integration has automated tests
with a stubbed provider; actual voice quality and phone playback require a live
check with the account's permissions.

Official references: [synthesis request](https://aistudio.yandex.ru/ru/docs/speechkit/tts/request),
[voices](https://aistudio.yandex.ru/ru/docs/speechkit/tts/voices),
[authentication](https://aistudio.yandex.ru/ru/docs/speechkit/concepts/auth).
