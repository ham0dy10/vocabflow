(function () {
  "use strict";

  if (!document.querySelector("main.main-content") || window.VocabFlowNavigation) return;

  const loadedScripts = new Set(
    [...document.scripts].map(script => script.src).filter(Boolean)
  );
  const loadedStyles = new Set(
    [...document.querySelectorAll('link[rel~="stylesheet"]')]
      .map(link => link.href).filter(Boolean)
  );
  const scriptLoads = new Map();
  const styleLoads = new Map();
  const pageCache = new Map();
  let currentRenderedUrl = window.location.href;
  let activeRequest = null;

  function isInternalPageLink(anchor, event) {
    if (!anchor || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.target || anchor.hasAttribute("download") || anchor.dataset.noSpa !== undefined) return false;
    const url = new URL(anchor.href, window.location.href);
    if (url.href === window.location.href) return false;
    if (url.origin !== window.location.origin || url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return false;
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/static/")) return false;
    return true;
  }

  function rememberCurrentPage(url = currentRenderedUrl) {
    const main = document.querySelector("main.main-content");
    if (!main) return;
    pageCache.set(url, {
      main,
      title: document.title,
      scrollY: window.scrollY
    });
    while (pageCache.size > 10) pageCache.delete(pageCache.keys().next().value);
  }

  function updateActiveLink(url) {
    const activePath = url.pathname === "/word-context" ? "/words" : url.pathname;
    document.querySelectorAll(".site-nav .nav-link").forEach(link => {
      const linkPath = new URL(link.href, window.location.href).pathname;
      link.classList.toggle("active", linkPath === activePath);
    });
  }

  function loadStyles(doc) {
    const pending = [];
    for (const source of doc.querySelectorAll('head link[rel~="stylesheet"][href]')) {
      const href = new URL(source.getAttribute("href"), window.location.href).href;
      if (loadedStyles.has(href)) continue;
      if (styleLoads.has(href)) {
        pending.push(styleLoads.get(href));
        continue;
      }
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.media = source.media || "all";
      const loaded = new Promise((resolve, reject) => {
        link.onload = resolve;
        link.onerror = () => reject(new Error(`Could not load page style: ${href}`));
      }).then(() => {
        loadedStyles.add(href);
        styleLoads.delete(href);
      }).catch(error => {
        styleLoads.delete(href);
        throw error;
      });
      styleLoads.set(href, loaded);
      pending.push(loaded);
      document.head.appendChild(link);
    }
    return Promise.all(pending);
  }

  async function loadScripts(doc) {
    for (const source of doc.querySelectorAll("script[src]")) {
      const src = new URL(source.getAttribute("src"), window.location.href).href;
      if (loadedScripts.has(src)) continue;
      if (scriptLoads.has(src)) {
        await scriptLoads.get(src);
        continue;
      }
      const loaded = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = () => {
          loadedScripts.add(src);
          scriptLoads.delete(src);
          resolve();
        };
        script.onerror = () => {
          scriptLoads.delete(src);
          reject(new Error(`Could not load page code: ${src}`));
        };
        document.body.appendChild(script);
      });
      scriptLoads.set(src, loaded);
      await loaded;
    }
  }

  function prepareMainLanguage(main) {
    if (!main || typeof window.applyTranslationsTo !== "function") return;
    // Translate the detached page before it is inserted into the live DOM.
    // This prevents the user from seeing the server's default English copy
    // for a frame before Arabic is applied.
    window.applyTranslationsTo(main);
  }

  function translatedTitle(doc, fallbackTitle) {
    const heading = doc.querySelector("main.main-content h1[data-i18n]");
    const text = heading?.textContent?.trim();
    return text ? `${text} · VocabFlow` : (fallbackTitle || "VocabFlow");
  }

  function swapMain(nextMain, title, url, scrollY, initialize) {
    const currentMain = document.querySelector("main.main-content");
    if (!currentMain || !nextMain) return false;
    prepareMainLanguage(nextMain);
    const commit = () => {
      currentMain.replaceWith(nextMain);
      document.title = title;
      updateActiveLink(url);
      if (initialize) document.dispatchEvent(new Event("vocabflow:pageinit"));
      else if (typeof window.applyTranslations === "function") {
        window.applyTranslations();
        window.dispatchEvent(new CustomEvent("vocabflow:langchange", {
          detail: { lang: document.documentElement.lang || "en" }
        }));
      }
      window.scrollTo(0, Math.max(0, Number(scrollY) || 0));
    };
    nextMain.classList.add("vf-page-entering");
    commit();
    requestAnimationFrame(() => nextMain.classList.remove("vf-page-entering"));
    currentRenderedUrl = url.href;
    return true;
  }

  async function navigate(url, { push = true, scrollY = 0 } = {}) {
    const target = new URL(url, window.location.href);
    if (target.origin !== window.location.origin) {
      window.location.assign(target.href);
      return;
    }

    rememberCurrentPage(currentRenderedUrl);
    if (activeRequest) activeRequest.abort();
    const controller = new AbortController();
    activeRequest = controller;
    document.documentElement.classList.add("vf-navigating");
    const currentMain = document.querySelector("main.main-content");
    if (currentMain) currentMain.setAttribute("aria-busy", "true");

    try {
      const cached = pageCache.get(target.href);
      if (cached) {
        if (push) {
          history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, "", window.location.href);
          history.pushState({ scrollY: 0 }, "", target.href);
        }
        swapMain(cached.main, cached.title, target, scrollY, false);
        pageCache.delete(target.href);
        return;
      }

      const response = await fetch(target.href, {
        credentials: "same-origin",
        headers: { "X-VocabFlow-Navigation": "1" },
        signal: controller.signal
      });
      if (!response.ok || response.redirected) {
        window.location.assign(response.url || target.href);
        return;
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const nextMain = doc.querySelector("main.main-content");
      if (!nextMain) {
        window.location.assign(target.href);
        return;
      }

      await loadStyles(doc);
      await loadScripts(doc);
      if (controller.signal.aborted) return;

      if (push) {
        history.replaceState({ ...(history.state || {}), scrollY: window.scrollY }, "", window.location.href);
        history.pushState({ scrollY: 0 }, "", target.href);
      }
      swapMain(nextMain, translatedTitle(doc, doc.title || document.title), target, scrollY, true);
    } catch (error) {
      if (error.name !== "AbortError") window.location.assign(target.href);
    } finally {
      if (activeRequest === controller) {
        activeRequest = null;
        document.documentElement.classList.remove("vf-navigating");
        document.querySelector("main.main-content")?.removeAttribute("aria-busy");
      }
    }
  }

  document.addEventListener("click", event => {
    const anchor = event.target.closest?.("a[href]");
    if (!isInternalPageLink(anchor, event)) return;
    event.preventDefault();
    navigate(anchor.href);
  });

  window.addEventListener("popstate", event => {
    navigate(window.location.href, { push: false, scrollY: event.state?.scrollY || 0 });
  });

  window.addEventListener("vocabflow:datachange", () => pageCache.clear());
  window.VocabFlowNavigation = Object.freeze({ navigate });
})();
