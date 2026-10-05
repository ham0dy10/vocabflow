
const practiceState={
  tasks:[],index:0,score:0,answered:false,startedAt:null,
  stats:{total:0,correct:0,words:0,sentences:0},
  attemptId:null,secure:false
};

function practiceShuffle(a){return [...a].sort(()=>Math.random()-.5)}
function practiceEscape(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function practiceNorm(v){return String(v||"").trim().toLowerCase().replace(/[.,!?;:]+/g,"").replace(/\s+/g," ")}
function trP(key,fallback){return typeof t==="function"?t(key):fallback}

function buildPracticeTask(word,sentence,type){
  const meaningQ=trP("pr_secondaryMeaning","What is the Arabic meaning?");
  if(type==="word"){
    const choices=practiceShuffle([word.definition,...practiceShuffle(getWords().filter(w=>w.id!==word.id)).slice(0,3).map(w=>w.definition)]);
    return {kind:"word",prompt:word.word,secondary:meaningQ,answer:word.definition,options:choices,wordId:word.id}
  }
  if(type==="sentence"){
    return {kind:"sentence",prompt:sentence.sentence,secondary:meaningQ,answer:sentence.arabicMeaning,sentenceId:sentence.id}
  }
  if(type==="fill"){
    const words=sentence.sentence.split(/\s+/);
    if(words.length<3)return buildPracticeTask(word,sentence,"sentence");
    const idx=Math.floor(words.length/2),answer=words[idx].replace(/[.,!?;:]+$/,"");
    words[idx]=words[idx].replace(answer,"_____");
    return {kind:"fill",prompt:words.join(" "),secondary:trP("pr_completeMissingWord","Complete the missing word."),answer,id:sentence.id,sentenceId:sentence.id}
  }
  if(type==="writing"){
    return {kind:"writing",prompt:sentence.arabicMeaning,secondary:trP("pr_writeFromMemory","Write the English sentence from memory."),answer:sentence.sentence,sentenceId:sentence.id}
  }
  return {kind:"word",prompt:word.word,secondary:meaningQ,answer:word.definition,wordId:word.id}
}

function buildPracticeSession(){
  const words=getWords(),sentences=getSentences();
  const wordCount=Math.min(Number(document.getElementById("practiceWords")?.value||5),words.length);
  const sentenceCount=Math.min(Number(document.getElementById("practiceSentences")?.value||5),sentences.length);
  const selectedWords=practiceShuffle(words).slice(0,wordCount);
  const selectedSentences=practiceShuffle(sentences).slice(0,sentenceCount);
  const mode=document.getElementById("practiceMode")?.value||"balanced";
  const tasks=[];

  selectedWords.forEach(w=>{
    const related=getSentencesForWord(w.word);
    const s=related.length?related[Math.floor(Math.random()*related.length)]:selectedSentences[0];
    if(mode==="words")tasks.push(buildPracticeTask(w,s,"word"));
    else if(mode==="sentences")tasks.push(buildPracticeTask(w,s,"sentence"));
    else{
      tasks.push(buildPracticeTask(w,s,"word"));
      if(s)tasks.push(buildPracticeTask(w,s,"sentence"));
    }
  });

  if(mode!=="words" && mode!=="sentences"){
    selectedSentences.forEach(s=>{
      const related=getLinkedWordsForSentence(s);
      const word=related[0]||selectedWords[0];
      tasks.push(buildPracticeTask(word,s,Math.random()<0.5?"fill":"writing"));
    });
  }else if(mode==="sentences"){
    selectedSentences.forEach(s=>{
      const related=getLinkedWordsForSentence(s);
      const word=related[0]||selectedWords[0];
      tasks.push(buildPracticeTask(word,s,"fill"));
    });
  }

  return practiceShuffle(tasks).slice(0,Math.max(1,Number(document.getElementById("practiceTotal")?.value||15)));
}


function renderPracticeServerSummary(summary){
  const total=summary.total??practiceState.tasks.length;
  const correct=summary.correct??practiceState.stats.correct;
  const accuracy=total?Math.round(correct/total*100):0;
  document.getElementById("practiceCard").hidden=true;
  document.getElementById("practiceSummary").hidden=false;
  renderProgressFill(document.getElementById("practiceProgress"), 100);
  document.getElementById("practiceScore").textContent=`${accuracy}%`;
  document.getElementById("practiceTotalDone").textContent=total;
  document.getElementById("practiceCorrect").textContent=correct;
  document.getElementById("practiceWordsDone").textContent=summary.words??practiceState.stats.words;
  document.getElementById("practiceSentencesDone").textContent=summary.sentences??practiceState.stats.sentences;
}

async function startPractice(){
  const empty=document.getElementById("practiceEmpty"),card=document.getElementById("practiceCard"),summary=document.getElementById("practiceSummary");
  practiceState.secure=location.protocol.startsWith("http")&&Boolean(window.VocabFlowApi)&&Boolean(window.__VOCABFLOW_USER__?.id);
  practiceState.attemptId=null;practiceState.index=0;practiceState.score=0;practiceState.answered=false;practiceState.startedAt=Date.now();
  if(practiceState.secure){
    try{
      const result=await VocabFlowApi.request("/api/practice/start",{method:"POST",body:JSON.stringify({wordCount:Number(document.getElementById("practiceWords")?.value||5),sentenceCount:Number(document.getElementById("practiceSentences")?.value||5),total:Number(document.getElementById("practiceTotal")?.value||15),mode:document.getElementById("practiceMode")?.value||"balanced"})});
      practiceState.tasks=result.questions||[];practiceState.attemptId=result.attemptId;practiceState.stats={total:practiceState.tasks.length,correct:0,words:result.words||0,sentences:result.sentences||0};
    }catch(error){empty.hidden=false;card.hidden=true;summary.hidden=true;empty.querySelector("p")?.replaceChildren(document.createTextNode(error.message||"Could not start practice."));return;}
  }else{
    if(!getWords().length&&!getSentences().length){empty.hidden=false;card.hidden=true;summary.hidden=true;return;}
    practiceState.tasks=buildPracticeSession();practiceState.stats={total:practiceState.tasks.length,correct:0,words:0,sentences:0};practiceState.tasks.forEach(task=>task.kind==="word"?practiceState.stats.words++:practiceState.stats.sentences++);
  }
  empty.hidden=true;summary.hidden=true;card.hidden=false;renderPracticeTask();
}

function practiceModeLabel(kind){
  if(kind==="word")return trP("pr_wordReview","WORD REVIEW");
  if(kind==="sentence")return trP("pr_sentenceReview","SENTENCE REVIEW");
  if(kind==="fill")return trP("pr_fillBlank","FILL IN THE BLANK");
  return trP("pr_writingPractice","WRITING PRACTICE");
}

function renderPracticeTask(){
  const task=practiceState.tasks[practiceState.index],total=practiceState.tasks.length;
  document.getElementById("practiceCounter").textContent=`${practiceState.index+1} / ${total}`;
  renderProgressFill(document.getElementById("practiceProgress"), total ? (practiceState.index / total) * 100 : 0);
  document.getElementById("practiceModeLabel").textContent=practiceModeLabel(task.kind);
  document.getElementById("practicePrompt").textContent=task.prompt;
  document.getElementById("practiceSecondary").textContent=task.secondary;
  const area=document.getElementById("practiceArea");
  area.innerHTML="";
  document.getElementById("practiceFeedback").textContent="";
  document.getElementById("practiceFeedback").className="practice-feedback";
  setUiHidden(document.getElementById("practiceNext"), true);
  document.getElementById("practiceAnswer").hidden=true;
  practiceState.answered=false;

  if(task.kind==="word"){
    area.innerHTML=`<div class="practice-options">${task.options.map((o,i)=>`<button class="practice-option" data-option="${i}">${practiceEscape(o)}</button>`).join("")}</div>`;
  }else if(task.kind==="sentence"){
    area.innerHTML=`<button class="primary-button" id="practiceShowAnswer">${trP("common_showAnswer","Show Answer")}</button>`;
  }else{
    const placeholder=task.kind==="fill"?trP("pr_typeMissingWord","Type the missing word"):trP("pr_typeEnglishSentence","Type the English sentence");
    area.innerHTML=`<input class="practice-input" id="practiceInput" autocomplete="off" placeholder="${practiceEscape(placeholder)}"><div class="practice-actions"><button class="primary-button" id="practiceCheck">${trP("wr_checkAnswer","Check Answer")}</button></div>`;
  }

  document.getElementById("practiceAnswer").querySelector(".practice-answer-value").textContent=task.answer;
}

function finishPractice(correct){
  if(practiceState.answered)return;
  practiceState.answered=true;
  if(correct)practiceState.stats.correct++;
  const fb=document.getElementById("practiceFeedback");
  fb.textContent=correct?trP("qz_correctFeedback","Correct."):`${trP("qz_notQuite","Not quite. Correct answer:")} ${practiceState.tasks[practiceState.index].answer}`;
  fb.className=`practice-feedback ${correct?"good":"bad"}`;
  if(document.getElementById("practiceNext"))setUiHidden(document.getElementById("practiceNext"), false);
  document.querySelectorAll(".practice-option").forEach(b=>b.disabled=true);
}

async function checkPracticeInput(){
  if(practiceState.answered||practiceState.checking)return;
  if(practiceState.secure){
    practiceState.checking=true;
    try{
      const result=await VocabFlowApi.request("/api/practice/answer",{method:"POST",body:JSON.stringify({attemptId:practiceState.attemptId,questionIndex:practiceState.index,text:document.getElementById("practiceInput").value})});
      practiceState.answered=true;if(result.correct)practiceState.stats.correct++;
      const fb=document.getElementById("practiceFeedback");fb.textContent=result.correct?trP("qz_correctFeedback","Correct."):`${trP("qz_notQuite","Not quite. Correct answer:")} ${result.correctAnswer}`;fb.className=`practice-feedback ${result.correct?"good":"bad"}`;
      setUiHidden(document.getElementById("practiceNext"), false);document.querySelectorAll(".practice-option,#practiceCheck,#practiceInput,#practiceShowAnswer").forEach(b=>b.disabled=true);
      if(result.completed)renderPracticeServerSummary(result.summary);
    }catch(error){document.getElementById("practiceFeedback").textContent=error.message||"Could not submit the answer.";practiceState.answered=false;}
    finally{practiceState.checking=false;}
    return;
  }
  const task=practiceState.tasks[practiceState.index],value=document.getElementById("practiceInput").value;finishPractice(practiceNorm(value)===practiceNorm(task.answer));
}

async function handlePracticeOption(button){
  if(practiceState.answered)return;
  const task=practiceState.tasks[practiceState.index],selectedIndex=Number(button.dataset.option);document.querySelectorAll(".practice-option").forEach(b=>b.disabled=true);
  if(practiceState.secure){
    try{
      const result=await VocabFlowApi.request("/api/practice/answer",{method:"POST",body:JSON.stringify({attemptId:practiceState.attemptId,questionIndex:practiceState.index,selectedIndex})});
      practiceState.answered=true;if(result.correct)practiceState.stats.correct++;button.classList.add(result.correct?"correct":"wrong");
      const fb=document.getElementById("practiceFeedback");fb.textContent=result.correct?trP("qz_correctFeedback","Correct."):`${trP("qz_notQuite","Not quite. Correct answer:")} ${result.correctAnswer}`;fb.className=`practice-feedback ${result.correct?"good":"bad"}`;
      setUiHidden(document.getElementById("practiceNext"), false);if(result.completed)renderPracticeServerSummary(result.summary);
    }catch(error){document.getElementById("practiceFeedback").textContent=error.message||"Could not submit the answer.";practiceState.answered=false;document.querySelectorAll(".practice-option").forEach(b=>b.disabled=false);}
    return;
  }
  const chosen=task.options[selectedIndex];document.querySelectorAll(".practice-option").forEach(b=>{if(task.options[Number(b.dataset.option)]===task.answer)b.classList.add("correct")});button.classList.add(chosen===task.answer?"correct":"wrong");finishPractice(chosen===task.answer);
}

function nextPractice(){
  practiceState.index++;
  if(practiceState.index>=practiceState.tasks.length){finishPracticeSession();return}
  renderPracticeTask();
}

function finishPracticeSession(){
  const total=practiceState.stats.total,accuracy=total?Math.round(practiceState.stats.correct/total*100):0;
  document.getElementById("practiceCard").hidden=true;
  document.getElementById("practiceSummary").hidden=false;
  renderProgressFill(document.getElementById("practiceProgress"), 100);
  document.getElementById("practiceScore").textContent=`${accuracy}%`;
  if(!practiceState.secure && typeof savePracticeHistory==="function") savePracticeHistory({sessionId:vocabFlowUuid("practice"),date:new Date().toISOString(),totalTasks:total,correct:practiceState.stats.correct,words:practiceState.stats.words,sentences:practiceState.stats.sentences});
  document.getElementById("practiceTotalDone").textContent=total;
  document.getElementById("practiceCorrect").textContent=practiceState.stats.correct;
  document.getElementById("practiceWordsDone").textContent=practiceState.stats.words;
  document.getElementById("practiceSentencesDone").textContent=practiceState.stats.sentences;
}

if(typeof document!=="undefined")document.addEventListener("vocabflow:pageinit",()=>{
  const root=document.querySelector("main.main-content");
  if(window.VocabFlowEvents && !VocabFlowEvents.pageSetup("practice", root, ()=>{})) return;
  const card=document.getElementById("practiceCard");
  if(!card)return;
  document.getElementById("practiceStart")?.addEventListener("click",startPractice);
  document.getElementById("practiceRestart")?.addEventListener("click",startPractice);
  document.getElementById("practiceNext")?.addEventListener("click",nextPractice);
  document.getElementById("practiceArea")?.addEventListener("click",e=>{
    const b=e.target.closest(".practice-option");if(b)return handlePracticeOption(b);
    if(e.target.id==="practiceShowAnswer"){
      document.getElementById("practiceAnswer").hidden=false;
      document.getElementById("practiceShowAnswer")?.remove();
      if(practiceState.secure){
        VocabFlowApi.request("/api/practice/answer",{method:"POST",body:JSON.stringify({attemptId:practiceState.attemptId,questionIndex:practiceState.index,action:"reveal"})}).then(result=>{practiceState.answered=true;const fb=document.getElementById("practiceFeedback");fb.textContent=`${trP("qz_notQuite","Not quite. Correct answer:")} ${result.correctAnswer}`;fb.className="practice-feedback bad";setUiHidden(document.getElementById("practiceNext"), false);if(result.completed)renderPracticeServerSummary(result.summary)}).catch(error=>{document.getElementById("practiceFeedback").textContent=error.message||"Could not submit the answer.";practiceState.answered=false;});
      }else finishPractice(true);
    }
    if(e.target.id==="practiceCheck")checkPracticeInput();
  });
  document.getElementById("practiceArea")?.addEventListener("keydown",e=>{
    if(e.key!=="Enter"||e.isComposing||e.target.id!=="practiceInput")return;
    e.preventDefault();
    checkPracticeInput();
  });
  if(window.VocabFlowEvents) VocabFlowEvents.once("practice", "vocabflow:langchange", ()=>{
    if(practiceState.tasks.length && document.getElementById("practiceCard") && !document.getElementById("practiceCard").hidden) renderPracticeTask();
  });
  startPractice();
});
