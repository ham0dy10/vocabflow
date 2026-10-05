
function trIO(key,fallback){return typeof t==="function"?t(key):fallback}

function setIOMessage(text, type = "") {
  const el = document.getElementById("ioMessage");
  if (!el) return;
  el.textContent = text;
  el.className = `io-message ${type}`;
}

function selectedMode() {
  return document.querySelector('input[name="importMode"]:checked')?.value || "merge";
}

function downloadVocabularyFile(name, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportWordsAsCSV() {
  downloadVocabularyFile("vocabflow-words.csv", exportCSVData(), "text/csv;charset=utf-8");
}

function exportWordsAsJSON() {
  downloadVocabularyFile("vocabflow-backup.json", exportJSONData(), "application/json;charset=utf-8");
}

function parseVocabularyCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"') {
      if (quoted && next === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(value => value !== "")) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some(value => value !== "")) rows.push(row);
  if (!rows.length) throw new Error(trIO("io_csvEmpty", "CSV file is empty."));
  const headers = rows[0].map(value => value.trim());
  for (const required of ["word", "definition"]) {
    if (!headers.includes(required)) throw new Error(`${trIO("io_csvMissingColumn", "CSV is missing required column:")} ${required}`);
  }
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function prepareVocabularyImport(items, mode = "merge", existing = getWords()) {
  if (!Array.isArray(items)) throw new Error(trIO("io_invalidJson", "Invalid vocabulary data."));
  const byWord = new Map((mode === "replace" ? [] : existing).map(word => [String(word.word || "").trim().toLocaleLowerCase(), word]));
  let added = 0, updated = 0, skipped = 0;
  for (const raw of items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { skipped++; continue; }
    const word = String(raw.word || "").trim();
    const definition = String(raw.definition || "").trim();
    if (!word || !definition) { skipped++; continue; }
    const key = word.toLocaleLowerCase();
    const previous = byWord.get(key);
    if (previous && mode === "merge") { skipped++; continue; }
    const importedId = String(raw.id || "");
    const item = {
      id: previous?.id || (/^[A-Za-z0-9_.:-]{1,80}$/.test(importedId)
        ? importedId
        : `word_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      word, definition,
      partOfSpeech: String(raw.partOfSpeech || "").trim(),
      exampleSentence: String(raw.exampleSentence || "").trim(),
      category: String(raw.category || "General").trim() || "General",
      difficulty: ["easy", "medium", "hard"].includes(String(raw.difficulty || "").toLowerCase()) ? String(raw.difficulty).toLowerCase() : "medium",
      favorite: raw.favorite === true || String(raw.favorite).toLowerCase() === "true",
      status: ["new", "learning", "reviewing", "mastered"].includes(String(raw.status || "").toLowerCase()) ? String(raw.status).toLowerCase() : "new",
      repetitions: Math.max(0, Number.parseInt(raw.repetitions, 10) || 0),
      interval: Math.max(0, Number.parseInt(raw.interval, 10) || 0),
      easeFactor: Math.max(1, Number.parseFloat(raw.easeFactor) || 2.5),
      lastReview: raw.lastReview || null,
      nextReview: raw.nextReview || null,
      createdAt: raw.createdAt || new Date().toISOString()
    };
    byWord.set(key, item);
    if (previous) updated++; else added++;
  }
  return { words: [...byWord.values()], added, updated, skipped, total: byWord.size };
}

function backupCollection(existing, incoming, mode, keyOf) {
  const map = new Map();
  if (mode !== "replace") {
    for (const item of existing) map.set(keyOf(item), item);
  }
  for (const item of incoming) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const key = keyOf(item);
    if (!key) continue;
    if (mode !== "merge" || !map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

function backupHistoryKey(item, fallback) {
  return String(item?.sessionId || `${item?.wordId || item?.sentenceId || ""}:${item?.reviewedAt || item?.date || fallback}`);
}

async function persistImportedBackup(previous) {
  if (!VocabFlowRemote.enabled) return;
  try {
    const state = getLocalState();
    const { reviews: _reviews, sentenceReviews: _sentenceReviews, ...serverSafeState } = state;
    await VocabFlowRemote.queuePut("/api/bootstrap", serverSafeState, { strict: true });
    const synced = await VocabFlowRemote.request("/api/bootstrap");
    if (synced?.state) applyLocalSnapshot(synced.state);
  } catch (error) {
    applyLocalSnapshot(previous);
    throw error;
  }
}

async function importJSONText(text, mode) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    const previous = getLocalState();
    const result = prepareVocabularyImport(parsed, mode);
    const state = { ...previous, words: result.words };
    if (mode === "replace") {
      const validIds = new Set(result.words.map(word => String(word.id)));
      state.reviews = state.reviews.filter(review => validIds.has(String(review.wordId)));
    }
    applyLocalSnapshot(state);
    await persistImportedBackup(previous);
    return result;
  }
  if (!parsed || typeof parsed !== "object") throw new Error(trIO("io_invalidJson", "Invalid JSON backup."));
  const collectionKeys = ["words", "sentences", "reviews", "sentenceReviews", "quizHistory", "sentenceQuizHistory", "practiceHistory"];
  if (!collectionKeys.some(key => Array.isArray(parsed[key])) && !parsed.settings) {
    throw new Error(trIO("io_invalidJson", "Invalid JSON backup: no data collections found."));
  }

  const previous = getLocalState();
  const next = { ...previous };
  const sentenceIdMap = new Map();
  let result = { added: 0, updated: 0, skipped: 0, total: previous.words.length };
  if (Array.isArray(parsed.words)) {
    result = prepareVocabularyImport(parsed.words, mode, previous.words);
    next.words = result.words;
  }
  if (Array.isArray(parsed.sentences)) {
    const incoming = parsed.sentences
      .filter(sentence => sentence && typeof sentence === "object" && !Array.isArray(sentence))
      .map(sentence => typeof createSentence === "function" ? createSentence(sentence) : sentence);
    const sentenceKey = sentence => String(sentence.sentence || "").trim().toLocaleLowerCase().replace(/[.!?,;:]+$/g, "");
    const bySentence = new Map(mode === "replace" ? [] : previous.sentences.map(sentence => [sentenceKey(sentence), sentence]));
    for (const sentence of incoming) {
      const key = sentenceKey(sentence);
      if (!key || !sentence.arabicMeaning) continue;
      const old = bySentence.get(key);
      const id = old?.id || sentence.id;
      sentenceIdMap.set(String(sentence.id), String(id));
      if (!old || mode !== "merge") bySentence.set(key, { ...sentence, id });
    }
    next.sentences = [...bySentence.values()];
  }
  const historySpecs = [
    ["quizHistory", item => backupHistoryKey(item, "quiz")],
    ["sentenceQuizHistory", item => backupHistoryKey(item, "sentence-quiz")],
    ["practiceHistory", item => backupHistoryKey(item, "practice")]
  ];
  for (const [key, keyOf] of historySpecs) {
    if (Array.isArray(parsed[key])) {
      const incoming = key === "sentenceReviews"
        ? parsed[key].map(item => sentenceIdMap.has(String(item?.sentenceId))
          ? { ...item, sentenceId: sentenceIdMap.get(String(item.sentenceId)) }
          : item)
        : parsed[key];
      next[key] = backupCollection(previous[key], incoming, mode, keyOf);
    }
  }
  if (parsed.settings && typeof parsed.settings === "object" && mode !== "merge") {
    next.settings = { ...previous.settings, ...parsed.settings };
  }

  applyLocalSnapshot(next);
  await persistImportedBackup(previous);
  return result;
}

async function importCSVText(text, mode) {
  const previous = getLocalState();
  const result = prepareVocabularyImport(parseVocabularyCSV(text), mode);
  const state = { ...previous, words: result.words };
  if (mode === "replace") {
    const validIds = new Set(result.words.map(word => String(word.id)));
    state.reviews = state.reviews.filter(review => validIds.has(String(review.wordId)));
  }
  applyLocalSnapshot(state);
  await persistImportedBackup(previous);
  return result;
}

async function readSelectedFile(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    setIOMessage(trIO("io_fileTooLarge","File is too large. Please use a file under 10 MB."), "error");
    return;
  }

  try {
    const text = await file.text();
    const lower = file.name.toLowerCase();
    let result;

    if (lower.endsWith(".json")) {
      result = await importJSONText(text, selectedMode());
    } else if (lower.endsWith(".csv")) {
      result = await importCSVText(text, selectedMode());
    } else {
      throw new Error(trIO("io_unsupportedType","Unsupported file type. Please choose a CSV or JSON file."));
    }

    setIOMessage(
      `${trIO("io_importComplete","Import complete:")} ${result.added} ${trIO("io_added","added")}, ${result.updated} ${trIO("io_updated","updated")}, ${result.skipped} ${trIO("io_skipped","skipped")}. ${trIO("io_libraryNowHas","Library now has")} ${result.total} ${trIO("wl_words","words")}.`,
      "success"
    );
    document.getElementById("fileInput").value = "";
  } catch (error) {
    console.error(error);
    setIOMessage(error.message || trIO("io_importFailed","Import failed. Please check your file."), "error");
  }
}

document.addEventListener("vocabflow:pageinit", () => {
  const root = document.querySelector("main.main-content");
  if (window.VocabFlowEvents && !VocabFlowEvents.pageSetup("import-export", root, () => {})) return;
  document.getElementById("exportCSV")?.addEventListener("click", exportWordsAsCSV);
  document.getElementById("exportJSON")?.addEventListener("click", exportWordsAsJSON);

  const fileInput=document.getElementById("fileInput");
  const fileName=document.getElementById("fileName");
  fileInput?.addEventListener("change", e => {
    const file=e.target.files?.[0];
    if(fileName) fileName.textContent=file?.name || trIO("dt_noFileSelected","No file selected");
  });
  fileInput?.closest("form")?.addEventListener("submit",e=>e.preventDefault());

  const importButton=document.getElementById("importWordsButton");
  importButton?.addEventListener("click",()=>readSelectedFile(fileInput?.files?.[0]));

  document.getElementById("clearData")?.addEventListener("click", () => {
    const count = getWords().length;
    if (!count) {
      setIOMessage(trIO("io_libraryAlreadyEmpty","Your vocabulary library is already empty."), "error");
      return;
    }
    if (confirm(`${trIO("io_confirmDeleteAll","Delete all")} ${count} ${trIO("io_confirmDeleteAllAfter","vocabulary words? This cannot be undone.")}`)) {
      saveWords([]);
      setIOMessage(trIO("io_libraryCleared","Vocabulary library cleared. Your backup files are not affected."), "success");
    }
  });
});
