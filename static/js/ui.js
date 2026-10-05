
(function(){
  function settings(){return typeof getSettings==="function"?getSettings():{}}
  function syncNotice(){
    let notice=document.getElementById("vfSyncNotice");
    if(!notice){
      notice=document.createElement("div");
      notice.id="vfSyncNotice";
      notice.className="vf-sync-notice";
      notice.setAttribute("role","status");
      notice.setAttribute("aria-live","polite");
      notice.innerHTML='<span class="vf-sync-message"></span><button type="button" class="vf-sync-retry"></button>';
      document.body.appendChild(notice);
      notice.querySelector(".vf-sync-retry").addEventListener("click",()=>{
        notice.classList.add("is-visible","is-pending");
        notice.querySelector(".vf-sync-message").textContent=document.documentElement.lang==="ar"?"جارٍ إعادة المزامنة…":"Retrying sync…";
        window.VocabFlowRemote?.retryPending();
      });
    }
    return notice;
  }
  document.addEventListener("vocabflow:syncerror",event=>{
    const notice=syncNotice(),ar=document.documentElement.lang==="ar",permanent=Boolean(event.detail?.permanent),rolledBack=Boolean(event.detail?.rolledBack);
    notice.classList.toggle("is-pending",!permanent);
    notice.classList.toggle("is-error",permanent);
    notice.classList.add("is-visible");
    notice.querySelector(".vf-sync-message").textContent=permanent
      ?(ar?"تعذر حفظ بعض التغييرات على الخادم. أعد المحاولة بعد مراجعتها.":"Some changes were rejected by the server. Review them and try again.")
      :rolledBack
        ?(ar?"لم تكتمل عملية الاستيراد؛ تغييراتك السابقة محفوظة والمزامنة ستُعاد عند عودة الاتصال.":"The import did not complete. Earlier changes are saved and will sync when the connection returns.")
        :(ar?"تغييراتك محفوظة على هذا الجهاز، والمزامنة ستُعاد عند عودة الاتصال.":"Changes are saved on this device. Sync will retry when the connection returns.");
    const retry=notice.querySelector(".vf-sync-retry");
    retry.textContent=ar?"إعادة المحاولة":"Retry";
    retry.hidden=permanent;
  });
  document.addEventListener("vocabflow:syncsuccess",()=>{
    const notice=document.getElementById("vfSyncNotice");
    if(!notice)return;
    notice.classList.remove("is-pending","is-error");
    notice.querySelector(".vf-sync-message").textContent=document.documentElement.lang==="ar"?"تمت مزامنة بياناتك":"Your data is synced";
    notice.querySelector(".vf-sync-retry").hidden=true;
    notice.classList.add("is-visible");
    window.setTimeout(()=>notice.classList.remove("is-visible"),2200);
  });
  function apply(mode){
    mode=mode==="dark"?"dark":"light";
    document.documentElement.dataset.theme=mode;
    const b=document.getElementById("themeToggle"),i=b?.querySelector(".theme-icon"),l=b?.querySelector(".theme-label");
    if(i)i.innerHTML=mode==="dark"?'<path d="M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4"/><circle cx="12" cy="12" r="4"/>':'<path d="M20.6 15.8A8 8 0 1 1 8.2 3.4 6.5 6.5 0 0 0 20.6 15.8Z"/>';
    if(l)l.textContent = (typeof window.t==="function") ? window.t(mode==="dark"?"lightMode":"darkMode") : (mode==="dark"?"Light Mode":"Dark Mode");
    if(b){b.setAttribute("aria-pressed",mode==="dark"?"true":"false");b.title=mode==="dark"?"Switch to light mode":"Switch to dark mode"}
  }
  window.applyThemeLabel = apply;
  if(typeof document!=="undefined")document.addEventListener("vocabflow:pageinit",()=>{
    apply(settings().theme||"light");
    const b=document.getElementById("themeToggle");
    if(b&&!b.dataset.bound){b.dataset.bound="1";b.addEventListener("click",()=>{
      const next=document.documentElement.dataset.theme==="dark"?"light":"dark";
      saveSettings({...settings(),theme:next});apply(next);
    })}
  });
})();

function renderProgressFill(element, percentage) {
  if (!element) return;
  const value = Math.max(0, Math.min(100, Number(percentage) || 0));
  element.innerHTML = `<svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" width="${value}" height="4" rx="2"></rect></svg>`;
}
function setUiHidden(element, hidden) {
  if (!element) return;
  element.hidden = Boolean(hidden);
}
