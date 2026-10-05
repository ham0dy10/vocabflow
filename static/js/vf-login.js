(function(){
  "use strict";
  let mode="login";
  const copy={
    en:{titleLogin:"Welcome back",subtitleLogin:"Sign in to continue to your vocabulary workspace.",titleRegister:"Create your account",subtitleRegister:"Keep your vocabulary and learning history with one account.",submitLogin:"Sign in",submitRegister:"Create account",passwordLogin:"Use the password for this account.",passwordRegister:"Use 8-128 characters.",usernameLogin:"Username or email",usernameRegister:"Username",generic:"Something went wrong. Please try again."},
    ar:{titleLogin:"مرحبًا بعودتك",subtitleLogin:"سجّل الدخول للمتابعة إلى مساحة تعلّم المفردات.",titleRegister:"أنشئ حسابك",subtitleRegister:"احتفظ بمفرداتك وسجل تعلّمك في حساب واحد.",submitLogin:"تسجيل الدخول",submitRegister:"إنشاء حساب",passwordLogin:"استخدم كلمة المرور لهذا الحساب.",passwordRegister:"استخدم من 8 إلى 128 حرفًا.",usernameLogin:"اسم المستخدم أو البريد الإلكتروني",usernameRegister:"اسم المستخدم",generic:"حدث خطأ ما. حاول مرة أخرى.",accountCreateFailed:"تعذّر إنشاء الحساب. تحقّق من اسم المستخدم والبريد الإلكتروني ثم حاول مرة أخرى."}
  };
  const lang=()=>typeof getSettings==="function"?(getSettings().language||"en"):"en";
  const tlocal=k=>(copy[lang()]||copy.en)[k];
  function setMode(next){
    mode=next;
    const reg=mode==="register";
    ["loginTab","registerTab"].forEach(id=>document.getElementById(id)?.classList.remove("active"));
    document.getElementById(reg?"registerTab":"loginTab")?.classList.add("active");
    ["fullNameField","emailField","confirmPasswordField"].forEach(id=>{const el=document.getElementById(id);if(el)el.hidden=!reg});
    document.getElementById("username")?.setAttribute("autocomplete",reg?"username":"username");
    document.getElementById("password")?.setAttribute("autocomplete",reg?"new-password":"current-password");
    document.getElementById("authTitle").textContent=tlocal(reg?"titleRegister":"titleLogin");
    document.getElementById("authSubtitle").textContent=tlocal(reg?"subtitleRegister":"subtitleLogin");
    const usernameLabel=document.getElementById("usernameLabel");
    if(usernameLabel) usernameLabel.textContent=tlocal(reg?"usernameRegister":"usernameLogin");
    document.getElementById("authSubmit").textContent=tlocal(reg?"submitRegister":"submitLogin");
    document.getElementById("passwordNote").textContent=tlocal(reg?"passwordRegister":"passwordLogin");
    document.getElementById("authError").textContent="";
  }
  function applyLocalTheme(){
    const settings=typeof getSettings==="function"?getSettings():{};
    const dark=settings.theme==="dark";
    document.documentElement.dataset.theme=dark?"dark":"light";
    const label=document.getElementById("authThemeLabel");
    if(label)label.textContent=typeof t==="function"?t(dark?"lightMode":"darkMode"):(dark?"Light Mode":"Dark Mode");
  }
  async function submit(e){
    e.preventDefault();
    const err=document.getElementById("authError"),button=document.getElementById("authSubmit");
    err.textContent="";button.disabled=true;
    const username=document.getElementById("username").value.trim(),password=document.getElementById("password").value;
    try{
      if(mode==="register"){
        const fullName=document.getElementById("fullName").value.trim(),email=document.getElementById("email").value.trim(),confirm=document.getElementById("confirmPassword").value;
        if(password!==confirm)throw new Error(lang()==="ar"?"كلمتا المرور غير متطابقتين.":"Passwords do not match.");
        await window.VocabFlowAuth.register({fullName,email,username,password});
      }else await window.VocabFlowAuth.login(username,password);
      window.location.href="/";
    }catch(error){
      const code=error?.body?.code;
      err.textContent=code==="ACCOUNT_CREATE_FAILED"?tlocal("accountCreateFailed"):(error?.message||tlocal("generic"));
      button.disabled=false;
    }
  }
  function setupEnterNavigation(){
    const form=document.getElementById("authForm");
    if(!form || form.dataset.enterNavReady) return;
    form.dataset.enterNavReady="1";
    form.addEventListener("keydown",event=>{
      if(event.key!=="Enter" || event.isComposing) return;
      const target=event.target;
      if(!(target instanceof HTMLInputElement)) return;
      const fields=[...form.querySelectorAll("input")].filter(input=>{
        const group=input.closest(".auth-field");
        return !input.disabled && !input.hidden && !!group && !group.hidden && input.offsetParent!==null;
      });
      const index=fields.indexOf(target);
      if(index<0) return;
      const next=fields[index+1];
      if(next){
        event.preventDefault();
        next.focus({preventScroll:true});
        next.select?.();
        return;
      }
      const submitButton=document.getElementById("authSubmit");
      if(submitButton && !submitButton.disabled){
        event.preventDefault();
        if(typeof form.requestSubmit === "function") form.requestSubmit(submitButton);
        else submitButton.click();
      }
    });
  }
  document.addEventListener("DOMContentLoaded",()=>{
    document.getElementById("loginTab")?.addEventListener("click",()=>setMode("login"));
    document.getElementById("registerTab")?.addEventListener("click",()=>setMode("register"));
    document.getElementById("authForm")?.addEventListener("submit",submit);
    setupEnterNavigation();
    document.getElementById("authLangToggle")?.addEventListener("click",()=>{const next=lang()==="ar"?"en":"ar";if(typeof setLanguage==="function")setLanguage(next);else{saveSettings({language:next});applyTranslations();}setMode(mode)});
    document.getElementById("authThemeToggle")?.addEventListener("click",()=>{const current=typeof getSettings==="function"?getSettings():{};const next=current.theme==="dark"?"light":"dark";if(typeof saveSettings==="function")saveSettings({theme:next});applyLocalTheme();});
    applyLocalTheme();applyTranslations();setMode("login");
    window.VocabFlowAuth.me().then(result=>{if(result.authenticated)window.location.href="/"}).catch(()=>{});
  });
})();