// LinkedIn NO AI — pure detection logic.
// No chrome.* calls. Works in: MV3 content script (loaded before content.js),
// plain browser <script>, and Node (module.exports at bottom).

const DEFAULT_KEYWORDS = [
  "ai", "a.i.", "artificial intelligence",
  "chatgpt", "gpt-4", "gpt-5", "gpt4", "gpt5",
  "claude", "gemini", "copilot", "midjourney",
  "llm", "large language model",
  "generative ai", "genai", "prompt engineering",
  "agentic", "ai agent", "ai-powered", "ai powered"
];

// Topic groups: each topic has an independent on/off toggle and its own
// keyword list. The content script flattens enabled topics for matching.
const DEFAULT_TOPICS = [
  { id: "ai", name: "AI", enabled: true, keywords: DEFAULT_KEYWORDS.slice() }
];

const SLOP_PHRASES = [
  "in today's fast-paced",
  "in today's rapidly evolving",
  "navigate the complexities",
  "navigating the complexities",
  "delve into",
  "delving into",
  "at its core",
  "unlock the potential",
  "unlock your potential",
  "game-changer",
  "game changer",
  "revolutionize",
  "paradigm shift",
  "synergy",
  "leverage",
  "harness the power",
  "a testament to",
  "tapestry",
  "it's not just",
  "it is not just",
  "at the end of the day",
  "the future of",
  "empower",
  "empowering",
  "cutting-edge",
  "state-of-the-art",
  "seamless",
  "seamlessly",
  "robust",
  "holistic",
  "transformative",
  "ever-evolving",
  "ever evolving",
  "in conclusion,",
  "to sum up,",
  "moreover,",
  "furthermore,",
  "however, it is important to note",
  "it is worth noting",
  "it's worth noting",
  "remember,",
  "here's the thing",
  "let's dive in",
  "let's dive into",
  "buckle up",
  "hot take",
  "𝐭𝐡𝐫𝐞𝐚𝐝",
  "🧵"
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ");
}

function matchedKeyword(text, keywords = DEFAULT_KEYWORDS) {
  const lower = normalize(text);
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (!k) continue;
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegex(k)}([^a-z0-9]|$)`, "i");
    if (pattern.test(lower)) return kw;
  }
  return null;
}

function slopScore(text) {
  const lower = normalize(text);
  let score = 0;
  const hits = [];

  for (const phrase of SLOP_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) {
      score += 1;
      hits.push(phrase);
    }
  }

  const emDashes = (text.match(/—/g) || []).length;
  if (emDashes >= 2) { score += 1; hits.push(`em-dashes×${emDashes}`); }
  if (emDashes >= 4) { score += 2; hits.push("heavy em-dash"); }

  if (/\bit'?s not just\b[^.]{2,80}\bit'?s\b/i.test(text)) {
    score += 2; hits.push("not-just-X-it's-Y");
  }

  if (/^[\s]*[🚀✨💡🔥]/u.test(text)) { score += 1; hits.push("emoji-opener"); }

  const emojiBulletLines = (text.match(/^\s*[✅💡🔑🚀📌🎯→▶•][^\n]{0,300}$/gmu) || []).length;
  if (emojiBulletLines >= 3) { score += 2; hits.push(`emoji-bullets×${emojiBulletLines}`); }

  if (/\b1\.\s.+\b2\.\s.+\b3\.\s/s.test(text)) { score += 1; hits.push("numbered-list"); }

  if (/[\u{1D400}-\u{1D7FF}]/u.test(text)) { score += 1; hits.push("unicode-bold"); }

  const hashtags = (text.match(/#[A-Za-z0-9_]+/g) || []).length;
  if (hashtags >= 5) { score += 1; hits.push(`hashtags×${hashtags}`); }

  if (/^(ever wondered|what if i told you|imagine if|here'?s why|here'?s how)/i.test(text.trim())) {
    score += 2; hits.push("hook-opener");
  }

  return { score, hits };
}

// Composite classify used by tests — mirrors content.js logic without chrome.*
function classify(text, opts = {}) {
  const {
    hideKeywordMatches = true,
    hideSlopMatches = true,
    slopThreshold = 3,
    keywords = DEFAULT_KEYWORDS
  } = opts;

  if (!text || text.length < 20) {
    return { action: "keep", reason: "too short" };
  }

  if (hideKeywordMatches) {
    const kw = matchedKeyword(text, keywords);
    if (kw) return { action: "hide", layer: "keyword", reason: `keyword: "${kw}"`, keyword: kw };
  }

  const slop = hideSlopMatches ? slopScore(text) : { score: 0, hits: [] };
  if (hideSlopMatches && slop.score >= slopThreshold) {
    return {
      action: "hide", layer: "slop",
      reason: `AI-slop score ${slop.score} (${slop.hits.slice(0, 4).join(", ")})`,
      score: slop.score, hits: slop.hits
    };
  }

  return { action: "keep", score: slop.score, hits: slop.hits };
}

// Expose globally (browser, MV3 content script) and as a Node module.
const API = {
  DEFAULT_KEYWORDS, DEFAULT_TOPICS, SLOP_PHRASES,
  matchedKeyword, slopScore, classify,
  escapeRegex, normalize
};

if (typeof globalThis !== "undefined") {
  globalThis.LNI = API;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = API;
}
