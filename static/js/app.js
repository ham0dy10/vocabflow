function homeStats(){
 const w=getWords(), total=w.length, mastered=w.filter(x=>x.status==="mastered").length, learning=w.filter(x=>x.status==="learning").length, due=w.filter(x=>x.nextReview&&new Date(x.nextReview)<=new Date()).length;
 const put=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
 const text=(key,fallback)=>typeof window.t==="function"?(window.t(key)||fallback):fallback;
 put("totalWords",total); put("masteredWords",mastered); put("learningWords",learning); put("dueToday",due);
 const reviewPill=document.getElementById("reviewPill");
 if(reviewPill) reviewPill.textContent=`${due} ${text(due===1?"home_card":"home_cards",due===1?"card":"cards")}`;
 const message=document.getElementById("reviewMessage");
 if(message) message.textContent = due ? text(due===1?"home_dueMessageOne":"home_dueMessageMany", due===1?"You have 1 card ready for review today.":`You have ${due} cards ready for review today.`).replace("{count}", String(due)) : text("home_caughtUp","You are all caught up.");
}
document.addEventListener("vocabflow:pageinit",homeStats);
window.addEventListener("vocabflow:langchange",homeStats);
