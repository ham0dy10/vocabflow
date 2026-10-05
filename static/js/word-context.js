function initWordContextPage(){
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get("id");
  const wordParam = params.get("word");
  const words = typeof getWords === "function" ? getWords() : [];
  const trC = (key,fallback) => typeof t === "function" ? t(key) : fallback;

  let word = null;
  if(idParam) word = words.find(w => w.id === idParam) || null;
  if(!word && wordParam) word = words.find(w => w.word.toLowerCase() === wordParam.toLowerCase()) || null;

  const titleEl = document.getElementById("contextWord");
  const meaningEl = document.getElementById("contextMeaning");

  if(!word){
    if(titleEl) titleEl.textContent = wordParam ? `"${wordParam}" ${trC("wc_notFound","not found")}` : trC("wc_selectWord","Select a word");
    if(meaningEl) meaningEl.textContent = trC("wc_openFromButton","Open this page from the context action on a word in your Word Library.");
    if(typeof renderLinkedSentences === "function") renderLinkedSentences({ word: wordParam || "" });
    return;
  }

  window.VocabFlowSelectedWord = word;
  if(titleEl) titleEl.textContent = word.word;
  if(meaningEl) meaningEl.textContent = word.partOfSpeech ? `${word.definition} · ${word.partOfSpeech}` : word.definition;
  if(typeof renderLinkedSentences === "function") renderLinkedSentences(word);
}

if(typeof document !== "undefined") document.addEventListener("vocabflow:pageinit", ()=>{const root=document.querySelector("main.main-content");if(window.VocabFlowEvents)VocabFlowEvents.pageSetup("word-context",root,initWordContextPage);else initWordContextPage();});
if(typeof window !== "undefined") window.addEventListener("vocabflow:langchange", initWordContextPage);
