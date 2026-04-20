// LinkedIn NO AI — content script.
// Detection logic: detector.js (loaded first via manifest).
// DOM selectors updated 2026-04-20 against current LinkedIn markup:
//   - Post:  [role="listitem"][componentkey*="FeedType_MAIN_FEED"]
//   - Text:  [data-testid="expandable-text-box"]
//   - Native hide button:  button[aria-label^="Hide post by"]

// detector.js runs first (per manifest) and declares matchedKeyword, slopScore,
// DEFAULT_KEYWORDS as top-level functions/consts in this same content-script scope.
// We reference them directly — re-declaring via destructuring throws SyntaxError.
const LNI_DEFAULT_KEYWORDS = globalThis.LNI.DEFAULT_KEYWORDS;
const LNI_DEFAULT_TOPICS = globalThis.LNI.DEFAULT_TOPICS;

const DEFAULTS = {
  enabled: true,
  hideKeywordMatches: true,
  hideSlopMatches: true,
  slopThreshold: 3,
  useApiDetector: false,
  apiConfidenceThreshold: 0.7,
  apiBorderlineOnly: true,
  topics: LNI_DEFAULT_TOPICS,
  // Legacy flat list kept for migration only — not used after migration runs.
  keywords: LNI_DEFAULT_KEYWORDS,
  // "collapse" = DOM-only placeholder with "Show anyway"
  // "native"   = click LinkedIn's own "Hide post" button (tells LinkedIn's algo)
  // "remove"   = display:none
  // "tint"     = don't hide, just add red outline + AI badge (shows what's flagged
  //              without removing it — good for tuning / sanity-checking)
  hideMode: "collapse",
  showReason: true,
  // When true, posts with zero AI signals also get a green "HUMAN" border/badge
  // (only visible in "tint" mode — collapse/remove modes don't touch human posts).
  markHumans: false
};

const state = {
  settings: { ...DEFAULTS },
  hiddenCount: 0,
  seen: new WeakSet()
};

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);

  // Migration: old schema stored a flat `keywords` array and no `topics`.
  // Convert it to a single "AI" topic so existing users don't lose their list.
  if (!Array.isArray(stored.topics) || stored.topics.length === 0) {
    const kw = Array.isArray(stored.keywords) && stored.keywords.length
      ? stored.keywords
      : LNI_DEFAULT_KEYWORDS.slice();
    stored.topics = [{ id: "ai", name: "AI", enabled: true, keywords: kw }];
    await chrome.storage.sync.set({ topics: stored.topics });
  }

  state.settings = { ...DEFAULTS, ...stored };
}

// Flatten enabled topics into a single keyword list for matching.
function activeKeywords() {
  return (state.settings.topics || [])
    .filter(t => t && t.enabled)
    .flatMap(t => Array.isArray(t.keywords) ? t.keywords : []);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const k of Object.keys(changes)) state.settings[k] = changes[k].newValue;
  resetAllPosts();
  scanAll();
});

// Fully revert any visual change the extension made to a post — including
// display:none on children (collapse mode), the .lni-note placeholder, and
// data-lni-mark tint markers. Without this, switching modes live leaves posts
// with display:none children → postText() returns "" → nothing re-fires.
function resetAllPosts() {
  document.querySelectorAll("[data-lni-hidden]").forEach(post => {
    post.removeAttribute("data-lni-hidden");
    post.style.display = "";
    post.querySelector(":scope > .lni-note")?.remove();
    post.querySelectorAll(":scope > *").forEach(el => { el.style.display = ""; });
  });
  document.querySelectorAll("[data-lni-mark]").forEach(post => {
    post.removeAttribute("data-lni-mark");
    post.removeAttribute("data-lni-reason");
  });
  state.hiddenCount = 0;
  chrome.storage.local.set({ hiddenCount: 0 });
}

// --- DOM -------------------------------------------------------------------

const POST_SELECTORS = [
  // 2026 markup:
  '[role="listitem"][componentkey*="FeedType_MAIN_FEED"]',
  '[role="listitem"][componentkey*="FeedType"]',
  // Older markup fallback:
  "div.feed-shared-update-v2",
  "div[data-id^='urn:li:activity']",
  "[data-urn*='urn:li:activity']"
];

const TEXT_SELECTORS = [
  '[data-testid="expandable-text-box"]',
  ".update-components-text",
  ".feed-shared-text",
  ".feed-shared-update-v2__description",
  ".update-components-update-v2__commentary"
];

function findPosts() {
  const nodes = new Set();
  for (const sel of POST_SELECTORS) {
    document.querySelectorAll(sel).forEach(n => nodes.add(n));
  }
  return [...nodes];
}

function postText(post) {
  for (const sel of TEXT_SELECTORS) {
    const el = post.querySelector(sel);
    if (el && el.innerText && el.innerText.trim().length >= 20) return el.innerText;
  }
  return post.innerText || "";
}

// Returns a category string if this "post" is actually a non-post widget
// (sponsored ad, jobs carousel, people-you-may-know, news module, etc.) and
// should be skipped entirely — no AI flag, no HUMAN badge. Returns null for
// real user/company posts that should be evaluated normally.
const WIDGET_HEADINGS = [
  /^jobs recommended/i,
  /^recommended for you/i,
  /^people you may know/i,
  /^add to your feed/i,
  /^news for you/i,
  /^today'?s top/i,
  /^suggested for you/i,
  /^trending in/i,
  /^follow these/i,
  /^ads you may/i,
  /^pages you'?ll like/i,
  /^more from/i
];

function nonPostWidgetKind(post) {
  // Promoted / sponsored ads have a short <p>Promoted</p> label in the header.
  // Guard against false-positives from body text like "I just got promoted!"
  // by requiring it to be a standalone <p> with that exact text.
  const ps = post.querySelectorAll("p");
  for (const p of ps) {
    if (p.textContent.trim() === "Promoted") return "ad";
  }

  // Jobs / news / follow carousels contain a carousel container.
  if (post.querySelector('[data-testid="carousel-container"]')) return "carousel";

  // Nested role="listitem" elements = this "post" is actually a container of
  // multiple sub-items (follow suggestions, trending pages, etc.). Real posts
  // never have role="listitem" descendants beyond themselves.
  const nestedListItems = post.querySelectorAll(':scope [role="listitem"]');
  if (nestedListItems.length >= 2) return "recommendations";

  // Multiple "Follow X" buttons = a follow-recommendation widget.
  const followBtns = post.querySelectorAll('button[aria-label^="Follow "]');
  if (followBtns.length >= 2) return "follow-widget";

  // Match known widget heading text in any of the first few text nodes.
  for (let i = 0; i < Math.min(ps.length, 4); i++) {
    const t = ps[i].textContent.trim();
    if (!t || t.length > 80) continue;
    if (WIDGET_HEADINGS.some(re => re.test(t))) return "widget";
  }

  return null;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// --- hide strategies -------------------------------------------------------

function hideNative(post, reason) {
  const btn = post.querySelector('button[aria-label^="Hide post by"]');
  if (!btn) return false;
  btn.click();
  console.log(`[LNI] native-hid: ${reason}`);
  return true;
}

function hideCollapse(post, reason) {
  if (post.hasAttribute("data-lni-hidden")) return;
  post.setAttribute("data-lni-hidden", "1");
  state.hiddenCount += 1;
  chrome.storage.local.set({ hiddenCount: state.hiddenCount });

  const note = document.createElement("div");
  note.className = "lni-note";
  note.innerHTML = `
    <span class="lni-note-label">Hidden by LinkedIn AI:DR</span>
    ${state.settings.showReason ? `<span class="lni-note-reason">${escapeHtml(reason)}</span>` : ""}
    <button class="lni-note-reveal" type="button">Show anyway</button>
  `;
  note.querySelector(".lni-note-reveal").addEventListener("click", () => {
    post.querySelectorAll(":scope > *:not(.lni-note)").forEach(el => { el.style.display = ""; });
    note.remove();
    post.removeAttribute("data-lni-hidden");
  });
  post.querySelectorAll(":scope > *").forEach(el => { el.style.display = "none"; });
  post.prepend(note);
}

function hideRemove(post) {
  post.setAttribute("data-lni-hidden", "1");
  post.style.display = "none";
  state.hiddenCount += 1;
  chrome.storage.local.set({ hiddenCount: state.hiddenCount });
}

function hideTint(post, reason) {
  if (post.getAttribute("data-lni-mark") === "ai") return;
  post.setAttribute("data-lni-mark", "ai");
  if (state.settings.showReason) {
    post.setAttribute("data-lni-reason", reason);
  }
  state.hiddenCount += 1;
  chrome.storage.local.set({ hiddenCount: state.hiddenCount });
  console.log(`[LNI] tinted AI: ${reason}`);
}

function markHumanTint(post) {
  if (post.hasAttribute("data-lni-mark")) return;
  post.setAttribute("data-lni-mark", "human");
}

function hidePost(post, reason) {
  if (post.hasAttribute("data-lni-hidden")) return;
  const mode = state.settings.hideMode;
  if (mode === "tint") return hideTint(post, reason);
  if (mode === "native" && hideNative(post, reason)) return;
  if (mode === "remove") return hideRemove(post);
  hideCollapse(post, reason);
}

// --- evaluation ------------------------------------------------------------

function evaluatePost(post) {
  if (state.seen.has(post)) return;
  state.seen.add(post);
  if (!state.settings.enabled) return;

  // Widgets = ads, jobs carousels, people-you-may-know, etc. These aren't
  // organic posts, so they can't be "human" — but they CAN contain AI content
  // (e.g. a Promoted ad about an AI product, or "AI Engineer" job listings)
  // that the user still wants hidden. So: run keyword check on widgets; skip
  // slop/human/API (slop signals don't apply to ads/job cards).
  const widgetKind = nonPostWidgetKind(post);

  const text = postText(post);
  if (!text || text.length < 20) return;

  // Keyword filter applies to both organic posts AND widgets.
  if (state.settings.hideKeywordMatches) {
    const kw = matchedKeyword(text, activeKeywords());
    if (kw) {
      const reason = widgetKind
        ? `${widgetKind}: "${kw}"`
        : `keyword: "${kw}"`;
      return hidePost(post, reason);
    }
  }

  // For widgets: keyword didn't match → leave them alone. No slop scan (ads
  // aren't AI-written slop in the usual sense), no HUMAN badge, no API call.
  if (widgetKind) {
    console.log(`[LNI] widget (${widgetKind}): no keyword match, leaving alone`);
    return;
  }

  let score = 0;
  if (state.settings.hideSlopMatches) {
    const s = slopScore(text);
    score = s.score;
    if (s.score >= state.settings.slopThreshold) {
      return hidePost(post, `slop ${s.score} (${s.hits.slice(0, 4).join(", ")})`);
    }
  }

  // Positive marker: tint-mode only, posts with no AI signals get a green HUMAN badge.
  // We only do this visually, never collapse/remove humans.
  if (
    state.settings.markHumans &&
    state.settings.hideMode === "tint" &&
    score === 0
  ) {
    markHumanTint(post);
  }

  if (state.settings.useApiDetector) {
    const inRange =
      !state.settings.apiBorderlineOnly ||
      (score >= 1 && score < state.settings.slopThreshold);
    if (inRange) queueApiCheck(post, text, score);
  }
}

function scanAll() {
  state.seen = new WeakSet();
  findPosts().forEach(evaluatePost);
}

// --- API queue -------------------------------------------------------------

const apiQueue = [];
let apiBusy = false;

function queueApiCheck(post, text, heuristicScore) {
  apiQueue.push({ post, text, heuristicScore });
  if (!apiBusy) drainApiQueue();
}

async function drainApiQueue() {
  apiBusy = true;
  while (apiQueue.length) {
    const { post, text, heuristicScore } = apiQueue.shift();
    if (!post.isConnected || post.hasAttribute("data-lni-hidden")) continue;
    try {
      const res = await chrome.runtime.sendMessage({ type: "detectAI", text });
      if (!res) continue;
      if (res.skipped) {
        if (!state.__loggedApiSkipped) {
          console.warn(`[LNI] API detector enabled but skipped: ${res.reason}. ` +
            `Open the extension Options page and set a provider + API key.`);
          state.__loggedApiSkipped = true;
        }
        continue;
      }
      if (res.error) {
        console.warn(`[LNI] API detector error: ${res.error}`);
        continue;
      }
      if (res.isAI && res.confidence >= state.settings.apiConfidenceThreshold) {
        hidePost(
          post,
          `AI ${(res.confidence * 100).toFixed(0)}% (${res.provider})` +
            (heuristicScore ? ` + slop ${heuristicScore}` : "")
        );
      } else if (!res.isAI && state.settings.markHumans && state.settings.hideMode === "tint") {
        markHumanTint(post);
      }
    } catch (err) {
      console.warn("[LNI] API call failed:", err?.message || err);
    }
  }
  apiBusy = false;
}

// --- observe ---------------------------------------------------------------

let scanTimer = null;
function scheduleScan() {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    findPosts().forEach(evaluatePost);
  }, 150);
}

const observer = new MutationObserver(scheduleScan);

async function init() {
  await loadSettings();
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleScan();
  console.log("[LNI] content script loaded, settings:", state.settings);
}

init();
