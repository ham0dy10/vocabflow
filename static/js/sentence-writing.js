
function normalizeWritingText(value){return String(value||"").trim().toLowerCase().replace(/[“”"'’]/g,"").replace(/[.,!?;:]+/g,"").replace(/\s+/g," ")}
function tokenizeWritingText(value){return normalizeWritingText(value).split(" ").filter(Boolean)}
function trW(key,fallback){return typeof t==="function"?t(key):fallback}
function compareWritingAnswers(userText,correctText){
  const user=tokenizeWritingText(userText),correct=tokenizeWritingText(correctText);
  if(!user.length)return{score:0,label:trW("wr_labelNoAnswer","No answer"),missing:correct,extra:[]};
  const set=new Set(correct),userSet=new Set(user);let overlap=0;
  for(const token of user)if(set.has(token))overlap++;
  const missing=correct.filter(x=>!userSet.has(x)),extra=user.filter(x=>!set.has(x));
  const lengthScore=1-Math.min(1,Math.abs(user.length-correct.length)/Math.max(correct.length,1));
  const wordScore=overlap/Math.max(correct.length,1);
  const score=Math.round(Math.max(0,Math.min(100,(wordScore*.8+lengthScore*.2)*100)));
  let label=trW("wr_labelNeedsPractice","Needs Practice");if(score>=90)label=trW("wr_labelExcellent","Excellent");else if(score>=75)label=trW("rate_good","Good");else if(score>=55)label=trW("wr_labelClose","Close");
  return{score,label,missing,extra};
}
function buildWritingQueue(){
 const all=getSentences(),now=new Date(),due=all.filter(s=>s.nextReview&&new Date(s.nextReview)<=now),fresh=all.filter(s=>s.status==="new"),rest=all.filter(s=>!due.some(x=>x.id===s.id)&&!fresh.some(x=>x.id===s.id)),out=[],seen=new Set();
 for(const s of [...due,...fresh,...rest]){if(!seen.has(s.id)){seen.add(s.id);out.push(s)}if(out.length>=10)break}
 return out;
}
const writingState={queue:[],index:0,checked:false,submitting:false,results:[]};
function escWriting(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
function renderWritingQuestion(){
  const item=writingState.queue[writingState.index],total=writingState.queue.length;
  document.getElementById("writingCounter").textContent=`${writingState.index+1} / ${total}`;
  renderProgressFill(document.getElementById("writingProgress"), total ? (writingState.index / total) * 100 : 0);
  document.getElementById("writingPrompt").textContent=item.arabicMeaning;
  document.getElementById("writingInput").value="";
  document.getElementById("writingInput").disabled=false;
  document.getElementById("writingFeedback").hidden=true;
  document.getElementById("writingActionsBefore").hidden=false;
  document.getElementById("writingActionsAfter").hidden=true;
  writingState.checked=false;
}
function renderWritingFeedback(result,item){
  const box=document.getElementById("writingResult");
  const none=trW("wr_none","None");
  box.className=`writing-result ${result.score>=75?"good":result.score>=40?"partial":"bad"}`;
  box.innerHTML=`<div class="writing-result-title">${result.label}</div>
  <div class="writing-line"><span class="writing-label">${trW("wr_yourAnswer","Your answer")}</span><br>${escWriting(document.getElementById("writingInput").value||trW("wr_labelNoAnswer","No answer"))}</div>
  <div class="writing-line"><span class="writing-label">${trW("wr_correctSentence","Correct sentence")}</span><br>${escWriting(item.sentence)}</div>
  <div class="writing-line"><span class="writing-label">${trW("wr_missingWords","Missing / weak words")}</span><br>${escWriting(result.missing.length?result.missing.join(" · "):none)}</div>
  <div class="writing-line"><span class="writing-label">${trW("wr_extraWords","Extra words")}</span><br>${escWriting(result.extra.length?result.extra.join(" · "):none)}</div>
  <div class="writing-score">${trW("wr_score","Score")} ${result.score}%</div>`;
  document.getElementById("writingFeedback").hidden=false;document.getElementById("writingActionsBefore").hidden=true;document.getElementById("writingActionsAfter").hidden=false;document.getElementById("writingInput").disabled=true;
}
async function checkWritingAnswer(){
  if(writingState.checked||writingState.submitting)return;
  const item=writingState.queue[writingState.index];
  const result=compareWritingAnswers(document.getElementById("writingInput").value,item.sentence);
  const rating=result.score>=75?"good":result.score>=40?"hard":"again";
  writingState.submitting=true;
  try{
    const response=await VocabFlowApi.request("/api/sentence-reviews",{
      method:"POST",
      body:JSON.stringify({sentenceId:item.id,rating,expectedLastReview:item.lastReview||null})
    });
    if(!response||response.ok!==true||!response.sentence)throw new Error(response?.error||"Could not save the review");
    if(typeof applyServerSentenceReview==="function")applyServerSentenceReview(response.sentence,response.review);
    writingState.checked=true;writingState.results.push(result);renderWritingFeedback(result,response.sentence);
  }catch(error){
    const message=error instanceof Error?error.message:"Could not save the review";
    if(typeof showToast==="function")showToast(message,"error");else window.alert(message);
  }finally{
    writingState.submitting=false;
  }
}
function nextWritingQuestion(){writingState.index++;if(writingState.index>=writingState.queue.length)return finishWritingPractice();renderWritingQuestion()}
function finishWritingPractice(){
  const total=writingState.results.length,score=total?Math.round(writingState.results.reduce((a,r)=>a+r.score,0)/total):0;
  document.getElementById("writingCard").hidden=true;document.getElementById("writingSummary").hidden=false;renderProgressFill(document.getElementById("writingProgress"), 100);
  document.getElementById("writingSummaryScore").textContent=score+"%";document.getElementById("writingSummaryTotal").textContent=total;document.getElementById("writingSummaryExcellent").textContent=writingState.results.filter(r=>r.score>=90).length;document.getElementById("writingSummaryNeedsWork").textContent=writingState.results.filter(r=>r.score<75).length;
}
function startWritingPractice(){
  writingState.queue=buildWritingQueue();writingState.index=0;writingState.checked=false;writingState.submitting=false;writingState.results=[];
  const card=document.getElementById("writingCard"),empty=document.getElementById("writingEmpty"),summary=document.getElementById("writingSummary");summary.hidden=true;
  if(!writingState.queue.length){card.hidden=true;empty.hidden=false;return}
  empty.hidden=true;card.hidden=false;renderWritingQuestion();
}
if(typeof document!=="undefined")document.addEventListener("vocabflow:pageinit",()=>{
  const root=document.querySelector("main.main-content");
  if(window.VocabFlowEvents&&!VocabFlowEvents.pageSetup("sentence-writing",root,()=>{}))return;
  if(!document.getElementById("writingCard"))return;
  document.getElementById("writingCheck")?.addEventListener("click",checkWritingAnswer);
  document.getElementById("writingNext")?.addEventListener("click",nextWritingQuestion);
  document.getElementById("writingRestart")?.addEventListener("click",startWritingPractice);
  document.getElementById("writingInput")?.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){e.preventDefault();writingState.checked?nextWritingQuestion():checkWritingAnswer()}});
  const refreshWritingLanguage=()=>{
    if(writingState.queue.length && document.getElementById("writingCard") && !document.getElementById("writingCard").hidden && !writingState.checked) renderWritingQuestion();
  };
  if(window.VocabFlowEvents) VocabFlowEvents.once("sentence-writing", "vocabflow:langchange", refreshWritingLanguage);
  else window.addEventListener("vocabflow:langchange", refreshWritingLanguage);
  startWritingPractice();
});
