function updateSentenceLinkPreview(){
  const text=document.getElementById("sentence")?.value || "";
  const preview=document.getElementById("sentenceLinkPreview");
  if(preview) preview.hidden=!text.trim();
  if(typeof renderLinkedWords !== "function" || !preview || preview.hidden) return;
  renderLinkedWords({ sentence:text });
}

function setupAddSentence(){
  const form = document.getElementById("addSentenceForm");
  if(!form) return;

  form.addEventListener("submit", e=>{
    e.preventDefault();
    const data = {
      sentence: document.getElementById("sentence")?.value || "",
      arabicMeaning: document.getElementById("arabicMeaning")?.value || "",
      category: document.getElementById("category")?.value || "General",
      difficulty: document.getElementById("difficulty")?.value || "medium"
    };
    const errors = validateSentenceInput(data);
    const err = document.getElementById("sentenceError");
    const ok = document.getElementById("sentenceSuccess");

    if(errors.length){
      if(err) err.textContent = errors.join(" ");
      if(ok) ok.textContent = "";
      return;
    }

    addSentence(createSentence(data));
    if(err) err.textContent = "";
    if(ok) ok.textContent = typeof t==="function" ? t("as_addedSuccess") : "Sentence added successfully.";
    form.reset();
    if(document.getElementById("category")) document.getElementById("category").value = "General";
    if(document.getElementById("difficulty")) document.getElementById("difficulty").value = "medium";
    window.VocabFlowSelects?.refresh();
    updateSentenceLinkPreview();
  });

  document.getElementById("sentence")?.addEventListener("input", updateSentenceLinkPreview);
  updateSentenceLinkPreview();
}

if(typeof document !== "undefined") document.addEventListener("vocabflow:pageinit", ()=>{const root=document.querySelector("main.main-content");if(window.VocabFlowEvents)VocabFlowEvents.pageSetup("add-sentence",root,setupAddSentence);else setupAddSentence();});
