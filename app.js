(function () {
  "use strict";

  const API = "https://openrouter.ai/api/v1";
  const $ = (id) => document.getElementById(id);
  const el = {
    keyPanel: $("keyPanel"), keyInput: $("keyInput"), keySave: $("keySave"), keyClear: $("keyClear"),
    keyToggle: $("keyToggle"), newChat: $("newChat"),
    modelSearch: $("modelSearch"), modelList: $("modelList"),
    messages: $("messages"), empty: $("empty"), error: $("error"),
    composer: $("composer"), input: $("input"), send: $("send"),
  };

  // ---------- storage helpers ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };

  let apiKey = store.get("or_key") || "";
  let model = store.get("or_model") || "";
  let models = [];
  let history = [];
  try { history = JSON.parse(store.get("or_history") || "[]"); } catch (e) { history = []; }
  let busy = false;

  // ---------- errors ----------
  function showError(msg) { el.error.textContent = msg; el.error.hidden = false; }
  function clearError() { el.error.hidden = true; el.error.textContent = ""; }

  // ---------- API key ----------
  function updateKeyUI() {
    el.keyInput.value = apiKey;
    el.keyPanel.hidden = !!apiKey && el.keyPanel.dataset.open !== "1";
    el.keyToggle.textContent = apiKey ? "API key" : "Add API key";
  }
  el.keyToggle.addEventListener("click", () => {
    const open = el.keyPanel.hidden;
    el.keyPanel.dataset.open = open ? "1" : "0";
    el.keyPanel.hidden = !open;
    if (open) el.keyInput.focus();
  });
  el.keySave.addEventListener("click", () => {
    const v = el.keyInput.value.trim();
    if (!v) { showError("Enter your OpenRouter API key first."); return; }
    apiKey = v; store.set("or_key", v);
    el.keyPanel.dataset.open = "0";
    clearError(); updateKeyUI();
  });
  el.keyClear.addEventListener("click", () => {
    apiKey = ""; store.del("or_key");
    el.keyPanel.dataset.open = "1";
    updateKeyUI();
  });

  // ---------- models ----------
  async function loadModels() {
    el.modelSearch.placeholder = "Loading models...";
    try {
      const res = await fetch(API + "/models");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      models = (data.data || [])
        .map((m) => ({ id: m.id, name: m.name || m.id }))
        .sort((a, b) => a.name.localeCompare(b.name));
      el.modelSearch.placeholder = "Search " + models.length + " models...";
      const found = models.find((m) => m.id === model);
      if (found) el.modelSearch.value = found.name;
      else if (!model && models.length) selectModel(models[0], false);
    } catch (e) {
      el.modelSearch.placeholder = "Could not load models";
      showError("Could not load the model list (" + e.message + "). Check your connection and reload the page.");
    }
  }

  function selectModel(m, closeList = true) {
    model = m.id; store.set("or_model", model);
    el.modelSearch.value = m.name;
    if (closeList) hideList();
  }

  let activeIdx = -1, shown = [];
  function renderList() {
    const q = el.modelSearch.dataset.filtering === "1" ? el.modelSearch.value.trim().toLowerCase() : "";
    shown = models.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)).slice(0, 200);
    el.modelList.innerHTML = "";
    if (!shown.length) {
      const li = document.createElement("li"); li.className = "none"; li.textContent = "No models match";
      el.modelList.appendChild(li);
    }
    shown.forEach((m, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = m.name;
      const sub = document.createElement("small"); sub.textContent = m.id;
      li.appendChild(sub);
      li.addEventListener("mousedown", (e) => { e.preventDefault(); selectModel(m); });
      if (i === activeIdx) li.classList.add("active");
      el.modelList.appendChild(li);
    });
  }
  function showList() { el.modelList.hidden = false; el.modelSearch.setAttribute("aria-expanded", "true"); renderList(); }
  function hideList() {
    el.modelList.hidden = true; el.modelSearch.setAttribute("aria-expanded", "false");
    el.modelSearch.dataset.filtering = "0"; activeIdx = -1;
    const cur = models.find((m) => m.id === model);
    el.modelSearch.value = cur ? cur.name : "";
  }
  el.modelSearch.addEventListener("focus", () => { el.modelSearch.select(); showList(); });
  el.modelSearch.addEventListener("input", () => { el.modelSearch.dataset.filtering = "1"; activeIdx = 0; showList(); });
  el.modelSearch.addEventListener("blur", hideList);
  el.modelSearch.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (el.modelList.hidden) showList();
      activeIdx = Math.max(0, Math.min(shown.length - 1, activeIdx + (e.key === "ArrowDown" ? 1 : -1)));
      renderList();
      const a = el.modelList.querySelector(".active"); if (a) a.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[activeIdx]) selectModel(shown[activeIdx]);
    } else if (e.key === "Escape") { el.modelSearch.blur(); }
  });

  // ---------- chat rendering ----------
  function addBubble(role, text) {
    el.empty.hidden = true;
    const d = document.createElement("div");
    d.className = "msg " + role;
    const who = document.createElement("span"); who.className = "who";
    who.textContent = role === "user" ? "You" : "Assistant";
    const body = document.createElement("span"); body.className = "body"; body.textContent = text;
    d.append(who, body);
    el.messages.appendChild(d);
    el.messages.scrollTop = el.messages.scrollHeight;
    return d;
  }
  function addLoading() {
    const d = document.createElement("div");
    d.className = "msg assistant";
    d.innerHTML = '<span class="who">Assistant</span><span class="dots" aria-label="Loading"><span></span><span></span><span></span></span>';
    el.messages.appendChild(d);
    el.messages.scrollTop = el.messages.scrollHeight;
    return d;
  }
  function renderHistory() {
    el.messages.querySelectorAll(".msg").forEach((n) => n.remove());
    el.empty.hidden = history.length > 0;
    history.forEach((m) => addBubble(m.role, m.content));
  }
  function saveHistory() { store.set("or_history", JSON.stringify(history)); }

  el.newChat.addEventListener("click", () => {
    if (busy) return;
    history = []; saveHistory(); clearError(); renderHistory();
  });

  // ---------- sending ----------
  function explain(status, apiMsg) {
    const extra = apiMsg ? " (" + apiMsg + ")" : "";
    if (status === 401) return "Your API key was rejected. Check it in API key settings." + extra;
    if (status === 402) return "Not enough OpenRouter credits for this model. Add credits or pick a free model." + extra;
    if (status === 403) return "This request was blocked by OpenRouter moderation or key limits." + extra;
    if (status === 404) return "This model is unavailable right now. Pick a different one." + extra;
    if (status === 429) return "Rate limit reached. Wait a moment and try again." + extra;
    if (status >= 500) return "OpenRouter or the model provider had a server error. Try again shortly." + extra;
    return "Request failed with status " + status + "." + extra;
  }

  async function sendMessage(text) {
    if (!apiKey) { el.keyPanel.dataset.open = "1"; updateKeyUI(); showError("Add your OpenRouter API key to start chatting."); return; }
    if (!model) { showError("Select a model first."); return; }

    clearError();
    busy = true; el.send.disabled = true;
    history.push({ role: "user", content: text });
    addBubble("user", text);
    const loader = addLoading();

    try {
      const res = await fetch(API + "/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + apiKey,
          "Content-Type": "application/json",
          "HTTP-Referer": location.origin || "https://openrouter.ai",
          "X-Title": "OpenRouter Chat",
        },
        body: JSON.stringify({ model: model, messages: history }),
      });
      let data = null;
      try { data = await res.json(); } catch (e) {}
      const apiMsg = data && data.error && (data.error.message || data.error);
      if (!res.ok) throw { status: res.status, apiMsg: typeof apiMsg === "string" ? apiMsg : "" };
      if (apiMsg) throw { status: (data.error.code && Number(data.error.code)) || 500, apiMsg: String(apiMsg) };

      const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!reply) throw { status: 0, apiMsg: "The model returned an empty response.", custom: true };

      loader.remove();
      history.push({ role: "assistant", content: reply });
      addBubble("assistant", reply);
      saveHistory();
    } catch (err) {
      loader.remove();
      history.pop(); // drop the unanswered message so history stays valid
      el.messages.querySelector(".msg.user:last-of-type") && removeLastUserBubble();
      el.input.value = text; autosize();
      if (err && err.status !== undefined) {
        showError(err.custom ? err.apiMsg + " Try again or pick another model." : explain(err.status, err.apiMsg));
      } else {
        showError("Network error. Check your connection and try again.");
      }
    } finally {
      busy = false; el.send.disabled = false; el.input.focus();
    }
  }
  function removeLastUserBubble() {
    const users = el.messages.querySelectorAll(".msg.user");
    if (users.length) users[users.length - 1].remove();
    if (!history.length) el.empty.hidden = false;
  }

  // ---------- composer ----------
  function autosize() { el.input.style.height = "auto"; el.input.style.height = Math.min(el.input.scrollHeight, 160) + "px"; }
  el.input.addEventListener("input", autosize);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); el.composer.requestSubmit(); }
  });
  el.composer.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = el.input.value.trim();
    if (!text || busy) return;
    el.input.value = ""; autosize();
    sendMessage(text);
  });

  // ---------- init ----------
  el.keyPanel.dataset.open = apiKey ? "0" : "1";
  updateKeyUI();
  renderHistory();
  loadModels();
})();
