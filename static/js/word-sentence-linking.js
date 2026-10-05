
function normalizeLinkToken(value){
  return String(value || "")
    .toLowerCase()
    .replace(/[“”"'’]/g, "")
    .replace(/[^a-z0-9-]/g, "")
    .trim();
}

function sentenceTokens(sentence){
  return String(sentence || "")
    .toLowerCase()
    .split(/\s+/)
    .map(token => normalizeLinkToken(token))
    .filter(Boolean);
}

function getWordSentenceLinks(){
  const words = typeof getWords === "function" ? getWords() : [];
  const sentences = typeof getSentences === "function" ? getSentences() : [];
  const map = new Map();
  const wordMap = new Map();

  words.forEach(word => {
    const key = normalizeLinkToken(word.word);
    if (key) {
      map.set(key, []);
      wordMap.set(key, word);
    }
  });

  sentences.forEach(sentence => {
    sentenceTokens(sentence.sentence).forEach(token => {
      if (map.has(token)) map.get(token).push(sentence);
    });
  });

  return {words, sentences, map, wordMap};
}

function getSentencesForWord(wordValue){
  const key = normalizeLinkToken(wordValue);
  return getWordSentenceLinks().map.get(key) || [];
}

function getLinkedWordsForSentence(sentence){
  const links = getWordSentenceLinks();
  const seen = new Set();
  const output = [];

  sentenceTokens(sentence?.sentence).forEach(token => {
    if (seen.has(token)) return;
    const word = links.wordMap.get(token);
    if (word) {
      output.push(word);
      seen.add(token);
    }
  });

  return output;
}

function sentenceContainsWord(sentence, word){
  const key = normalizeLinkToken(word?.word ?? word);
  return sentenceTokens(sentence?.sentence).includes(key);
}

function highlightLinkedWord(sentenceText, wordValue){
  const target = normalizeLinkToken(wordValue);
  if (!target) return escapeLinkHTML(sentenceText);

  const parts = String(sentenceText || "").split(/(\s+)/);
  return parts.map(part => {
    const stripped = normalizeLinkToken(part);
    return stripped === target
      ? `<mark class="linked-word">${escapeLinkHTML(part)}</mark>`
      : escapeLinkHTML(part);
  }).join("");
}

function escapeLinkHTML(value){
  return String(value ?? "").replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function trL(key,fallback){return typeof t==="function"?t(key):fallback}

function renderLinkedSentences(word){
  const container = document.getElementById("linkedSentences");
  const count = document.getElementById("linkedSentenceCount");
  if (!container) return;

  const linked = getSentencesForWord(word?.word || word);

  if (count) {
    count.textContent = `${linked.length} ${trL(linked.length===1?"sl_sentence":"sl_sentences","sentences")}`;
  }

  if (!linked.length){
    container.innerHTML = `
      <div class="link-empty">
        <h3>${trL("wl_noLinkedSentences","No linked sentences yet")}</h3>
        <p>${trL("wl_addSentenceUsing","Add a sentence that uses")} <strong>${escapeLinkHTML(word?.word || word || "")}</strong> ${trL("wl_addSentenceUsingAfter","and it will appear here automatically.")}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = linked.map(sentence => `
    <article class="linked-sentence-card">
      <div class="linked-sentence-main">
        <div class="linked-sentence-text">${highlightLinkedWord(sentence.sentence, word?.word || word)}</div>
        <div class="linked-sentence-meaning">${escapeLinkHTML(sentence.arabicMeaning)}</div>
      </div>
      <div class="linked-sentence-meta">
        <span>${escapeLinkHTML(sentence.category)}</span>
        <span>${escapeLinkHTML(trL("diff_"+sentence.difficulty, sentence.difficulty))}</span>
        <span>${escapeLinkHTML(trL("status_"+sentence.status, sentence.status))}</span>
      </div>
      <div class="linked-sentence-actions">
        <a class="secondary-button" href="/sentence-review">${trL("ln_review","Review")}</a>
        <a class="secondary-button" href="/sentence-quiz">${trL("ln_quiz","Quiz")}</a>
        <a class="secondary-button" href="/sentence-writing">${trL("ln_write","Write")}</a>
      </div>
    </article>
  `).join("");
}

function renderLinkedWords(sentence){
  const container = document.getElementById("linkedWords");
  const count = document.getElementById("linkedWordCount");
  if (!container) return;

  const linked = getLinkedWordsForSentence(sentence);
  if (count){
    count.textContent = `${linked.length} ${trL(linked.length===1?"sl_linkedWord":"sl_linkedWords","linked words")}`;
  }

  if (!linked.length){
    container.innerHTML = `
      <div class="link-empty">
        <h3>${trL("wl_noVocabLinks","No vocabulary links yet")}</h3>
        <p>${trL("wl_autoConnectText","The sentence will automatically connect to English words already in your Word Library.")}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = linked.map(word => `
    <div class="linked-word-chip">
      <strong>${escapeLinkHTML(word.word)}</strong>
      <span>${escapeLinkHTML(word.definition)}</span>
    </div>
  `).join("");
}

function setupWordSentenceLinking(){
  const word = window.VocabFlowSelectedWord;
  if (word) renderLinkedSentences(word);

  const sentence = window.VocabFlowSelectedSentence;
  if (sentence) renderLinkedWords(sentence);
}
if(typeof window!=="undefined")window.addEventListener("vocabflow:langchange",()=>{
  if(window.VocabFlowSelectedWord) renderLinkedSentences(window.VocabFlowSelectedWord);
  if(window.VocabFlowSelectedSentence) renderLinkedWords(window.VocabFlowSelectedSentence);
});
