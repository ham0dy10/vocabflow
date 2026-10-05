(function(){
  "use strict";
  const SELECT_SELECTOR = "select.select, select.quiz-select";

  function escapeHtml(value){
    return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));
  }

  function closeAll(except){
    document.querySelectorAll(".vf-select.open").forEach(wrap=>{
      if(wrap!==except) setOpen(wrap,false);
    });
  }

  function setOpen(wrap, open){
    const trigger=wrap.querySelector(".vf-select-trigger");
    const menu=wrap.querySelector(".vf-select-menu");
    if(!trigger||!menu)return;
    wrap.classList.toggle("open",open);
    trigger.setAttribute("aria-expanded",open?"true":"false");
    menu.hidden=!open;
  }

  function sync(wrap){
    const select=wrap.querySelector("select");
    const label=wrap.querySelector(".vf-select-label");
    const menu=wrap.querySelector(".vf-select-menu");
    if(!select||!label||!menu)return;
    const options=[...select.options];
    label.textContent=select.selectedOptions[0]?.textContent?.trim() || "";
    menu.querySelectorAll(".vf-select-option").forEach(btn=>{
      const selected=btn.dataset.value===String(select.value);
      btn.setAttribute("aria-selected",selected?"true":"false");
    });
  }

  function build(select){
    if(!select || select.dataset.vfSelectReady==="1")return;
    select.dataset.vfSelectReady="1";
    const wrap=document.createElement("div");
    wrap.className="vf-select";
    select.classList.add("vf-select-native");
    select.parentNode.insertBefore(wrap,select);
    wrap.appendChild(select);

    const trigger=document.createElement("button");
    trigger.type="button";
    trigger.className="vf-select-trigger";
    trigger.setAttribute("aria-haspopup","listbox");
    trigger.setAttribute("aria-expanded","false");
    trigger.innerHTML='<span class="vf-select-label"></span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>';
    wrap.appendChild(trigger);

    const menu=document.createElement("div");
    menu.className="vf-select-menu";
    menu.hidden=true;
    menu.setAttribute("role","listbox");
    wrap.appendChild(menu);

    const rebuild=()=>{
      menu.innerHTML=[...select.options].map((opt,i)=>`<button type="button" class="vf-select-option" role="option" data-value="${escapeHtml(opt.value)}" data-index="${i}">${escapeHtml(opt.textContent?.trim()||"")}</button>`).join("");
      sync(wrap);
    };

    trigger.addEventListener("click",()=>{
      const next=!wrap.classList.contains("open");
      closeAll(wrap);
      setOpen(wrap,next);
      if(next) menu.querySelector('[aria-selected="true"]')?.focus();
    });

    trigger.addEventListener("keydown",e=>{
      const items=[...menu.querySelectorAll(".vf-select-option")];
      if(e.key==="ArrowDown"||e.key==="ArrowUp"){
        e.preventDefault();
        if(!wrap.classList.contains("open")){setOpen(wrap,true);closeAll(wrap);return;}
        const current=document.activeElement;
        let idx=Math.max(0,items.indexOf(current));
        idx=e.key==="ArrowDown"?Math.min(items.length-1,idx+1):Math.max(0,idx-1);
        items[idx]?.focus();
      }else if(e.key==="Enter"||e.key===" "){e.preventDefault();trigger.click();}
    });

    menu.addEventListener("click",e=>{
      const option=e.target.closest(".vf-select-option");
      if(!option)return;
      select.value=option.dataset.value ?? "";
      select.dispatchEvent(new Event("change",{bubbles:true}));
      sync(wrap);
      setOpen(wrap,false);
      trigger.focus();
    });

    menu.addEventListener("keydown",e=>{
      const items=[...menu.querySelectorAll(".vf-select-option")];
      const current=document.activeElement;
      let idx=items.indexOf(current);
      if(e.key==="ArrowDown"){e.preventDefault();items[Math.min(items.length-1,idx+1)]?.focus();}
      else if(e.key==="ArrowUp"){e.preventDefault();if(idx<=0)trigger.focus();else items[idx-1]?.focus();}
      else if(e.key==="Home"){e.preventDefault();items[0]?.focus();}
      else if(e.key==="End"){e.preventDefault();items[items.length-1]?.focus();}
      else if(e.key==="Escape"){e.preventDefault();setOpen(wrap,false);trigger.focus();}
      else if(e.key==="Enter"||e.key===" "){e.preventDefault();current?.click();}
    });

    select.addEventListener("change",()=>sync(wrap));
    const observer=new MutationObserver(()=>rebuild());
    observer.observe(select,{childList:true,subtree:true,characterData:true});
    wrap._vfRebuild=rebuild;
    rebuild();
  }

  function init(){
    document.querySelectorAll(SELECT_SELECTOR).forEach(build);
  }

  document.addEventListener("click",e=>{
    if(!e.target.closest(".vf-select"))closeAll();
  });
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAll();});
  document.addEventListener("vocabflow:pageinit",()=>{init();requestAnimationFrame(init);});
  window.VocabFlowSelects={init,refresh:()=>document.querySelectorAll(".vf-select").forEach(w=>w._vfRebuild?.())};
  init();
})();
