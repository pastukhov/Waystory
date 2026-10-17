# RouterAI: AI and narration

Production uses `https://routerai.ru/api/v1` with Bearer authentication. Add the
repository Actions secret `ROUTERAI_API_KEY`. Deploy installs it privately in the
VM environment and sets `AI_PROVIDER=routerai` and `TTS_PROVIDER=routerai`.
The browser never receives the key. Removing the Actions secret does not revoke
an already installed VM key. Rotate the secret and deploy to replace it.

Defaults:

| Operation | Setting | Default |
| --- | --- | --- |
| Stories | ROUTERAI_STORY_MODEL | openai/gpt-4.1-mini |
| Questions and translations | ROUTERAI_QUESTION_MODEL | openai/gpt-4.1-mini |
| Photo identification | ROUTERAI_VISION_MODEL | openai/gpt-4.1-mini |
| Evidence review | ROUTERAI_REVIEW_MODEL | openai/gpt-4.1-mini |
| Speech | ROUTERAI_TTS_MODEL | x-ai/grok-voice-tts-1.0 |
| Speech voice | ROUTERAI_TTS_VOICE | eve |

`ROUTERAI_TTS_VOICE_RU` / `ROUTERAI_TTS_VOICE_EN` override the shared voice.
`ROUTERAI_TTS_ENABLED=false` disables cloud speech. Model/voice overrides are
server environment settings; only the key is delivered by Actions in this change.
Select chat models supporting JSON Schema, temperature and max_tokens, and an
image-capable vision model. TTS models must support the selected voice and MP3.
Defaults are listed in RouterAI's public model catalog as of 2026-10-17. Catalog
availability is not proof that a particular account can call the model.

The chat endpoint is `/chat/completions`; narration uses `/audio/speech` with
`model`, `input`, `voice`, `response_format: "mp3"`. Source validation and evidence
review stay enabled. Technical review errors are not treated as content rejection.
Narration strips source IDs before synthesis, validates MP3, caps response size,
and caches successful audio. Failed responses are not cached. Existing timeouts,
concurrency limits and optional per-hour limits remain in effect.

No request-time fallback to Yandex occurs. For an explicit rollback set
`AI_PROVIDER=yandex` / `TTS_PROVIDER=yandex` with valid legacy credentials.
While the RouterAI Actions secret is populated, the next deploy selects RouterAI
again. Without an explicit selection, a present RouterAI key selects RouterAI;
otherwise legacy Yandex configuration is used for compatibility.

Metrics use `provider="routerai_ai"` and `provider="routerai_tts"`; the existing
Grafana dashboard and provider access alerts select these labels automatically.
There are no model IDs, prompts, audio or credentials in metric labels.

## Verification after deploy

- `Operations → diagnose`: reports selected providers and key presence only.
- `Operations → ai-test`: paid basic call plus story generation and evidence review
  on fixed public source excerpts (three calls).
- `Operations → speech-test`: two short paid MP3 syntheses, Russian and English.
- Test a real landmark and photo in the signed-in application. Validate actual
  audio pronunciation on a phone; an MP3 signature check does not assess voice quality.

HTTP 401/403 means access denied, 402 insufficient balance, 429 a service limit;
5xx/timeouts indicate service/network failure. These observations do not establish
which underlying RouterAI model provider caused an error. Probes must succeed to
claim live availability; a successful deployment alone does not prove it.

Source text/questions/photos and narration text now go to RouterAI and its selected
upstream providers. The Yandex-specific `x-data-logging-enabled` header is not sent
to RouterAI and is not a retention guarantee there. This server does not save photos.
See [RouterAI documentation](https://routerai.ru/docs/guides/overview/quickstart)
and [speech API](https://routerai.ru/docs/guides/overview/multimodal/text-to-speech).
