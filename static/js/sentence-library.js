const SENTENCES_PAGE_SIZE = 50;
let visibleSentenceLimit = SENTENCES_PAGE_SIZE;
let sentenceSearchTimer = null;

function escapeSentenceHTML(v){
  return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}
function trS(key,fallback){return typeof t==="function"?t(key):fallback}
function statusLabelS(status){return trS("status_"+status, status)}

function populateSentenceCategoryFilter(){
  const sel = document.getElementById("sentenceCategory");
  if(!sel) return;
  const current = sel.value || "all";
  const categories = [...new Set(getSentences().map(s=>s.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  sel.innerHTML = `<option value="all">${trS("wl_allCategories","All categories")}</option>` +
    categories.map(c=>`<option value="${escapeSentenceHTML(c)}">${escapeSentenceHTML(c)}</option>`).join("");
  if(categories.includes(current)) sel.value = current;
 if(window.VocabFlowSelects?.refresh)window.VocabFlowSelects.refresh();
}

function filteredSortedSentences(){
  const q = String(document.getElementById("sentenceSearch")?.value || "").trim().toLowerCase();
  const category = document.getElementById("sentenceCategory")?.value || "all";
  const difficulty = document.getElementById("sentenceDifficulty")?.value || "all";
  const status = document.getElementById("sentenceStatus")?.value || "all";
  const sort = document.getElementById("sentenceSort")?.value || "alphabetical";

  let list = getSentences().filter(s=>{
    if(q && !String(s.sentence).toLowerCase().includes(q) && !String(s.arabicMeaning).toLowerCase().includes(q)) return false;
    if(category !== "all" && s.category !== category) return false;
    if(difficulty !== "all" && s.difficulty !== difficulty) return false;
    if(status !== "all" && s.status !== status) return false;
    return true;
  });

  list = list.slice();
  if(sort === "alphabetical") list.sort((a,b)=>a.sentence.localeCompare(b.sentence));
  else if(sort === "date") list.sort((a,b)=>new Date(b.createdAt) - new Date(a.createdAt));
  else if(sort === "review") list.sort((a,b)=>{
    if(!a.nextReview && !b.nextReview) return 0;
    if(!a.nextReview) return 1;
    if(!b.nextReview) return -1;
    return new Date(a.nextReview) - new Date(b.nextReview);
  });
  return list;
}

function sentenceRowHTML(s, linkedMap){
  const linkedCount = linkedMap && typeof sentenceTokens === "function"
    ? new Set(sentenceTokens(s.sentence).filter(token => linkedMap.has(token))).size
    : (typeof getLinkedWordsForSentence === "function" ? getLinkedWordsForSentence(s).length : 0);
  const reviewDate = s.nextReview ? new Date(s.nextReview) : null;
  const nextReview = reviewDate && !Number.isNaN(reviewDate.getTime())
    ? reviewDate.toLocaleDateString(document.documentElement.lang === "ar" ? "ar-IQ" : "en-US")
    : trS("sl_notScheduled", "Not scheduled");
  const linkedLabel = linkedCount ? `${linkedCount} ${trS(linkedCount===1?"sl_linkedWord":"sl_linkedWords","linked word")}` : "";
  return `
    <article class="sentence-row" data-id="${escapeSentenceHTML(s.id)}">
      <div class="sentence-main">
        <strong>${escapeSentenceHTML(s.sentence)}</strong>
        <small>${escapeSentenceHTML(s.category)} · ${escapeSentenceHTML(trS("diff_"+s.difficulty, s.difficulty))}${linkedCount ? ` · ${linkedLabel}` : ""}</small>
      </div>
      <div class="sentence-meaning">${escapeSentenceHTML(s.arabicMeaning)}</div>
      <div class="sentence-meta"><span class="status-badge ${escapeSentenceHTML(s.status)}">${escapeSentenceHTML(statusLabelS(s.status))}</span></div>
      <div class="sentence-meta">${trS("sl_nextReview","Next review")}<br>${nextReview}</div>
      <div class="sentence-actions">
        <button class="icon-button" data-action="favorite" data-id="${escapeSentenceHTML(s.id)}" title="${trS('wl_favorite','Favorite')}">${s.favorite ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" fill="currentColor" stroke="none"/></svg>' : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg>'}</button>
        <button class="icon-button" data-action="edit" data-id="${escapeSentenceHTML(s.id)}" title="${trS('common_edit','Edit')}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 20 4.5-1L19 8.5 15.5 5 5 15.5Z"/><path d="m14 6.5 3.5 3.5"/></svg></button>
        <button class="icon-button" data-action="delete" data-id="${escapeSentenceHTML(s.id)}" title="${trS('common_delete','Delete')}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5"/></svg></button>
      </div>
    </article>`;
}

function renderSentenceLibrary(){
  const list = document.getElementById("sentenceList");
  if(!list) return;
  populateSentenceCategoryFilter();
  const items = filteredSortedSentences();
  const visibleItems = items.slice(0, visibleSentenceLimit);

  const countEl = document.getElementById("sentenceCount");
  if(countEl) countEl.textContent = `${items.length} ${trS(items.length===1?"sl_sentence":"sl_sentences","sentences")}`;

  const linkedMap = typeof getWordSentenceLinks === "function" ? getWordSentenceLinks().map : null;
  const rows = visibleItems.map(item => sentenceRowHTML(item, linkedMap)).join("");
  const more = items.length > visibleItems.length
    ? `<div class="library-load-more-wrap"><button type="button" class="secondary-button" data-action="load-more">${trS("sl_loadMore","Load more")} (${visibleItems.length} / ${items.length})</button></div>`
    : "";
  list.innerHTML = items.length
    ? rows + more
    : `<div class="sentence-empty"><h3>${trS("sl_noSentencesFound","No sentences found")}</h3><p>${trS("sl_addFirstSentence","Add your first sentence, or adjust your search and filters.")}</p></div>`;
}
function renderSentences(){ renderSentenceLibrary(); }

function openSentenceEditModal(id){
  const s = getSentences().find(x => x.id === id);
  if(!s) return;
  document.getElementById("editSentenceId").value = s.id;
  document.getElementById("editSentenceText").value = s.sentence;
  document.getElementById("editSentenceMeaning").value = s.arabicMeaning;
  document.getElementById("editSentenceCategory").value = s.category || "General";
  document.getElementById("editSentenceDifficulty").value = s.difficulty || "medium";
  document.getElementById("editSentenceError").textContent = "";
  document.getElementById("sentenceEditModal").classList.add("open");
}
function closeSentenceEditModal(){
  document.getElementById("sentenceEditModal")?.classList.remove("open");
}

function setupSentenceLibrary(){
  visibleSentenceLimit=SENTENCES_PAGE_SIZE;
  ["sentenceSearch","sentenceCategory","sentenceDifficulty","sentenceStatus","sentenceSort"].forEach(id=>{
    const el = document.getElementById(id);
    if(id === "sentenceSearch")el?.addEventListener("input",()=>{window.clearTimeout(sentenceSearchTimer);sentenceSearchTimer=window.setTimeout(()=>{visibleSentenceLimit=SENTENCES_PAGE_SIZE;renderSentenceLibrary()},140)});
    else el?.addEventListener("change",()=>{visibleSentenceLimit=SENTENCES_PAGE_SIZE;renderSentenceLibrary()});
  });

  document.getElementById("sentenceList")?.addEventListener("click", e=>{
    const btn = e.target.closest("[data-action]");
    if(!btn) return;
    if(btn.dataset.action === "load-more") { visibleSentenceLimit += SENTENCES_PAGE_SIZE; renderSentenceLibrary(); return; }
    const id = btn.dataset.id;
    if(btn.dataset.action === "favorite"){
      const s = getSentences().find(x=>x.id===id);
      if(s) updateSentence(id, {favorite: !s.favorite});
      renderSentenceLibrary();
    } else if(btn.dataset.action === "delete"){
      if(confirm(trS("sl_confirmDelete","Delete this sentence?"))){ deleteSentence(id); renderSentenceLibrary(); }
    } else if(btn.dataset.action === "edit"){
      openSentenceEditModal(id);
    }
  });

  document.getElementById("sentenceEditForm")?.addEventListener("submit", e=>{
    e.preventDefault();
    const id = document.getElementById("editSentenceId").value;
    const data = {
      sentence: document.getElementById("editSentenceText").value,
      arabicMeaning: document.getElementById("editSentenceMeaning").value,
      category: document.getElementById("editSentenceCategory").value,
      difficulty: document.getElementById("editSentenceDifficulty").value
    };
    const errors = validateSentenceInput(data, id);
    const errEl = document.getElementById("editSentenceError");
    if(errors.length){ if(errEl) errEl.textContent = errors.join(" "); return; }
    updateSentence(id, {
      sentence: normalizeSentenceText(data.sentence),
      arabicMeaning: data.arabicMeaning.trim(),
      category: data.category.trim() || "General",
      difficulty: data.difficulty
    });
    closeSentenceEditModal();
    renderSentenceLibrary();
  });

  document.getElementById("sentenceEditCancel")?.addEventListener("click", closeSentenceEditModal);
  document.getElementById("sentenceEditModal")?.addEventListener("click", e=>{
    if(e.target.id === "sentenceEditModal") closeSentenceEditModal();
  });

  if(window.VocabFlowEvents) VocabFlowEvents.once("sentence-library", "vocabflow:langchange", renderSentenceLibrary);
  renderSentenceLibrary();
}

if(typeof document !== "undefined") document.addEventListener("vocabflow:pageinit", ()=>{const root=document.querySelector("main.main-content");if(window.VocabFlowEvents)VocabFlowEvents.pageSetup("sentence-library",root,setupSentenceLibrary);else setupSentenceLibrary();});
