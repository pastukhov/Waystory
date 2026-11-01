# Tour navigation

The place title is followed by one primary tour control: Listen to tour, Continue,
Pause, Retry chapter, or Listen again, depending on playback/progress. New tours
play continuously from the overview. Saved cursors resume without skipping or
replaying completed chapters; manual chapter selection plays that chapter only.
At the end, Listen again explicitly clears completion and starts the overview.

A numbered chapter table of contents shows title, duration/status, and the current
or completed chapter. It contains no summaries or chapter bodies. One collapsed
reader below it follows the chosen chapter; opening/closing it is a user choice
preserved across player redraws. Materials and attribution follow the tour.
Source article text, when available, is separately collapsed below these sections.
Tour mode hides legacy story/depth/restart controls; tour, mini-player and question
continuation always route to the tour player. Source-only mode keeps its existing
article playback when tour capability is unavailable. No server generation changes.

Verification: player state transition unit tests; both RU/EN browser smoke suites,
including continuous advance, explicit retry, stale selection, cursor restore,
auth expiry, questions, 390/412px widths, reader persistence and mocked screenshots.
