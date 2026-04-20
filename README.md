# LinkedIn AI:DR

**AI; Didn't Read** - a Chrome extension that filters AI-themed and AI-generated posts out of your LinkedIn feed.

Scrolling LinkedIn has become exhausting - half the feed is either shouting about AI, written *by* AI, or both. This extension hides them before you have to read them.

---

## Installation

No Chrome Web Store listing. Load it as an unpacked extension (works with any regular Chrome profile where you're already logged in):

1. Open `chrome://extensions` in Chrome.
2. Top-right: turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Visit `linkedin.com/feed`. The extension activates automatically.

To update after editing code:

1. `chrome://extensions` → click the circular **refresh** icon on the LinkedIn AI:DR card.
2. Reload the LinkedIn tab.

---

## What it does

Every post in your LinkedIn feed runs through a pipeline. As soon as one check fires, the post is flagged. Anything that doesn't trip the checks is left alone.

### Pipeline

```
  ┌──────────────────────────────────────────────────────────┐
  │  1. Is this a real post?                                 │
  │     (Skip ads, jobs carousels, "recommended for you"     │
  │      widgets - but keyword-check them so AI-themed       │
  │      ads still get hidden)                               │
  └──────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌──────────────────────────────────────────────────────────┐
  │  2. Topic / keyword filter                               │
  │     If the post contains any keyword from an enabled     │
  │     topic (e.g. "chatgpt", "llm", "copilot") → HIDE      │
  └──────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌──────────────────────────────────────────────────────────┐
  │  3. Heuristic "AI slop" detector                         │
  │     Scores patterns common in AI-written LinkedIn posts  │
  │     (em-dashes, "delve into", "it's not just X, it's Y", │
  │      emoji bullets, hook openers, 5+ hashtags, etc.)     │
  │     If total score ≥ threshold (default 3) → HIDE        │
  └──────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌──────────────────────────────────────────────────────────┐
  │  4. Optional: API-based AI detector                      │
  │     If enabled and the post is borderline (1–2 slop      │
  │     signals), send it to Claude / OpenAI / GPTZero for   │
  │     a real AI-vs-human classification.                   │
  │     If confidence ≥ threshold → HIDE                     │
  └──────────────────────────────────────────────────────────┘
                            │
                            ▼
  ┌──────────────────────────────────────────────────────────┐
  │  5. If nothing fired AND markHumans is on AND we're in   │
  │     tint mode → mark the post with a green HUMAN badge   │
  └──────────────────────────────────────────────────────────┘
```

### What "HIDE" looks like

You pick the display mode in the popup (or options page):

| Mode | What happens |
|---|---|
| **Collapse** (default) | The post is replaced with a grey placeholder: `Hidden by LinkedIn AI:DR - <reason> - [Show anyway]`. Reversible per-post by clicking the button. |
| **Tint** | The post stays visible but gets a red border and an `AI` badge in the corner. Good for sanity-checking what the detector is catching without actually hiding anything. |
| **Native** | Clicks LinkedIn's own "Hide post" button for you - the post disappears from the feed for real, and LinkedIn's algorithm learns to show you less of that. Not reversible. |
| **Remove** | `display: none` - post is gone, no placeholder. |

### Positive HUMAN marker (tint mode only)

If you turn on **"Mark human posts"** in the popup, posts that passed every check *and* had zero AI signals get a green outline with a `HUMAN` badge. Only visible in tint mode - in collapse/remove/native modes, "human" posts just look like normal posts.

Useful for tuning: scroll the feed with tint + markHumans, see what's red, what's green, what's untouched (the "maybe" zone). Adjust the slop threshold based on what you see.

---

## Usage

### The toolbar popup (click the extension icon)

One-click access to the stuff you change most:

- **Extension enabled** - master on/off
- **Display mode** - collapse / tint / native / remove
- **Mark human posts** - toggles the green HUMAN badge (tint mode only)
- **Show reason on flagged posts** - when off, the badge just says "AI" instead of "AI · keyword: chatgpt"
- **Use topic/keyword filters** - master switch for the keyword-match layer
- **AI-slop heuristic** - master switch for the pattern-matching layer
- **Sensitivity** - lowering this makes the slop detector more aggressive (more false positives, catches more AI)
- **Topics** - list of your topic filters with on/off toggles and delete buttons
- **New topic field** - type a name, press Add to create a new topic

Every control saves to storage the moment you change it - no save button, no tab reload needed.

### Adding topics

A **topic** is a named group of keywords that share an on/off toggle. The default is one topic called "AI" seeded with 20+ AI-related terms (`chatgpt`, `llm`, `copilot`, `midjourney`, `claude`, etc.).

To add more (e.g. if you also want to hide crypto posts), use the "New topic" field:

- `Crypto` → creates a topic called "Crypto" with one keyword: `crypto`
- `Crypto: crypto, nft, web3, blockchain` → creates "Crypto" with those four keywords
- Use the popup to add a topic quickly. Use the options page (right-click extension → Options) to manage keywords per topic in detail - chip-list editor with × buttons per keyword.

Topics are independent: deleting or editing one never touches another.

### The options page (right-click icon → Options)

Full version of the popup plus:
- Bulk topic management with chip-list keyword editors
- API detector setup (pick provider, paste API key, choose model)
- Cache clearing for the API detector

---

## API detector (optional)

Heuristics catch the obvious AI posts but miss ones written in a more human style. If you want real classification for borderline cases, you can plug in an API:

1. Open the Options page.
2. Turn on **Use an AI-detection API**.
3. Pick a provider:
   - **Anthropic Claude** - cheap with `claude-haiku-4-5-20251001`. Paste an `sk-ant-...` key.
   - **OpenAI** - cheap with `gpt-4o-mini`. Paste an `sk-...` key.
   - **GPTZero** - purpose-built AI-text classifier. Paste the key from gptzero.me.
4. Save.

**Cost control:** "Borderline only" mode (on by default) only calls the API for posts that got a slop score of 1–2 (not caught by heuristics, not obviously clean). Posts with score 0 or ≥ threshold skip the API entirely.

**Security:** API keys are stored in `chrome.storage.local`. All provider calls go through the background service worker - the key is never injected into LinkedIn's page context.

---

## How the pieces fit together

| File | What it does |
|---|---|
| `manifest.json` | MV3 manifest. Declares permissions, content script, popup, options, background worker. |
| `detector.js` | Pure detection logic (no chrome.* calls). Exports `matchedKeyword`, `slopScore`, default topics. Loaded first into the content script scope. |
| `content.js` | The actual work. Finds posts in the DOM, extracts text, calls detector, applies visual changes. Watches for new posts via MutationObserver. Talks to the background worker for API detection. |
| `content.css` | Styles for the collapsed-post placeholder and the tint-mode red/green badges. |
| `background.js` | Service worker. Proxies API calls (Anthropic / OpenAI / GPTZero) so the API key lives outside the page. Caches classification results by post-text hash. |
| `popup.html` / `popup.js` | Toolbar popup - quick settings + topic management. |
| `options.html` / `options.js` | Full options page - same settings + API keys + deeper topic/keyword editor. |

### When LinkedIn changes their DOM

LinkedIn updates its markup every few months. When the extension stops hiding posts, the fix is usually in one place: `content.js` near the top - `POST_SELECTORS` and `TEXT_SELECTORS` lists. Grab a sample post's HTML from DevTools and update the selectors to match.

Currently (April 2026) the real selectors are:
- Posts: `[role="listitem"][componentkey*="FeedType_MAIN_FEED"]`
- Post text: `[data-testid="expandable-text-box"]`
- Native hide button: `button[aria-label^="Hide post by"]`

---

## Heuristic slop detector - what it looks for

Each signal adds points. Post is hidden when the total hits your threshold (default 3).

| Signal | Points | Catches |
|---|---|---|
| Phrase match (~45 terms: `delve into`, `tapestry`, `navigate the complexities`, `game-changer`, `it's not just`, `empower`, `ever-evolving`, etc.) | +1 each | AI's favorite vocabulary |
| 2+ em-dashes | +1 | AI loves em-dashes |
| 4+ em-dashes | +2 | …really loves them |
| `it's not just X, it's Y` | +2 | The signature rhetorical flip |
| Starts with 🚀 / ✨ / 💡 / 🔥 | +1 | Hook emoji opener |
| 3+ lines starting with emoji bullets (✅💡🔑🚀📌🎯) | +2 | "Here are 5 things" structure |
| `1. ... 2. ... 3. ...` | +1 | Numbered list |
| Unicode math-bold chars 𝐛𝐨𝐥𝐝 | +1 | LinkedIn formatting gimmick |
| 5+ hashtags | +1 | Hashtag pile |
| Starts with "Ever wondered…" / "What if I told you…" / "Here's why…" | +2 | Hook opener |

Tuning: lower the threshold in the popup (1–2) for aggressive filtering; raise it (4+) if legitimate posts are getting flagged. Or add your own signals by editing `detector.js:87-113`.

---

## Widget detection

Not everything in a LinkedIn "feed" is a post. The extension detects and skips:
- **Promoted ads** (a `<p>Promoted</p>` header label)
- **Jobs carousels** (`[data-testid="carousel-container"]`)
- **"Recommended for you" / "Trending" / "Suggested for you" / etc.** (matched by heading regex)
- **Nested `role="listitem"` containers** - if a post contains multiple sub-listitems, it's a list widget
- **Multiple "Follow X" buttons** in one container

Widgets still get the keyword filter run against them (so an AI-themed ad gets hidden) but skip the slop heuristic, API detector, and the HUMAN badge. An ad can't be "human-written" by any meaningful definition.

---

## Privacy

- **No telemetry, no analytics, no external calls** except the AI detector API you explicitly configure.
- API calls only happen when you enable the detector and paste a key. The key is stored in `chrome.storage.local` (your machine only, never synced).
- All filtering runs locally in your browser.
- The extension touches only `linkedin.com` tabs (see `host_permissions` in manifest).

---

## License

Personal project. Do whatever you want with it.
