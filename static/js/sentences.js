const SENTENCE_STORAGE_KEY="vocabflow_sentences";
function getSentences(){
  if(typeof VocabFlowState !== "undefined") return [...VocabFlowState.get().sentences];
  if(typeof readJSON === "function") return readJSON(SENTENCE_STORAGE_KEY, []);
  return [];
}
function saveSentences(v, options={}){
 const value=Array.isArray(v)?v:[], previous=getSentences();
 const nextIds=new Set(value.map(item=>String(item?.id)));
 const removedIds=new Set(previous.filter(item=>!nextIds.has(String(item?.id))).map(item=>String(item?.id)));
 const currentState=typeof VocabFlowState!=="undefined"?VocabFlowState.get():null;
 const cleanedReviews=removedIds.size&&currentState
   ? currentState.sentenceReviews.filter(review=>!removedIds.has(String(review?.sentenceId)))
   : currentState?.sentenceReviews;
 if(typeof VocabFlowState !== "undefined") VocabFlowState.update({sentences:value,...(cleanedReviews?{sentenceReviews:cleanedReviews}:{})});
 if(typeof writeJSON === "function") writeJSON(SENTENCE_STORAGE_KEY,value);
 if(typeof writeJSON === "function"&&cleanedReviews) writeJSON("vocabflow_sentence_reviews",cleanedReviews);
 if(options.remote!==false&&typeof VocabFlowRemote!=="undefined"&&VocabFlowRemote.enabled){
  const before=new Map(previous.map(x=>[String(x.id),x])), after=new Map(value.map(x=>[String(x.id),x]));
  for(const [id,item] of after){
   if(!before.has(id)) VocabFlowRemote.queueSentenceCreate(item);
   else if(JSON.stringify(before.get(id))!==JSON.stringify(item)) VocabFlowRemote.queueSentenceUpdate(item);
  }
  for(const id of before.keys()) if(!after.has(id)) VocabFlowRemote.queueSentenceDelete(id);
  // Sentence deletion cascades sentence reviews in SQLite; mirror that locally.
 }
 if(typeof dispatchVocabFlowDataChange==="function")dispatchVocabFlowDataChange();
 return getSentences();
}
function makeSentenceId(){return vocabFlowUuid("sentence")}
function normalizeSentenceText(v){return String(v||"").trim().replace(/\s+/g," ")}
function createSentence(d){const requestedId=String(d?.id||"");return{id:/^[A-Za-z0-9_.:-]{1,80}$/.test(requestedId)?requestedId:makeSentenceId(),sentence:normalizeSentenceText(d?.sentence),arabicMeaning:String(d?.arabicMeaning||"").trim(),category:String(d?.category||"General").trim()||"General",difficulty:["easy","medium","hard"].includes(String(d?.difficulty||"").toLowerCase())?String(d.difficulty).toLowerCase():"medium",favorite:Boolean(d?.favorite),status:["new","learning","reviewing","mastered"].includes(String(d?.status||"").toLowerCase())?String(d.status).toLowerCase():"new",repetitions:Number(d?.repetitions||0),interval:Number(d?.interval||0),easeFactor:Number(d?.easeFactor||2.5),lastReview:d?.lastReview||null,nextReview:d?.nextReview||null,createdAt:d?.createdAt||new Date().toISOString()}}
function sentenceKey(v){return normalizeSentenceText(v).toLowerCase().replace(/[.!?,;:]+$/g,"")}
function findDuplicateSentence(s,excludeId=null){const q=sentenceKey(s);return getSentences().some(x=>x.id!==excludeId&&sentenceKey(x.sentence)===q)}
function validateSentenceInput(d,excludeId=null){const tr=(k,f)=>typeof t==="function"?t(k):f;const e=[];if(!normalizeSentenceText(d.sentence))e.push(tr("sl_englishSentenceRequired","English sentence is required."));if(!String(d.arabicMeaning||"").trim())e.push(tr("wl_definitionRequired","Arabic meaning is required."));if(findDuplicateSentence(d.sentence,excludeId))e.push(tr("sl_sentenceExists","This sentence already exists."));return e}
function addSentence(s){const a=getSentences();a.push(s);saveSentences(a);return s}
function updateSentence(id,p){const a=getSentences().map(x=>x.id===id?{...x,...p}:x);saveSentences(a);return a.find(x=>x.id===id)||null}
function deleteSentence(id){const a=getSentences().filter(x=>x.id!==id);saveSentences(a);return a}
function mergeImportedSentences(incoming){const map=new Map(getSentences().map(s=>[sentenceKey(s.sentence),s]));let added=0,updated=0,skipped=0;for(const raw of(Array.isArray(incoming)?incoming:[])){const item=createSentence(raw);if(!item.sentence||!item.arabicMeaning){skipped++;continue;}const key=sentenceKey(item.sentence),old=map.get(key);if(old){map.set(key,{...old,...item,id:old.id});updated++;}else{map.set(key,item);added++;}}saveSentences([...map.values()]);return{added,updated,skipped,total:map.size};}
