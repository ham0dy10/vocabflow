
const WORDS_PAGE_SIZE = 50;
let visibleWordLimit = WORDS_PAGE_SIZE;
let wordSearchTimer = null;

function createWord(data){return{
 id:vocabFlowUuid("word"),
 word:String(data.word||"").trim(),
 definition:String(data.definition||"").trim(),
 partOfSpeech:String(data.partOfSpeech||"").trim(),
 exampleSentence:String(data.exampleSentence||"").trim(),
 category:String(data.category||"General").trim()||"General",
 difficulty:["easy","medium","hard"].includes(String(data.difficulty||"").toLowerCase())?String(data.difficulty).toLowerCase():"medium",
 favorite:false,status:"new",repetitions:0,interval:0,easeFactor:2.5,lastReview:null,nextReview:null,createdAt:new Date().toISOString()
}}
function duplicateWordExists(word,excludeId=null){const q=String(word||"").trim().toLowerCase();return getWords().some(w=>String(w.word||"").trim().toLowerCase()===q&&w.id!==excludeId)}
function validateWordInput(data,excludeId=null){const trv=(k,f)=>typeof t==="function"?t(k):f;const e=[];if(!String(data.word||"").trim())e.push(trv("wl_wordRequired","Word is required."));if(!String(data.definition||"").trim())e.push(trv("wl_definitionRequired","Arabic meaning is required."));if(duplicateWordExists(data.word,excludeId))e.push(trv("wl_wordExists","This word already exists."));return e}
function escapeHTML(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function trWD(key,fallback){return typeof t==="function"?t(key):fallback}
function statusLabelW(status){return trWD("status_"+status, status)}

function populateWordCategoryFilter(){
 const sel=document.getElementById("categoryFilter");if(!sel)return;
 const current=sel.value||"all";
 const categories=[...new Set(getWords().map(w=>w.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 sel.innerHTML=`<option value="all">${trWD("wl_allCategories","All categories")}</option>`+categories.map(c=>`<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
 if(categories.includes(current))sel.value=current;
 if(window.VocabFlowSelects?.refresh)window.VocabFlowSelects.refresh();
}

function filteredSortedWords(){
 const q=String(document.getElementById("searchInput")?.value||"").trim().toLowerCase();
 const category=document.getElementById("categoryFilter")?.value||"all";
 const difficulty=document.getElementById("difficultyFilter")?.value||"all";
 const status=document.getElementById("statusFilter")?.value||"all";
 const sort=document.getElementById("sortSelect")?.value||"alphabetical";

 let words=getWords().filter(w=>{
  if(q && !String(w.word).toLowerCase().includes(q) && !String(w.definition).toLowerCase().includes(q))return false;
  if(category!=="all" && w.category!==category)return false;
  if(difficulty!=="all" && w.difficulty!==difficulty)return false;
  if(status!=="all" && w.status!==status)return false;
  return true;
 });

 words=words.slice();
 if(sort==="alphabetical")words.sort((a,b)=>a.word.localeCompare(b.word));
 else if(sort==="date")words.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
 else if(sort==="review")words.sort((a,b)=>{
  if(!a.nextReview && !b.nextReview)return 0;
  if(!a.nextReview)return 1;
  if(!b.nextReview)return -1;
  return new Date(a.nextReview)-new Date(b.nextReview);
 });
 return words;
}

function renderWordLibrary(){
 const list=document.getElementById("wordList");if(!list)return;
 populateWordCategoryFilter();
 const words=filteredSortedWords();
 const visibleWords=words.slice(0,visibleWordLimit);
 const count=document.getElementById("libraryCount")||document.getElementById("wordCount");
 if(count)count.textContent=`${words.length} ${trWD(words.length===1?"wl_word":"wl_words","words")}`;
 const icon=name=>({
  star:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/></svg>',
  starFilled:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" fill="currentColor" stroke="none"/></svg>',
  link:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.1.1l1.4-1.4a5 5 0 0 0-7.1-7.1L10 6"/><path d="M14 11a5 5 0 0 0-7.1-.1l-1.4 1.4a5 5 0 0 0 7.1 7.1L14 18"/></svg>',
  edit:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m4 20 4.5-1L19 8.5 15.5 5 5 15.5Z"/><path d="m14 6.5 3.5 3.5"/></svg>',
  delete:'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 7l1 13h6l1-13M10 11v5M14 11v5"/></svg>'
})[name];
 const rows=visibleWords.map(w=>`<article class="word-row"><div class="word-main"><strong>${escapeHTML(w.word)}</strong><small>${escapeHTML(w.partOfSpeech||"")}</small></div><div class="word-definition">${escapeHTML(w.definition)}</div><div><span class="status-badge ${escapeHTML(w.status)}">${escapeHTML(statusLabelW(w.status))}</span></div><div class="row-actions"><button class="icon-button" data-action="favorite" data-id="${escapeHTML(w.id)}" title="${trWD('wl_favorite','Favorite')}">${w.favorite?icon('starFilled'):icon('star')}</button><button class="icon-button" data-action="context" data-id="${escapeHTML(w.id)}" title="${trWD('wl_sentencesUsingWord','Sentences using this word')}">${icon('link')}</button><button class="icon-button" data-action="edit" data-id="${escapeHTML(w.id)}" title="${trWD('common_edit','Edit')}">${icon('edit')}</button><button class="icon-button" data-action="delete" data-id="${escapeHTML(w.id)}" title="${trWD('common_delete','Delete')}">${icon('delete')}</button></div></article>`).join("");
 const more=words.length>visibleWords.length?`<div class="library-load-more-wrap"><button type="button" class="secondary-button" data-action="load-more">${trWD("wl_loadMore","Load more")} (${visibleWords.length} / ${words.length})</button></div>`:"";
 list.innerHTML=words.length?rows+more:`<div class="empty-state"><h3>${trWD("wl_noWordsFound","No words found")}</h3><p>${trWD("wl_addFirstWord","Add your first word to start learning.")}</p></div>`;
}

function toggleWordContext(word){
 const panel=document.getElementById("wordLinkedSentencePanel");
 if(!panel)return;
 window.VocabFlowSelectedWord=word;
 if(typeof renderLinkedSentences==="function")renderLinkedSentences(word);
 panel.hidden=false;
 const link=document.getElementById("wordContextFullLink");
 if(link)link.href=`/word-context?word=${encodeURIComponent(word.word)}`;
 panel.scrollIntoView({behavior:"smooth",block:"start"});
}

function openEditModal(id){
 const w=getWords().find(x=>x.id===id);if(!w)return;
 document.getElementById("editId").value=w.id;
 document.getElementById("editWord").value=w.word;
 document.getElementById("editDefinition").value=w.definition;
 document.getElementById("editPartOfSpeech").value=w.partOfSpeech||"";
 document.getElementById("editCategory").value=w.category||"General";
 document.getElementById("editDifficulty").value=w.difficulty||"medium";
 document.getElementById("editExample").value=w.exampleSentence||"";
 document.getElementById("editError").textContent="";
 document.getElementById("editModal").classList.add("open");
}
function closeEditModal(){
 document.getElementById("editModal")?.classList.remove("open");
}

function setupWordLibrary(){
 visibleWordLimit=WORDS_PAGE_SIZE;
 ["searchInput","categoryFilter","difficultyFilter","statusFilter","sortSelect"].forEach(id=>{
  const el=document.getElementById(id);
  if(id==="searchInput")el?.addEventListener("input",()=>{window.clearTimeout(wordSearchTimer);wordSearchTimer=window.setTimeout(()=>{visibleWordLimit=WORDS_PAGE_SIZE;renderWordLibrary()},140)});
  else el?.addEventListener("change",()=>{visibleWordLimit=WORDS_PAGE_SIZE;renderWordLibrary()});
 });

 document.getElementById("wordList")?.addEventListener("click",e=>{
  const b=e.target.closest("[data-action]");if(!b)return;
  if(b.dataset.action==="load-more"){visibleWordLimit+=WORDS_PAGE_SIZE;renderWordLibrary();return;}
  const id=b.dataset.id;
  if(b.dataset.action==="favorite"){
   const w=getWords().find(x=>x.id===id);if(w)updateWord(id,{favorite:!w.favorite});
   renderWordLibrary();
  }else if(b.dataset.action==="delete"){
   if(confirm(trWD("wl_confirmDelete","Delete this word?"))){deleteWord(id);renderWordLibrary();}
  }else if(b.dataset.action==="edit"){
   openEditModal(id);
  }else if(b.dataset.action==="context"){
   const w=getWords().find(x=>x.id===id);if(w)toggleWordContext(w);
  }
 });

 document.getElementById("editWordForm")?.addEventListener("submit",e=>{
  e.preventDefault();
  const id=document.getElementById("editId").value;
  const data={
   word:document.getElementById("editWord").value,
   definition:document.getElementById("editDefinition").value,
   partOfSpeech:document.getElementById("editPartOfSpeech").value,
   category:document.getElementById("editCategory").value,
   difficulty:document.getElementById("editDifficulty").value,
   exampleSentence:document.getElementById("editExample").value
  };
  const errors=validateWordInput(data,id);
  const err=document.getElementById("editError");
  if(errors.length){if(err)err.textContent=errors.join(" ");return;}
  updateWord(id,{
   word:data.word.trim(),
   definition:data.definition.trim(),
   partOfSpeech:data.partOfSpeech.trim(),
   category:data.category.trim()||"General",
   difficulty:data.difficulty,
   exampleSentence:data.exampleSentence.trim()
  });
  closeEditModal();
  renderWordLibrary();
 });

 if(window.VocabFlowEvents) VocabFlowEvents.once("words-library", "vocabflow:langchange", renderWordLibrary);
 renderWordLibrary();
}

function setupAddWord(){
 const form=document.getElementById("addWordForm");if(!form)return;
 form.addEventListener("submit",e=>{
  e.preventDefault();
  const data={word:document.getElementById("word")?.value||"",definition:document.getElementById("definition")?.value||"",partOfSpeech:document.getElementById("partOfSpeech")?.value||"",exampleSentence:document.getElementById("exampleSentence")?.value||"",category:document.getElementById("category")?.value||"General",difficulty:document.getElementById("difficulty")?.value||"medium"};
  const errors=validateWordInput(data),err=document.getElementById("formError"),ok=document.getElementById("successMessage");
  if(errors.length){if(err)err.textContent=errors.join(" ");if(ok)ok.textContent="";return}
  addWord(createWord(data));if(err)err.textContent="";if(ok)ok.textContent=trWD("aw_wordAddedSuccess","Word added successfully.");form.reset();
  if(document.getElementById("category"))document.getElementById("category").value="General";
  if(document.getElementById("difficulty"))document.getElementById("difficulty").value="medium";
  window.VocabFlowSelects?.refresh();
 })
}
if(typeof document!=="undefined")document.addEventListener("vocabflow:pageinit",()=>{const root=document.querySelector("main.main-content");if(window.VocabFlowEvents){VocabFlowEvents.pageSetup("words-page",root,()=>{setupWordLibrary();setupAddWord()});}else{setupWordLibrary();setupAddWord();}})
