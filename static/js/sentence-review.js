
const sentenceReviewState={queue:[],index:0,shown:false,submitting:false,stats:{reviewed:0,again:0,hard:0,good:0,easy:0}};
function getSentenceReviewQueue(){const all=getSentences(),now=new Date(),due=all.filter(s=>s.nextReview&&new Date(s.nextReview)<=now),fresh=all.filter(s=>s.status==="new"),seen=new Set(),out=[];for(const s of [...due,...fresh]){if(!seen.has(s.id)){seen.add(s.id);out.push(s)}}return out.length ? out.slice(0,Number(getSettings().dailyNewWords)||10) : all.slice(0,Number(getSettings().dailyNewWords)||10)}
function showSentenceAnswer(){if(sentenceReviewState.shown)return;sentenceReviewState.shown=true;document.getElementById("sentenceAnswer").hidden=false;document.getElementById("sentenceShowAnswer").hidden=true;document.getElementById("sentenceRatingGrid").hidden=false}
function renderSentenceCard(){const s=sentenceReviewState.queue[sentenceReviewState.index];if(!s)return;document.getElementById("sentenceReviewCounter").textContent=`${sentenceReviewState.index+1} / ${sentenceReviewState.queue.length}`;renderProgressFill(document.getElementById("sentenceSessionProgress"), sentenceReviewState.queue.length ? (sentenceReviewState.index / sentenceReviewState.queue.length) * 100 : 0);document.getElementById("sentenceCardText").textContent=s.sentence;document.getElementById("sentenceAnswerMeaning").textContent=s.arabicMeaning;document.getElementById("sentenceAnswer").hidden=true;document.getElementById("sentenceShowAnswer").hidden=false;document.getElementById("sentenceRatingGrid").hidden=true;sentenceReviewState.shown=false}
function finishSentenceReview(){const total=sentenceReviewState.stats.reviewed;document.getElementById("sentenceReviewCard").hidden=true;document.getElementById("sentenceReviewSummary").hidden=false;document.getElementById("sentenceSummaryReviewed").textContent=total;document.getElementById("sentenceSummaryAgain").textContent=sentenceReviewState.stats.again;document.getElementById("sentenceSummaryGood").textContent=sentenceReviewState.stats.good;document.getElementById("sentenceSummaryEasy").textContent=sentenceReviewState.stats.easy;document.getElementById("sentenceSummaryAccuracy").textContent=`${total?Math.round((total-sentenceReviewState.stats.again)/total*100):0}%`}
async function rateSentence(r){
  if(!sentenceReviewState.shown || sentenceReviewState.submitting)return;
  const s=sentenceReviewState.queue[sentenceReviewState.index];
  sentenceReviewState.submitting=true;
  try{
    const result=await VocabFlowApi.request("/api/sentence-reviews",{
      method:"POST",
      body:JSON.stringify({sentenceId:s.id,rating:r,expectedLastReview:s.lastReview||null})
    });
    applyServerSentenceReview(result.sentence,result.review);
    sentenceReviewState.stats.reviewed++;
    sentenceReviewState.stats[r]++;
    sentenceReviewState.index++;
    if(sentenceReviewState.index>=sentenceReviewState.queue.length)finishSentenceReview();
    else {sentenceReviewState.submitting=false;renderSentenceCard();}
  }catch(error){
    sentenceReviewState.submitting=false;
    if(typeof window.showToast==="function")window.showToast(error.message||"Could not save this review.","error");
    else alert(error.message||"Could not save this review.");
  }
}
function startSentenceReview(){sentenceReviewState.queue=getSentenceReviewQueue();sentenceReviewState.index=0;sentenceReviewState.shown=false;sentenceReviewState.submitting=false;sentenceReviewState.stats={reviewed:0,again:0,hard:0,good:0,easy:0};const e=document.getElementById("sentenceReviewEmpty"),c=document.getElementById("sentenceReviewCard");document.getElementById("sentenceReviewSummary").hidden=true;if(!sentenceReviewState.queue.length){c.hidden=true;e.hidden=false;return}e.hidden=true;c.hidden=false;renderSentenceCard()}
if(typeof document!=="undefined")document.addEventListener("vocabflow:pageinit",()=>{const root=document.querySelector("main.main-content");if(window.VocabFlowEvents&&!VocabFlowEvents.pageSetup("sentence-review",root,()=>{}))return;if(!document.getElementById("sentenceReviewCard"))return;document.getElementById("sentenceShowAnswer")?.addEventListener("click",showSentenceAnswer);document.getElementById("sentenceRatingGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-rating]");if(b)rateSentence(b.dataset.rating)});document.getElementById("sentenceReviewRestart")?.addEventListener("click",startSentenceReview);if(window.VocabFlowEvents) VocabFlowEvents.once("sentence-review", "vocabflow:langchange", ()=>{if(sentenceReviewState.queue.length&&document.getElementById("sentenceReviewCard")&&!document.getElementById("sentenceReviewCard").hidden)renderSentenceCard()});startSentenceReview()})
