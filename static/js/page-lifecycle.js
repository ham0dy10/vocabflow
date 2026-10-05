(function () {
  "use strict";

  const onceKeys = new Set();
  const pageBindings = new WeakMap();
  const setupPages = Object.freeze({
    "add-sentence": ["add-sentence"],
    "import-export": ["data"],
    "sentence-import-export": ["data"],
    "sentence-library": ["sentences"],
    "sentence-quiz": ["sentence-quiz"],
    "sentence-review": ["sentence-review"],
    "sentence-writing": ["sentence-writing"],
    practice: ["practice"],
    quiz: ["quiz"],
    review: ["review"],
    "word-context": ["word-context"],
    "words-page": ["words", "add-word"]
  });

  const pathToPageKeys = Object.freeze({
    "/add-sentence": ["add-sentence"],
    "/data": ["import-export", "sentence-import-export"],
    "/sentences": ["sentence-library"],
    "/sentence-quiz": ["sentence-quiz"],
    "/sentence-review": ["sentence-review"],
    "/sentence-writing": ["sentence-writing"],
    "/practice": ["practice"],
    "/quiz": ["quiz"],
    "/review": ["review"],
    "/word-context": ["word-context"],
    "/words": ["words-page"],
    "/add-word": ["words-page"],
    "/": ["home"]
  });

  function isPageKeyActive(key, root) {
    const pages = setupPages[key];
    if (!pages) return true;
    if (root?.dataset.vfPage) return pages.includes(root.dataset.vfPage);
    const activeKeys = pathToPageKeys[window.location.pathname] || [];
    return activeKeys.includes(key);
  }

  window.VocabFlowEvents = Object.freeze({
    once(key, eventName, handler) {
      const token = `${key}:${eventName}`;
      if (onceKeys.has(token)) return;
      onceKeys.add(token);
      window.addEventListener(eventName, handler);
    },
    pageSetup(key, root, handler) {
      if (!root || typeof handler !== "function") return false;
      if (!isPageKeyActive(key, root)) return false;
      let keys = pageBindings.get(root);
      if (!keys) {
        keys = new Set();
        pageBindings.set(root, keys);
      }
      if (keys.has(key)) return false;
      keys.add(key);
      handler();
      return true;
    }
  });
})();

// Initialize page scripts on normal Flask page loads.
if (typeof document !== "undefined") {
  const dispatchPageInit = () => document.dispatchEvent(new Event("vocabflow:pageinit"));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", dispatchPageInit, { once: true });
  else setTimeout(dispatchPageInit, 0);
}
