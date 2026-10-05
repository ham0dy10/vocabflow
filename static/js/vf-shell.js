(function(){
  "use strict";
  function setActiveNav(){
    const path=window.location.pathname==="/word-context"?"/words":window.location.pathname;
    document.querySelectorAll(".site-nav [data-nav-path]").forEach(link=>link.classList.toggle("active",link.dataset.navPath===path));
    const libraryPaths=["/words","/sentences","/add-word","/add-sentence","/data"];
    const libraryTrigger=document.getElementById("libraryMenuTrigger");
    if(libraryTrigger) libraryTrigger.classList.toggle("active",libraryPaths.includes(path));
  }
  function setupLibraryMenu(){
    const trigger=document.getElementById("libraryMenuTrigger"),menu=document.getElementById("libraryMenu"),wrap=document.getElementById("libraryMenuWrap");
    if(!trigger||!menu||!wrap||trigger.dataset.bound)return;
    trigger.dataset.bound="1";
    const close=()=>{menu.hidden=true;trigger.setAttribute("aria-expanded","false")};
    trigger.addEventListener("click",()=>{const open=!menu.hidden;menu.hidden=open;trigger.setAttribute("aria-expanded",open?"false":"true")});
    menu.addEventListener("click",e=>{if(e.target.closest("a"))close()});
    document.addEventListener("click",e=>{if(!e.target.closest("#libraryMenuWrap"))close()});
    document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});
  }
  function setupMenu(){
    const nav=document.getElementById("siteNav"),button=document.getElementById("mobileMenuButton"),backdrop=document.getElementById("mobileNavBackdrop");
    if(!nav||!button||!backdrop||button.dataset.bound)return;
    button.dataset.bound="1";
    const close=()=>{nav.classList.remove("mobile-open");backdrop.hidden=true;button.setAttribute("aria-expanded","false");document.body.classList.remove("mobile-nav-open")};
    const open=()=>{nav.classList.add("mobile-open");backdrop.hidden=false;button.setAttribute("aria-expanded","true");document.body.classList.add("mobile-nav-open")};
    button.addEventListener("click",()=>nav.classList.contains("mobile-open")?close():open());
    backdrop.addEventListener("click",close);
    document.addEventListener("keydown",e=>{if(e.key==="Escape")close()});
    nav.addEventListener("click",e=>{if(e.target.closest("a")){close();const lib=document.getElementById("libraryMenu");if(lib)lib.hidden=true;const trig=document.getElementById("libraryMenuTrigger");if(trig)trig.setAttribute("aria-expanded","false")}});
  }
  function setup(){
    setActiveNav();
    setupMenu();
    setupLibraryMenu();
    const menu=document.getElementById("libraryMenu"),trigger=document.getElementById("libraryMenuTrigger");
    if(menu)menu.hidden=true;
    if(trigger)trigger.setAttribute("aria-expanded","false");
  }
  document.addEventListener("vocabflow:pageinit",setup);
  window.addEventListener("popstate",setup);
})();
