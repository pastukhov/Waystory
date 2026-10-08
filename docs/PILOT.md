# Waystory pilot

## Core experience

A person notices something while walking, chooses the place, and listens to its story. They can ask for less or more detail while listening. The pilot demonstrates this interaction with prepared examples and browser speech.

## Interaction contract

- Depth and speech rate are independent.
- A speech section becomes heard only after its end callback.
- Changing depth cancels the old queue and excludes completed sections.
- Choosing another place invalidates stale requests and speech callbacks.
- Prepared questions pause the main story; continuing returns to uncompleted sections.
- Missing AI access is visible. A prepared answer is never presented as a live AI response.
- Images remain local until an explicit recognition action with a configured backend.

## Next steps

1. Choose an AI provider and implement a server-side API with secrets and request limits.
2. Generate source-grounded story sections and answer questions using the heard context.
3. Add cautious photo identification with user confirmation and source lookup.
4. Test on real iOS and Android phones: voice availability, interruption, GPS errors, network loss, and headsets.
5. Add English UI/content and localization.
6. Measure response latency and cost per walk before introducing paid packages.

## Limitations

No real AI provider, payments, accounts, background tracking, wake word, automatic route narration, or synchronization across devices. Browser QA, live network integrations, and field testing remain outstanding. The current server is for local development, not a public paid API.
