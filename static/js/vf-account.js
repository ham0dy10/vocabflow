(function(){
  "use strict";
  async function init(){
    const result=await window.VocabFlowAuth.me();
    if(!result.authenticated)return;
    fill(result.user);
    updateStats();
    document.getElementById("profileForm")?.addEventListener("submit",save);
    document.getElementById("passwordForm")?.addEventListener("submit",changePassword);
    document.getElementById("accountLang")?.addEventListener("click",toggleLang);
    document.getElementById("accountTheme")?.addEventListener("click",toggleTheme);
    document.getElementById("accountLogout")?.addEventListener("click",()=>window.VocabFlowAuth.logout());
    document.getElementById("accountEmail")?.addEventListener("input", updateEmailReauthField);
    setupDeleteDialog();
    window.addEventListener("vocabflow:langchange",refreshPreferenceLabels);
    refreshPreferenceLabels();
  }
  function fill(user){
    const name=user.fullName||user.username||"VocabFlow user";
    document.getElementById("accountName").textContent=name;
    document.getElementById("accountUsername").textContent=`@${user.username||"user"}`;
    document.getElementById("accountAvatar").textContent=(name[0]||"V").toUpperCase();
    document.getElementById("accountFullName").value=user.fullName||"";
    document.getElementById("accountEmail").value=user.email||"";
    document.getElementById("accountUsernameField").value=user.username||"";
    const passwordField=document.getElementById("accountCurrentPassword");
    if(passwordField)passwordField.value="";
    updateEmailReauthField();
  }
  function updateStats(){
    const words=typeof getWords==="function"?getWords().length:0;
    const sentences=typeof getSentences==="function"?getSentences().length:0;
    const w=document.getElementById("accountWordsCount");
    const se=document.getElementById("accountSentencesCount");
    if(w)w.textContent=words;
    if(se)se.textContent=sentences;
  }
  async function save(e){
    e.preventDefault();
    const status=document.getElementById("profileStatus");
    if(status)status.textContent="";
    try{
      const newEmail=document.getElementById("accountEmail").value.trim();
      const oldEmail=String(window.__VOCABFLOW_USER__?.email||"").trim();
      const body={fullName:document.getElementById("accountFullName").value.trim(),email:newEmail};
      if(newEmail.toLowerCase()!==oldEmail.toLowerCase()){
        body.currentPassword=document.getElementById("accountCurrentPassword")?.value||"";
      }
      const result=await window.VocabFlowAuth.request("/api/account",{method:"PUT",body:JSON.stringify(body)});
      window.__VOCABFLOW_USER__=result.user;
      fill(result.user);
      if(status)status.textContent=document.documentElement.lang==="ar"?"تم حفظ التغييرات":"Changes saved";
    }catch(error){
      if(status)status.textContent=error?.message||(document.documentElement.lang==="ar"?"تعذّر حفظ التغييرات.":"Could not save changes.");
    }
  }

  async function changePassword(e){
    e.preventDefault();
    const status=document.getElementById("passwordStatus");
    if(status)status.textContent="";
    const current=document.getElementById("currentPassword")?.value||"";
    const next=document.getElementById("newPassword")?.value||"";
    const confirm=document.getElementById("confirmNewPassword")?.value||"";
    if(next!==confirm){
      if(status)status.textContent=document.documentElement.lang==="ar"?"كلمتا المرور غير متطابقتين.":"New passwords do not match";
      return;
    }
    const button=document.querySelector("#passwordForm button[type=submit]");
    try{
      if(button)button.disabled=true;
      const result=await window.VocabFlowAuth.request("/api/account/password",{method:"POST",body:JSON.stringify({currentPassword:current,newPassword:next,confirmPassword:confirm})});
      if(result.csrfToken)window.VocabFlowApi?.setCsrfToken(result.csrfToken);
      document.getElementById("passwordForm")?.reset();
      if(status)status.textContent=document.documentElement.lang==="ar"?"تم تحديث كلمة المرور.":"Password updated";
    }catch(error){
      if(status)status.textContent=error?.message||(document.documentElement.lang==="ar"?"تعذّر تحديث كلمة المرور.":"Could not update the password.");
    }finally{
      if(button)button.disabled=false;
    }
  }

  function updateEmailReauthField(){
    const wrap=document.getElementById("accountCurrentPasswordWrap");
    const email=document.getElementById("accountEmail");
    if(!wrap||!email)return;
    const current=String(window.__VOCABFLOW_USER__?.email||"").trim().toLowerCase();
    const changed=String(email.value||"").trim().toLowerCase()!==current;
    wrap.hidden=!changed;
    const field=document.getElementById("accountCurrentPassword");
    if(field)field.required=changed;
  }

  function toggleLang(){
    const current=getSettings();
    const next=current.language==="ar"?"en":"ar";
    if(typeof setLanguage==="function")setLanguage(next);
    else{saveSettings({language:next});applyTranslations();}
    refreshPreferenceLabels();
  }
  function toggleTheme(){
    const current=getSettings();
    const next=current.theme==="dark"?"light":"dark";
    saveSettings({theme:next});
    document.documentElement.dataset.theme=next;
    if(typeof applyThemeLabel==="function")applyThemeLabel(next);
    refreshPreferenceLabels();
  }
  function refreshPreferenceLabels(){
    const settings=getSettings();
    const lang=document.getElementById("accountLang");
    const theme=document.getElementById("accountTheme");
    if(lang)lang.textContent=settings.language==="ar"?"English":"العربية";
    if(theme)theme.textContent=typeof t==="function"?t(settings.theme==="dark"?"lightMode":"darkMode"):(settings.theme==="dark"?"Light mode":"Dark mode");
  }
  function setupDeleteDialog(){
    const trigger=document.getElementById("deleteAccountButton");
    const dialog=document.getElementById("deleteAccountDialog");
    const cancel=document.getElementById("deleteAccountCancel");
    const confirmButton=document.getElementById("deleteAccountConfirm");
    if(!trigger||!dialog||!cancel||!confirmButton||trigger.dataset.bound)return;
    trigger.dataset.bound="1";
    trigger.addEventListener("click",()=>{
      if(typeof dialog.showModal==="function") dialog.showModal();
      else dialog.setAttribute("open","");
    });
    cancel.addEventListener("click",()=>dialog.close());
    dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close()});
    confirmButton.addEventListener("click",deleteAccount);
  }
  async function deleteAccount(){
    const button=document.getElementById("deleteAccountConfirm");
    const password=document.getElementById("deleteAccountPassword")?.value||"";
    if(!password){
      alert(document.documentElement.lang==="ar"?"أدخل كلمة المرور الحالية.":"Enter your current password.");
      return;
    }
    try{
      if(button)button.disabled=true;
      await window.VocabFlowAuth.request("/api/account",{method:"DELETE",body:JSON.stringify({currentPassword:password})});
      if(typeof clearCurrentUserStorage==="function")clearCurrentUserStorage();
      const passwordField=document.getElementById("deleteAccountPassword");
      if(passwordField)passwordField.value="";
      window.__VOCABFLOW_USER__=null;
      window.VocabFlowApi?.invalidateCsrfToken();
      window.location.href="/login";
    }catch(error){
      if(button)button.disabled=false;
      const dialog=document.getElementById("deleteAccountDialog");
      if(dialog)dialog.close();
      alert(error?.message||(document.documentElement.lang==="ar"?"تعذّر حذف الحساب.":"Could not delete the account."));
    }
  }
  document.addEventListener("vocabflow:pageinit",init);
})();
