// LinkedIn NO AI — background service worker
// Proxies AI-detection API calls so the API key lives only in extension
// storage (never injected into the LinkedIn page context) and so we bypass
// CORS. Results are cached per post-text hash.

const cache = new Map(); // hash -> { isAI: boolean, confidence: number, provider: string }
const MAX_CACHE = 500;

async function sha1(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function cachePut(hash, value) {
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(hash, value);
}

// -- Providers --------------------------------------------------------------

async function detectAnthropic(text, apiKey, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required for calls made from a browser/extension context.
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model || "claude-haiku-4-5-20251001",
      max_tokens: 20,
      system:
        "You classify short LinkedIn posts as AI-generated or human-written. " +
        "Respond with ONLY a JSON object: {\"ai\": true|false, \"confidence\": 0.0-1.0}. " +
        "Consider: generic corporate tone, em-dash overuse, 'it's not just X, it's Y' constructions, " +
        "empty aphorisms, numbered/bulleted structure with emoji bullets, hook-style openers.",
      messages: [{ role: "user", content: text.slice(0, 4000) }]
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const raw = json.content?.[0]?.text || "{}";
  const parsed = safeJson(raw);
  return { isAI: !!parsed.ai, confidence: Number(parsed.confidence) || 0 };
}

async function detectOpenAI(text, apiKey, model) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      response_format: { type: "json_object" },
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "You classify short LinkedIn posts as AI-generated or human-written. " +
            "Respond with ONLY a JSON object: {\"ai\": true|false, \"confidence\": 0.0-1.0}."
        },
        { role: "user", content: text.slice(0, 4000) }
      ]
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content || "{}";
  const parsed = safeJson(raw);
  return { isAI: !!parsed.ai, confidence: Number(parsed.confidence) || 0 };
}

async function detectGPTZero(text, apiKey) {
  const res = await fetch("https://api.gptzero.me/v2/predict/text", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({ document: text.slice(0, 5000) })
  });
  if (!res.ok) throw new Error(`GPTZero ${res.status}: ${await res.text()}`);
  const json = await res.json();
  // GPTZero response shape: documents[0].class_probabilities.ai (0-1)
  const p = json.documents?.[0]?.class_probabilities?.ai ?? 0;
  return { isAI: p >= 0.5, confidence: p };
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { /* fall through */ }
  // Model sometimes wraps JSON in prose; try to extract.
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return {};
}

// -- Dispatcher -------------------------------------------------------------

async function detect(text) {
  const { aiProvider, anthropicKey, anthropicModel, openaiKey, openaiModel, gptzeroKey } =
    await chrome.storage.local.get([
      "aiProvider", "anthropicKey", "anthropicModel",
      "openaiKey", "openaiModel", "gptzeroKey"
    ]);

  if (!aiProvider || aiProvider === "none") {
    return { isAI: false, confidence: 0, skipped: true, reason: "api disabled" };
  }

  const hash = await sha1(text);
  if (cache.has(hash)) return { ...cache.get(hash), cached: true };

  let result;
  try {
    if (aiProvider === "anthropic") {
      if (!anthropicKey) throw new Error("missing Anthropic API key");
      result = await detectAnthropic(text, anthropicKey, anthropicModel);
    } else if (aiProvider === "openai") {
      if (!openaiKey) throw new Error("missing OpenAI API key");
      result = await detectOpenAI(text, openaiKey, openaiModel);
    } else if (aiProvider === "gptzero") {
      if (!gptzeroKey) throw new Error("missing GPTZero API key");
      result = await detectGPTZero(text, gptzeroKey);
    } else {
      return { isAI: false, confidence: 0, skipped: true, reason: `unknown provider: ${aiProvider}` };
    }
  } catch (err) {
    return { isAI: false, confidence: 0, error: String(err.message || err) };
  }

  result.provider = aiProvider;
  cachePut(hash, result);
  return result;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "detectAI" && typeof msg.text === "string") {
    detect(msg.text).then(sendResponse);
    return true; // async
  }
  if (msg?.type === "clearCache") {
    cache.clear();
    sendResponse({ ok: true });
    return;
  }
});
