const WORDS_KEY = "vocabflow_words";
const REVIEWS_KEY = "vocabflow_reviews";
const SETTINGS_KEY = "vocabflow_settings";
const SENTENCES_KEY = "vocabflow_sentences";
const SENTENCE_REVIEWS_KEY = "vocabflow_sentence_reviews";
const QUIZ_HISTORY_KEY = "vocabflow_quiz_history";
const SENTENCE_QUIZ_HISTORY_KEY = "vocabflow_sentence_quiz_history";
const PRACTICE_HISTORY_KEY = "vocabflow_practice_history";

function vocabFlowUuid(prefix = "id") {
  try {
    if (globalThis.crypto?.randomUUID) return `${prefix}_${globalThis.crypto.randomUUID()}`;
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
      return `${prefix}_${hex}`;
    }
  } catch (_) {}
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function storageScopeId() {
  const id = typeof window !== "undefined" ? window.__VOCABFLOW_USER__?.id : null;
  return id != null ? String(id) : "guest";
}

function scopedStorageKey(key) {
  return `vocabflow:u${storageScopeId()}:${key}`;
}

function legacyReadJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function readJSON(key, fallback) {
  try {
    const value = localStorage.getItem(scopedStorageKey(key));
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(scopedStorageKey(key), JSON.stringify(value));
  } catch (error) {
    console.warn("VocabFlow local cache write failed:", error);
  }
}

function shouldMigrateLegacyCache() {
  try { return sessionStorage.getItem("vocabflow_migrate_legacy") === "1"; }
  catch { return false; }
}

function clearLegacyMigrationFlag() {
  try { sessionStorage.removeItem("vocabflow_migrate_legacy"); } catch {}
}

function getLegacyState() {
  return {
    words: legacyReadJSON(WORDS_KEY, []),
    sentences: legacyReadJSON(SENTENCES_KEY, []),
    reviews: legacyReadJSON(REVIEWS_KEY, []),
    sentenceReviews: legacyReadJSON(SENTENCE_REVIEWS_KEY, []),
    quizHistory: legacyReadJSON(QUIZ_HISTORY_KEY, []),
    sentenceQuizHistory: legacyReadJSON(SENTENCE_QUIZ_HISTORY_KEY, []),
    practiceHistory: legacyReadJSON(PRACTICE_HISTORY_KEY, []),
    settings: { theme: "light", dailyNewWords: 10, language: "en", ...legacyReadJSON(SETTINGS_KEY, {}) }
  };
}

const VocabFlowState = (function () {
  const fromStorage = shouldMigrateLegacyCache() ? getLegacyState() : {
    words: readJSON(WORDS_KEY, []),
    sentences: readJSON(SENTENCES_KEY, []),
    reviews: readJSON(REVIEWS_KEY, []),
    sentenceReviews: readJSON(SENTENCE_REVIEWS_KEY, []),
    quizHistory: readJSON(QUIZ_HISTORY_KEY, []),
    sentenceQuizHistory: readJSON(SENTENCE_QUIZ_HISTORY_KEY, []),
    practiceHistory: readJSON(PRACTICE_HISTORY_KEY, []),
    settings: { theme: "light", dailyNewWords: 10, language: "en", ...readJSON(SETTINGS_KEY, {}) }
  };

  const bootstrap = typeof window !== "undefined" ? window.__VOCABFLOW_BOOTSTRAP__ : null;
  let state = bootstrap && typeof bootstrap === "object"
    ? normalizeState(bootstrap)
    : normalizeState(fromStorage);

  function normalizeState(raw) {
    return {
      words: Array.isArray(raw?.words) ? raw.words : [],
      sentences: Array.isArray(raw?.sentences) ? raw.sentences : [],
      reviews: Array.isArray(raw?.reviews) ? raw.reviews : [],
      sentenceReviews: Array.isArray(raw?.sentenceReviews) ? raw.sentenceReviews : [],
      quizHistory: Array.isArray(raw?.quizHistory) ? raw.quizHistory : [],
      sentenceQuizHistory: Array.isArray(raw?.sentenceQuizHistory) ? raw.sentenceQuizHistory : [],
      practiceHistory: Array.isArray(raw?.practiceHistory) ? raw.practiceHistory : [],
      settings: { theme: "light", dailyNewWords: 10, language: "en", ...(raw?.settings || {}) }
    };
  }

  return {
    get() { return state; },
    set(next) { state = normalizeState(next); return state; },
    update(patch) { state = normalizeState({ ...state, ...patch }); return state; }
  };
})();

function getLocalState() {
  const state = VocabFlowState.get();
  return {
    words: [...state.words],
    sentences: [...state.sentences],
    reviews: [...state.reviews],
    sentenceReviews: [...state.sentenceReviews],
    quizHistory: [...state.quizHistory],
    sentenceQuizHistory: [...state.sentenceQuizHistory],
    practiceHistory: [...state.practiceHistory],
    settings: { theme: "light", dailyNewWords: 10, language: "en", ...state.settings }
  };
}

function writeStateToLocal(state, options = {}) {
  const previous = options.onlyChangedFrom;
  const shouldWrite = key => !previous || (key === "settings"
    ? !shallowObjectEqual(previous.settings, state.settings)
    : previous[key] !== state[key]);
  if (shouldWrite("words")) writeJSON(WORDS_KEY, Array.isArray(state.words) ? state.words : []);
  if (shouldWrite("reviews")) writeJSON(REVIEWS_KEY, Array.isArray(state.reviews) ? state.reviews : []);
  if (shouldWrite("settings")) writeJSON(SETTINGS_KEY, { theme: "light", dailyNewWords: 10, language: "en", ...(state.settings || {}) });
  if (shouldWrite("sentences")) writeJSON(SENTENCES_KEY, Array.isArray(state.sentences) ? state.sentences : []);
  if (shouldWrite("sentenceReviews")) writeJSON(SENTENCE_REVIEWS_KEY, Array.isArray(state.sentenceReviews) ? state.sentenceReviews : []);
  if (shouldWrite("quizHistory")) writeJSON(QUIZ_HISTORY_KEY, Array.isArray(state.quizHistory) ? state.quizHistory : []);
  if (shouldWrite("sentenceQuizHistory")) writeJSON(SENTENCE_QUIZ_HISTORY_KEY, Array.isArray(state.sentenceQuizHistory) ? state.sentenceQuizHistory : []);
  if (shouldWrite("practiceHistory")) writeJSON(PRACTICE_HISTORY_KEY, Array.isArray(state.practiceHistory) ? state.practiceHistory : []);
  if (options.memory !== false) VocabFlowState.set(state);
}

function getWords() { return [...VocabFlowState.get().words]; }
function getReviews() { return [...VocabFlowState.get().reviews]; }
function getSettings() { return { theme: "light", dailyNewWords: 10, language: "en", ...VocabFlowState.get().settings }; }

function dispatchVocabFlowDataChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("vocabflow:datachange"));
}

function applyLocalSnapshot(next) {
  const previous = VocabFlowState.get();
  const normalized = VocabFlowState.set(next);
  writeStateToLocal(normalized, { memory: false, onlyChangedFrom: previous });
  dispatchVocabFlowDataChange();
  return normalized;
}

const VocabFlowRemote = (function () {
  const enabled = typeof window !== "undefined" && /^https?:$/.test(window.location.protocol);
  let lastError = null;
  let syncing = false;
  let flushing = false;
  const queueStorageKey = "vocabflow_pending_mutations";
  const pending = (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(scopedStorageKey(queueStorageKey)) || "[]");
      return Array.isArray(parsed)
        ? parsed.filter(item => item && typeof item.url === "string" && item.options).map(item => ({ ...item, strict: false }))
        : [];
    } catch { return []; }
  })();
  const waiters = new Map();

  function persistQueue() {
    try { localStorage.setItem(scopedStorageKey(queueStorageKey), JSON.stringify(pending)); }
    catch (error) { console.warn("VocabFlow could not persist pending changes:", error); }
  }

  function settle(entry, error, value) {
    const waiter = waiters.get(entry.id);
    if (!waiter) return;
    waiters.delete(entry.id);
    if (error) waiter.reject(error); else waiter.resolve(value);
  }

  function dispatchSyncError(error, permanent = false, rolledBack = false) {
    lastError = error;
    console.warn("VocabFlow API sync failed:", error);
    window.dispatchEvent(new CustomEvent("vocabflow:syncerror", {
      detail: { error, permanent, rolledBack, pendingCount: pending.length }
    }));
  }

  async function flushPending() {
    if (!enabled || flushing || !pending.length) return;
    flushing = true;
    let drained = false;
    try {
      while (pending.length) {
        const entry = pending[0];
        try {
          const result = await request(entry.url, entry.options);
          pending.shift();
          persistQueue();
          lastError = null;
          settle(entry, null, result);
        } catch (error) {
          const permanent = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && ![401, 403, 429].includes(error.status);
          dispatchSyncError(error, permanent, Boolean(entry.strict));
          if (permanent) {
            pending.shift();
            persistQueue();
            settle(entry, error);
            continue;
          }
          // An import/restore is rolled back on failure, so its queued request
          // must not run later after the user has already been told it failed.
          const strictEntries = pending.filter(item => item.strict);
          for (const strictEntry of strictEntries) {
            pending.splice(pending.indexOf(strictEntry), 1);
            settle(strictEntry, error);
          }
          if (!entry.strict && strictEntries.length) dispatchSyncError(error, false, true);
          persistQueue();
          settle(entry, error);
          break;
        }
      }
      drained = pending.length === 0;
    } finally {
      flushing = false;
      if (drained) window.dispatchEvent(new CustomEvent("vocabflow:syncsuccess"));
    }
  }

  async function ensureCsrfToken() {
    if (!window.VocabFlowApi) throw new Error("VocabFlow API client is not loaded");
    return window.VocabFlowApi.ensureCsrfToken();
  }

  async function request(url, options = {}) {
    if (!window.VocabFlowApi) throw new Error("VocabFlow API client is not loaded");
    return window.VocabFlowApi.request(url, options);
  }

  function enqueue(url, options, { strict = false } = {}) {
    const entry = { id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, url, options, strict };
    pending.push(entry);
    persistQueue();
    const result = new Promise((resolve, reject) => waiters.set(entry.id, { resolve, reject }));
    flushPending();
    return strict ? result : result.catch(() => false);
  }

  function queueWordCreate(word) { return enqueue("/api/words", { method: "POST", body: JSON.stringify(word) }); }
  function queueWordUpdate(word) { return enqueue(`/api/words/${encodeURIComponent(word.id)}`, { method: "PATCH", body: JSON.stringify(word) }); }
  function queueWordDelete(id) { return enqueue(`/api/words/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  function queueSentenceCreate(sentence) { return enqueue("/api/sentences", { method: "POST", body: JSON.stringify(sentence) }); }
  function queueSentenceUpdate(sentence) { return enqueue(`/api/sentences/${encodeURIComponent(sentence.id)}`, { method: "PATCH", body: JSON.stringify(sentence) }); }
  function queueSentenceDelete(id) { return enqueue(`/api/sentences/${encodeURIComponent(id)}`, { method: "DELETE" }); }
  function queueAppend(endpoint, value) { return enqueue(endpoint, { method: "POST", body: JSON.stringify(value) }); }
  function queuePut(endpoint, value, options = {}) { return enqueue(endpoint, { method: "PUT", body: JSON.stringify(value) }, options); }

  async function syncFromServer({ force = false } = {}) {
    if (!enabled || syncing) return null;
    syncing = true;
    try {
      const response = await request("/api/bootstrap");
      const serverState = response?.state || {};
      const local = getLocalState();
      const localHas = hasLocalData(local);
      const serverHas = hasLocalData(serverState);
      // SQLite/Backend is the source of truth once it contains data.
      // LocalStorage is used only to migrate an older local-only workspace
      // when the server database is still empty.
      const next = serverHas ? serverState : (localHas ? local : serverState);
      applyLocalSnapshot(next);
      if (!serverHas && localHas) await queuePut("/api/bootstrap", local);
      else if (force && !serverHas) await queuePut("/api/bootstrap", next);
      return next;
    } catch (error) {
      lastError = error;
      console.warn("VocabFlow could not sync with backend:", error);
      return null;
    } finally {
      syncing = false;
    }
  }

  return Object.freeze({
    enabled, request, syncFromServer, ensureCsrfToken,
    queueWordCreate, queueWordUpdate, queueWordDelete,
    queueSentenceCreate, queueSentenceUpdate, queueSentenceDelete,
    queueAppend, queuePut, flushPending,
    retryPending: flushPending,
    hasPendingMutations() { return pending.length > 0; },
    pendingMutationCount() { return pending.length; },
    get lastError() { return lastError; }
  });
})();

if (typeof window !== "undefined") window.VocabFlowRemote = VocabFlowRemote;
if (typeof window !== "undefined") window.addEventListener("online", () => VocabFlowRemote.retryPending());

function hasLocalData(state) {
  return Boolean(
    state.words.length || state.sentences.length || state.reviews.length || state.sentenceReviews.length ||
    state.quizHistory.length || state.sentenceQuizHistory.length || state.practiceHistory.length
  );
}

function getDateSafe(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function mergeById(localItems, serverItems) {
  const map = new Map();
  for (const item of Array.isArray(serverItems) ? serverItems : []) if (item?.id != null) map.set(String(item.id), item);
  for (const item of Array.isArray(localItems) ? localItems : []) if (item?.id != null) map.set(String(item.id), item);
  return [...map.values()];
}

function mergeHistory(localItems, serverItems, keyCandidates = ["sessionId"]) {
  const map = new Map();
  const signature = item => {
    for (const key of keyCandidates) if (item?.[key]) return `${key}:${item[key]}`;
    return JSON.stringify(item || {});
  };
  for (const item of Array.isArray(serverItems) ? serverItems : []) map.set(signature(item), item);
  for (const item of Array.isArray(localItems) ? localItems : []) map.set(signature(item), item);
  return [...map.values()].sort((a, b) => getDateSafe(a?.date || a?.reviewedAt) - getDateSafe(b?.date || b?.reviewedAt));
}

function mergeState(local, server) {
  return {
    words: mergeById(local.words, server.words),
    sentences: mergeById(local.sentences, server.sentences),
    reviews: mergeHistory(local.reviews, server.reviews, ["wordId", "reviewedAt"]),
    sentenceReviews: mergeHistory(local.sentenceReviews, server.sentenceReviews, ["sentenceId", "reviewedAt"]),
    quizHistory: mergeHistory(local.quizHistory, server.quizHistory, ["sessionId", "date"]),
    sentenceQuizHistory: mergeHistory(local.sentenceQuizHistory, server.sentenceQuizHistory, ["sessionId", "date"]),
    practiceHistory: mergeHistory(local.practiceHistory, server.practiceHistory, ["sessionId", "date"]),
    settings: { theme: "light", dailyNewWords: 10, language: "en", ...(server.settings || {}) }
  };
}

function shallowObjectEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(key => Object.is(a[key], b[key]));
}

function diffById(previous, next, onCreate, onUpdate, onDelete) {
  const before = new Map((Array.isArray(previous) ? previous : []).map(item => [String(item?.id), item]));
  const after = new Map((Array.isArray(next) ? next : []).map(item => [String(item?.id), item]));
  for (const [id, item] of after) {
    if (!before.has(id)) onCreate(item);
    else if (!shallowObjectEqual(before.get(id), item)) onUpdate(item, before.get(id));
  }
  for (const id of before.keys()) if (!after.has(id)) onDelete(id);
}

function saveWords(words) {
  const value = Array.isArray(words) ? words : [];
  const previous = getWords();
  const nextIds = new Set(value.map(item => String(item?.id)));
  const removedIds = new Set(
    previous.filter(item => !nextIds.has(String(item?.id))).map(item => String(item?.id))
  );
  const currentState = VocabFlowState.get();
  const cleanedReviews = removedIds.size
    ? currentState.reviews.filter(review => !removedIds.has(String(review?.wordId)))
    : currentState.reviews;

  applyLocalSnapshot({ ...currentState, words: value, reviews: cleanedReviews });
  if (VocabFlowRemote.enabled) {
    diffById(previous, value,
      item => VocabFlowRemote.queueWordCreate(item),
      item => VocabFlowRemote.queueWordUpdate(item),
      id => VocabFlowRemote.queueWordDelete(id)
    );
    // Word deletion cascades reviews in SQLite, so keep the client cache in
    // sync and persist the cleaned review collection after the delete queue.
  }
  return getWords();
}

function addWord(word) {
  const value = saveWords([...getWords(), word]);
  return value.find(x => x.id === word.id) || word;
}
function updateWord(id, patch) {
  const updated = getWords().map(w => w.id === id ? { ...w, ...patch } : w);
  return saveWords(updated).find(w => w.id === id) || null;
}
function deleteWord(id) { return saveWords(getWords().filter(w => w.id !== id)); }

function saveReviews(value) {
  const array = Array.isArray(value) ? value : [];
  applyLocalSnapshot({ ...VocabFlowState.get(), reviews: array });
  return getReviews();
}

function addReview(value) {
  const next = [...getReviews(), value];
  applyLocalSnapshot({ ...VocabFlowState.get(), reviews: next });
  return value;
}

function applyServerWordReview(word, review) {
  const state = VocabFlowState.get();
  const reviews = [...state.reviews];
  if (review) reviews.push(review);
  const words = state.words.map(item => String(item.id) === String(word.id) ? word : item);
  applyLocalSnapshot({ ...state, words, reviews });
  return word;
}

function applyServerSentenceReview(sentence, review) {
  const state = VocabFlowState.get();
  const reviews = [...state.sentenceReviews];
  if (review) reviews.push(review);
  const sentences = state.sentences.map(item => String(item.id) === String(sentence.id) ? sentence : item);
  applyLocalSnapshot({ ...state, sentences, sentenceReviews: reviews });
  return sentence;
}

function saveSettings(value) {
  const next = { ...getSettings(), ...(value || {}) };
  applyLocalSnapshot({ ...VocabFlowState.get(), settings: next });
  if (VocabFlowRemote.enabled) VocabFlowRemote.queuePut("/api/settings", next);
  return getSettings();
}

function clearCurrentUserStorage() {
  const keys=[WORDS_KEY,REVIEWS_KEY,SETTINGS_KEY,SENTENCES_KEY,SENTENCE_REVIEWS_KEY,QUIZ_HISTORY_KEY,SENTENCE_QUIZ_HISTORY_KEY,PRACTICE_HISTORY_KEY,"vocabflow_pending_mutations"];
  for(const key of keys){try{localStorage.removeItem(scopedStorageKey(key));}catch{}}
  applyLocalSnapshot({words:[],reviews:[],sentences:[],sentenceReviews:[],quizHistory:[],sentenceQuizHistory:[],practiceHistory:[],settings:{theme:"light",dailyNewWords:10,language:"en"}});
}

const HISTORY_STATE_KEYS = Object.freeze({
  [QUIZ_HISTORY_KEY]: "quizHistory",
  [SENTENCE_QUIZ_HISTORY_KEY]: "sentenceQuizHistory",
  [PRACTICE_HISTORY_KEY]: "practiceHistory",
  [SENTENCE_REVIEWS_KEY]: "sentenceReviews"
});

function historyStateKey(key) {
  return HISTORY_STATE_KEYS[key] || null;
}

function saveHistoryCollection(key, value, endpoint) {
  const array = Array.isArray(value) ? value : [];
  const stateKey = historyStateKey(key);
  if (!stateKey) return array;
  applyLocalSnapshot({ ...VocabFlowState.get(), [stateKey]: array });
  if (VocabFlowRemote.enabled && endpoint) VocabFlowRemote.queuePut(endpoint, array);
  return array;
}

function appendHistoryItem(key, value, endpoint) {
  const stateKey = historyStateKey(key);
  if (!stateKey) return [];
  const current = [...(VocabFlowState.get()[stateKey] || [])];
  const next = [...current, value];
  applyLocalSnapshot({ ...VocabFlowState.get(), [stateKey]: next });
  if (VocabFlowRemote.enabled && endpoint) VocabFlowRemote.queueAppend(endpoint, value);
  return next;
}

function exportCSVData() {
  const headers = ["id","word","definition","partOfSpeech","exampleSentence","category","difficulty","favorite","status","repetitions","interval","lastReview","nextReview","createdAt"];
  const rows = getWords().map(w => headers.map(k => csvEscape(w[k])));
  return [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
}
function exportJSONData() {
  return JSON.stringify(getLocalState(), null, 2);
}
function csvEscape(v) {
  let s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

if (typeof document !== "undefined") {
  document.addEventListener("vocabflow:pageinit", async () => {
    if (typeof window !== "undefined" && window.__VOCABFLOW_BOOTSTRAP__) {
      const serverState = window.__VOCABFLOW_BOOTSTRAP__;
      const local = getLocalState();
      const legacy = shouldMigrateLegacyCache() ? getLegacyState() : null;
      const source = legacy && hasLocalData(legacy) ? legacy : local;
      const localHadData = hasLocalData(source);
      const serverHasData = hasLocalData(serverState);
      const hasPendingMutations = VocabFlowRemote.hasPendingMutations();
      const next = serverHasData ? serverState : source;
      applyLocalSnapshot(hasPendingMutations ? source : next);
      try {
        if (!hasPendingMutations && !serverHasData && localHadData && VocabFlowRemote.enabled) {
          await VocabFlowRemote.queuePut("/api/bootstrap", source);
          if (legacy) clearLegacyMigrationFlag();
        } else if (legacy) {
          clearLegacyMigrationFlag();
        }
      } catch (error) {
        console.warn("VocabFlow legacy migration is pending:", error);
      }
      VocabFlowRemote.flushPending();
      delete window.__VOCABFLOW_BOOTSTRAP__;
    }
  }, { once: true });
}
