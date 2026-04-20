// LinkedIn NO AI — options page

const SYNC_KEYS = {
  enabled: true,
  hideKeywordMatches: true,
  hideSlopMatches: true,
  slopThreshold: 3,
  useApiDetector: false,
  apiConfidenceThreshold: 0.7,
  apiBorderlineOnly: true,
  hideMode: "collapse",
  showReason: true,
  markHumans: false,
  topics: null
};

const LOCAL_KEYS = {
  aiProvider: "none",
  anthropicKey: "",
  anthropicModel: "claude-haiku-4-5-20251001",
  openaiKey: "",
  openaiModel: "gpt-4o-mini",
  gptzeroKey: ""
};

const DEFAULT_AI_KEYWORDS = [
  "ai", "a.i.", "artificial intelligence",
  "chatgpt", "gpt-4", "gpt-5", "gpt4", "gpt5",
  "claude", "gemini", "copilot", "midjourney",
  "llm", "large language model",
  "generative ai", "genai", "prompt engineering",
  "agentic", "ai agent", "ai-powered", "ai powered"
];

const $ = id => document.getElementById(id);
let currentTopics = [];

// --- load ------------------------------------------------------------------

async function load() {
  const sync = await chrome.storage.sync.get(SYNC_KEYS);
  const local = await chrome.storage.local.get(LOCAL_KEYS);

  $("enabled").checked = sync.enabled;
  $("hideKeywordMatches").checked = sync.hideKeywordMatches;
  $("hideSlopMatches").checked = sync.hideSlopMatches;
  $("slopThreshold").value = sync.slopThreshold;
  $("useApiDetector").checked = sync.useApiDetector;
  $("apiConfidenceThreshold").value = sync.apiConfidenceThreshold;
  $("apiBorderlineOnly").checked = sync.apiBorderlineOnly;
  $("hideStyle").value = sync.hideMode;
  $("showReason").checked = sync.showReason;
  $("markHumans").checked = sync.markHumans;

  if (Array.isArray(sync.topics) && sync.topics.length) {
    currentTopics = sync.topics;
  } else {
    currentTopics = [{ id: "ai", name: "AI", enabled: true, keywords: DEFAULT_AI_KEYWORDS.slice() }];
    await chrome.storage.sync.set({ topics: currentTopics });
  }

  $("aiProvider").value = local.aiProvider;
  $("anthropicKey").value = local.anthropicKey;
  $("anthropicModel").value = local.anthropicModel;
  $("openaiKey").value = local.openaiKey;
  $("openaiModel").value = local.openaiModel;
  $("gptzeroKey").value = local.gptzeroKey;

  updateProviderVisibility();
  renderTopics();
}

async function saveTopics() {
  await chrome.storage.sync.set({ topics: currentTopics });
}

// --- topic UI --------------------------------------------------------------

function renderTopics() {
  const list = $("topicsList");
  list.innerHTML = "";
  if (!currentTopics.length) {
    list.innerHTML = `<p class="muted" style="margin:6px 0;">No topics yet — add one below.</p>`;
    return;
  }
  for (const topic of currentTopics) renderTopicCard(list, topic);
}

function renderTopicCard(container, topic) {
  const card = document.createElement("div");
  card.className = "topic-card" + (topic.enabled ? "" : " disabled");

  // --- head: toggle, name (editable), count, remove ---
  const head = document.createElement("div");
  head.className = "topic-card-head";

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = !!topic.enabled;
  toggle.title = "Enable / disable this topic";
  toggle.addEventListener("change", async () => {
    topic.enabled = toggle.checked;
    card.classList.toggle("disabled", !topic.enabled);
    await saveTopics();
  });

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = topic.name || topic.id;
  nameInput.title = "Click to rename";
  nameInput.addEventListener("change", async () => {
    const v = nameInput.value.trim();
    if (!v) {
      nameInput.value = topic.name;
      return;
    }
    topic.name = v;
    await saveTopics();
  });

  const count = document.createElement("span");
  count.className = "topic-card-count";
  const updateCount = () => {
    const n = (topic.keywords || []).length;
    count.textContent = `${n} ${n === 1 ? "word" : "words"}`;
  };
  updateCount();

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "topic-card-remove";
  removeBtn.textContent = "Delete topic";
  removeBtn.addEventListener("click", async () => {
    const n = (topic.keywords || []).length;
    if (!confirm(`Delete topic "${topic.name}" and its ${n} keyword(s)?`)) return;
    currentTopics = currentTopics.filter(t => t.id !== topic.id);
    await saveTopics();
    renderTopics();
  });

  head.append(toggle, nameInput, count, removeBtn);
  card.appendChild(head);

  // --- keyword chips ---
  const kwList = document.createElement("div");
  kwList.className = "topic-kw-list";
  const renderChips = () => {
    kwList.innerHTML = "";
    const kws = topic.keywords || [];
    if (!kws.length) {
      kwList.innerHTML = `<span class="muted" style="font-size:12px;">No keywords yet — add some below, or this topic won't match anything.</span>`;
      return;
    }
    for (const kw of kws) {
      const chip = document.createElement("span");
      chip.className = "topic-kw";
      const label = document.createElement("span");
      label.textContent = kw;
      const x = document.createElement("button");
      x.type = "button";
      x.title = "Remove keyword";
      x.textContent = "×";
      x.addEventListener("click", async () => {
        topic.keywords = topic.keywords.filter(k => k !== kw);
        await saveTopics();
        renderChips();
        updateCount();
      });
      chip.append(label, x);
      kwList.appendChild(chip);
    }
  };
  renderChips();
  card.appendChild(kwList);

  // --- add keyword row ---
  const addRow = document.createElement("div");
  addRow.className = "topic-kw-add";
  const addInput = document.createElement("input");
  addInput.type = "text";
  addInput.placeholder = "Add keyword(s) — comma-separated OK";
  addInput.spellcheck = false;
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "Add";
  const doAddKw = async () => {
    const raw = addInput.value.trim();
    if (!raw) return;
    const incoming = raw.split(/[,\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    const existing = new Set((topic.keywords || []).map(k => k.toLowerCase()));
    let added = 0;
    for (const kw of incoming) {
      if (!existing.has(kw)) {
        topic.keywords = topic.keywords || [];
        topic.keywords.push(kw);
        existing.add(kw);
        added++;
      }
    }
    addInput.value = "";
    if (added) {
      await saveTopics();
      renderChips();
      updateCount();
    }
  };
  addBtn.addEventListener("click", doAddKw);
  addInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doAddKw(); } });
  addRow.append(addInput, addBtn);
  card.appendChild(addRow);

  container.appendChild(card);
}

// --- add new topic ---------------------------------------------------------

async function addNewTopic() {
  const name = $("newTopicName").value.trim();
  if (!name) {
    flash("Enter a topic name first.", true);
    return;
  }
  if (currentTopics.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    flash(`Topic "${name}" already exists.`, true);
    return;
  }
  const rawKws = $("newTopicKeywords").value.trim();
  const keywords = rawKws
    ? rawKws.split(/[,\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
    : [name.toLowerCase()];

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
  currentTopics.push({ id, name, enabled: true, keywords });
  await saveTopics();
  $("newTopicName").value = "";
  $("newTopicKeywords").value = "";
  renderTopics();
  flash(`Added topic "${name}" (${keywords.length} keyword${keywords.length === 1 ? "" : "s"}).`);
}

// --- general settings save -------------------------------------------------

async function save() {
  // Topics are saved live as the user edits — the Save button handles the
  // non-topic settings and API key configuration.
  await chrome.storage.sync.set({
    enabled: $("enabled").checked,
    hideKeywordMatches: $("hideKeywordMatches").checked,
    hideSlopMatches: $("hideSlopMatches").checked,
    slopThreshold: parseInt($("slopThreshold").value, 10) || 3,
    useApiDetector: $("useApiDetector").checked,
    apiConfidenceThreshold: parseFloat($("apiConfidenceThreshold").value) || 0.7,
    apiBorderlineOnly: $("apiBorderlineOnly").checked,
    hideMode: $("hideStyle").value,
    showReason: $("showReason").checked,
    markHumans: $("markHumans").checked
  });

  await chrome.storage.local.set({
    aiProvider: $("aiProvider").value,
    anthropicKey: $("anthropicKey").value.trim(),
    anthropicModel: $("anthropicModel").value.trim() || "claude-haiku-4-5-20251001",
    openaiKey: $("openaiKey").value.trim(),
    openaiModel: $("openaiModel").value.trim() || "gpt-4o-mini",
    gptzeroKey: $("gptzeroKey").value.trim()
  });

  flash("Saved.");
}

function updateProviderVisibility() {
  const p = $("aiProvider").value;
  document.querySelectorAll(".provider-cfg").forEach(el => { el.hidden = true; });
  if (p === "anthropic") $("anthropic-cfg").hidden = false;
  if (p === "openai") $("openai-cfg").hidden = false;
  if (p === "gptzero") $("gptzero-cfg").hidden = false;
}

function flash(msg, isErr) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = isErr ? "#b42318" : "#057642";
  setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, 2000);
}

// --- wiring ---------------------------------------------------------------

$("save").addEventListener("click", save);
$("aiProvider").addEventListener("change", updateProviderVisibility);
$("clearCache").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clearCache" });
  flash("Detector cache cleared.");
});

$("addTopic").addEventListener("click", addNewTopic);
$("newTopicName").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addNewTopic(); }
});
$("newTopicKeywords").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addNewTopic(); }
});

load();
