// LinkedIn NO AI — popup
// Topic-based filter management. Each topic has its own name + keyword list +
// on/off toggle, stored as an array of { id, name, enabled, keywords } in
// chrome.storage.sync.topics.

const $ = id => document.getElementById(id);

// Hardcoded defaults as a fallback seed — real defaults come from storage
// (which content.js migrates/seeds on first load). This is only used if the
// popup opens before the content script has ever run.
const SEED_TOPIC = () => ({
  id: "ai",
  name: "AI",
  enabled: true,
  keywords: [
    "ai", "a.i.", "artificial intelligence",
    "chatgpt", "gpt-4", "gpt-5", "gpt4", "gpt5",
    "claude", "gemini", "copilot", "midjourney",
    "llm", "large language model",
    "generative ai", "genai", "prompt engineering",
    "agentic", "ai agent", "ai-powered", "ai powered"
  ]
});

const SYNC_DEFAULTS = {
  enabled: true,
  hideKeywordMatches: true,
  hideSlopMatches: true,
  slopThreshold: 3,
  hideMode: "collapse",
  markHumans: false,
  showReason: true,
  topics: null  // null triggers seed below
};

let currentTopics = [];

// --- load ------------------------------------------------------------------

async function load() {
  const { hiddenCount = 0 } = await chrome.storage.local.get("hiddenCount");
  $("hiddenCount").textContent = hiddenCount;

  const s = await chrome.storage.sync.get(SYNC_DEFAULTS);
  $("enabled").checked = s.enabled;
  $("hideMode").value = s.hideMode;
  $("markHumans").checked = s.markHumans;
  $("showReason").checked = s.showReason;
  $("hideKeywordMatches").checked = s.hideKeywordMatches;
  $("hideSlopMatches").checked = s.hideSlopMatches;
  $("slopThreshold").value = s.slopThreshold;

  // Seed AI topic if storage has nothing yet.
  if (!Array.isArray(s.topics) || s.topics.length === 0) {
    currentTopics = [SEED_TOPIC()];
    await saveTopics();
  } else {
    currentTopics = s.topics;
  }
  renderTopics();
}

async function saveTopics() {
  await chrome.storage.sync.set({ topics: currentTopics });
}

// --- topic rendering -------------------------------------------------------

function renderTopics() {
  const container = $("topics");
  container.innerHTML = "";
  if (!currentTopics.length) {
    container.innerHTML = `<p style="color:var(--muted);font-size:12px;margin:6px 0">No topics yet. Add one below.</p>`;
    return;
  }
  for (const topic of currentTopics) renderTopicRow(container, topic);
}

function renderTopicRow(container, topic) {
  const det = document.createElement("details");

  const summary = document.createElement("summary");
  summary.className = "topic-row";

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!topic.enabled;
  cb.addEventListener("click", e => e.stopPropagation());
  cb.addEventListener("change", async () => {
    topic.enabled = cb.checked;
    await saveTopics();
  });

  const name = document.createElement("span");
  name.className = "topic-name";
  name.textContent = topic.name || topic.id;

  const count = document.createElement("span");
  count.className = "topic-count";
  const n = (topic.keywords || []).length;
  count.textContent = `${n} ${n === 1 ? "word" : "words"}`;

  const actions = document.createElement("span");
  actions.className = "topic-actions";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove";
  removeBtn.title = "Delete topic";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete topic "${topic.name}" and its ${n} keyword(s)?`)) return;
    currentTopics = currentTopics.filter(t => t.id !== topic.id);
    await saveTopics();
    renderTopics();
    flashOK(`Removed topic "${topic.name}".`);
  });
  actions.appendChild(removeBtn);

  summary.append(cb, name, count, actions);
  det.appendChild(summary);

  // Expanded edit panel
  const edit = document.createElement("div");
  edit.className = "topic-edit";

  const kwList = document.createElement("div");
  kwList.className = "kw-list";
  renderKeywordChips(kwList, topic);
  edit.appendChild(kwList);

  const addRow = document.createElement("div");
  addRow.className = "add-kw-row";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "add keyword (comma-separated OK)";
  input.spellcheck = false;
  const addBtn = document.createElement("button");
  addBtn.className = "primary";
  addBtn.textContent = "Add";
  const doAdd = async () => {
    const raw = input.value.trim();
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
    if (added) {
      await saveTopics();
      renderKeywordChips(kwList, topic);
      count.textContent = `${topic.keywords.length} ${topic.keywords.length === 1 ? "word" : "words"}`;
    }
    input.value = "";
  };
  addBtn.addEventListener("click", doAdd);
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
  addRow.append(input, addBtn);
  edit.appendChild(addRow);

  det.appendChild(edit);
  container.appendChild(det);
}

function renderKeywordChips(listEl, topic) {
  listEl.innerHTML = "";
  const kws = topic.keywords || [];
  if (!kws.length) {
    listEl.innerHTML = `<span style="color:var(--muted);font-size:11px;">No keywords yet — the topic won't match anything.</span>`;
    return;
  }
  for (const kw of kws) {
    const chip = document.createElement("span");
    chip.className = "kw-chip";
    const label = document.createElement("span");
    label.textContent = kw;
    const x = document.createElement("button");
    x.type = "button";
    x.title = "Remove";
    x.textContent = "×";
    x.addEventListener("click", async () => {
      topic.keywords = topic.keywords.filter(k => k !== kw);
      await saveTopics();
      renderKeywordChips(listEl, topic);
      // Update the row count too
      const countSpan = listEl.closest("details").querySelector(".topic-count");
      const n = topic.keywords.length;
      if (countSpan) countSpan.textContent = `${n} ${n === 1 ? "word" : "words"}`;
    });
    chip.append(label, x);
    listEl.appendChild(chip);
  }
}

// --- add new topic ---------------------------------------------------------

async function addNewTopic() {
  const raw = $("newTopicName").value.trim();
  if (!raw) return;

  // Allow "Crypto: crypto, nft, web3" — name before colon, keywords after.
  let name, keywords;
  if (raw.includes(":")) {
    const [n, rest] = raw.split(":");
    name = n.trim();
    keywords = rest.split(/[,\n]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  } else {
    name = raw;
    keywords = [raw.toLowerCase()];
  }

  if (!name) return;

  // Prevent duplicate topic names (case-insensitive)
  if (currentTopics.some(t => t.name.toLowerCase() === name.toLowerCase())) {
    flashErr(`Topic "${name}" already exists.`);
    return;
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36);
  currentTopics.push({ id, name, enabled: true, keywords });
  await saveTopics();
  $("newTopicName").value = "";
  renderTopics();
  flashOK(`Added topic "${name}" (${keywords.length} keyword${keywords.length === 1 ? "" : "s"}).`);
}

function flashOK(msg) { flash(msg, false); }
function flashErr(msg) { flash(msg, true); }
function flash(msg, isErr) {
  const fb = $("topicFeedback");
  fb.className = isErr ? "feedback err" : "feedback";
  fb.textContent = msg;
  setTimeout(() => { if (fb.textContent === msg) fb.textContent = ""; }, 2500);
}

// --- setting wiring --------------------------------------------------------

$("enabled").addEventListener("change", e => chrome.storage.sync.set({ enabled: e.target.checked }));
$("hideMode").addEventListener("change", e => chrome.storage.sync.set({ hideMode: e.target.value }));
$("markHumans").addEventListener("change", e => chrome.storage.sync.set({ markHumans: e.target.checked }));
$("showReason").addEventListener("change", e => chrome.storage.sync.set({ showReason: e.target.checked }));
$("hideKeywordMatches").addEventListener("change", e => chrome.storage.sync.set({ hideKeywordMatches: e.target.checked }));
$("hideSlopMatches").addEventListener("change", e => chrome.storage.sync.set({ hideSlopMatches: e.target.checked }));
$("slopThreshold").addEventListener("change", e => {
  const v = parseInt(e.target.value, 10);
  if (!Number.isNaN(v) && v >= 1 && v <= 10) chrome.storage.sync.set({ slopThreshold: v });
});

$("addTopic").addEventListener("click", addNewTopic);
$("newTopicName").addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); addNewTopic(); }
});

$("openOptions").addEventListener("click", e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
