const quizState = {
  questions: [],
  index: 0,
  correct: 0,
  answered: false,
  startedAt: null,
  type: "mixed",
  attemptId: null,
  secure: false
};

function qShuffle(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

function trQ(key, fallback) {
  return typeof t === "function" ? t(key) : fallback;
}

function qEsc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function secureQuizMode() {
  return location.protocol.startsWith("http")
    && Boolean(window.VocabFlowApi)
    && Boolean(window.__VOCABFLOW_USER__?.id);
}

function createQuizQuestion(word, type) {
  const words = getWords();
  const actual = type === "mixed"
    ? (Math.random() < 0.5 ? "word-definition" : "definition-word")
    : type;

  if (actual === "definition-word") {
    const distractors = qShuffle(words.filter(item => item.id !== word.id))
      .slice(0, 3)
      .map(item => item.word);
    return {
      wordId: word.id,
      type: actual,
      prompt: word.definition,
      correct: word.word,
      options: qShuffle([word.word, ...distractors])
    };
  }

  const distractors = qShuffle(words.filter(item => item.id !== word.id))
    .slice(0, 3)
    .map(item => item.definition);
  return {
    wordId: word.id,
    type: actual,
    prompt: word.word,
    correct: word.definition,
    options: qShuffle([word.definition, ...distractors])
  };
}

function buildQuizQuestions() {
  const words = getWords();
  const count = Math.min(
    Number(document.getElementById("quizCount")?.value || 10),
    words.length
  );
  const difficulty = document.getElementById("quizDifficulty")?.value || "all";
  const type = document.getElementById("quizType")?.value || "mixed";

  let pool = difficulty === "all"
    ? words
    : words.filter(word => word.difficulty === difficulty);
  if (pool.length < 4) pool = words;

  return qShuffle(pool)
    .slice(0, Math.min(count, pool.length))
    .map(word => createQuizQuestion(word, type));
}

function renderQuizQuestion() {
  const question = quizState.questions[quizState.index];
  const total = quizState.questions.length;
  if (!question) return;

  document.getElementById("quizCounter").textContent = `${quizState.index + 1} / ${total}`;
  renderProgressFill(document.getElementById("quizProgress"), total ? (quizState.index / total) * 100 : 0);
  document.getElementById("quizTypeLabel").textContent = question.type === "word-definition"
    ? trQ("qz_wordToDef", "Word to Arabic Meaning")
    : trQ("qz_defToWord", "Arabic Meaning to Word");
  document.getElementById("quizQuestion").textContent = question.prompt;
  document.getElementById("quizOptions").innerHTML = (question.options || [])
    .map((option, index) => `<button class="quiz-option" data-index="${index}">${qEsc(option)}</button>`)
    .join("");
  document.getElementById("quizFeedback").textContent = "";
  document.getElementById("quizFeedback").className = "quiz-feedback";
  setUiHidden(document.getElementById("quizNext"), true);
  quizState.answered = false;
}

function showQuizFeedback(text, isCorrect) {
  const element = document.getElementById("quizFeedback");
  element.textContent = text;
  element.className = `quiz-feedback ${isCorrect ? "correct" : "incorrect"}`;
}

function renderQuizSummary(summary) {
  const total = summary.total ?? quizState.questions.length;
  const correct = summary.correct ?? quizState.correct;
  const seconds = summary.durationSeconds ?? Math.max(
    1,
    Math.round((Date.now() - quizState.startedAt) / 1000)
  );

  setUiHidden(document.getElementById("quizCard"), true);
  setUiHidden(document.getElementById("quizSummary"), false);
  renderProgressFill(document.getElementById("quizProgress"), 100);
  document.getElementById("quizScore").textContent = `${total ? Math.round(correct / total * 100) : 0}%`;
  document.getElementById("quizCorrect").textContent = correct;
  document.getElementById("quizWrong").textContent = total - correct;
  document.getElementById("quizDuration").textContent = seconds >= 60
    ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
    : `${seconds}s`;
}

async function answerQuestion(button) {
  if (quizState.answered) return;
  quizState.answered = true;

  const question = quizState.questions[quizState.index];
  const selectedIndex = Number(button.dataset.index);
  document.querySelectorAll(".quiz-option").forEach(item => {
    item.disabled = true;
  });

  if (quizState.secure) {
    try {
      const result = await VocabFlowApi.request("/api/quiz/answer", {
        method: "POST",
        body: JSON.stringify({
          attemptId: quizState.attemptId,
          questionIndex: quizState.index,
          selectedIndex
        })
      });

      if (result.correct) quizState.correct++;
      button.classList.add(result.correct ? "correct" : "incorrect");
      showQuizFeedback(
        result.correct
          ? trQ("qz_correctFeedback", "Correct.")
          : `${trQ("qz_notQuite", "Not quite. Correct answer: ")} ${result.correctAnswer}`,
        result.correct
      );

      if (result.completed) {
        renderQuizSummary(result.summary);
        return;
      }

      setUiHidden(document.getElementById("quizNext"), false);
    } catch (error) {
      showQuizFeedback(error.message || "Could not submit the answer.", false);
      quizState.answered = false;
      document.querySelectorAll(".quiz-option").forEach(item => {
        item.disabled = false;
      });
    }
    return;
  }

  const selected = question.options[selectedIndex];
  const correct = selected === question.correct;
  document.querySelectorAll(".quiz-option").forEach(item => {
    if (question.options[Number(item.dataset.index)] === question.correct) {
      item.classList.add("correct");
    }
  });

  if (correct) {
    button.classList.add("correct");
    quizState.correct++;
    showQuizFeedback(trQ("qz_correctFeedback", "Correct."), true);
  } else {
    button.classList.add("incorrect");
    showQuizFeedback(
      `${trQ("qz_notQuite", "Not quite. Correct answer: ")} ${question.correct}`,
      false
    );
  }

  setUiHidden(document.getElementById("quizNext"), false);
}

function nextQuestion() {
  quizState.index++;
  if (quizState.index >= quizState.questions.length) {
    renderQuizSummary({
      total: quizState.questions.length,
      correct: quizState.correct
    });
  } else {
    renderQuizQuestion();
  }
}

async function startQuiz() {
  const empty = document.getElementById("quizEmpty");
  const card = document.getElementById("quizCard");
  const summary = document.getElementById("quizSummary");

  quizState.secure = secureQuizMode();
  quizState.attemptId = null;
  quizState.index = 0;
  quizState.correct = 0;
  quizState.startedAt = Date.now();

  if (quizState.secure) {
    try {
      const result = await VocabFlowApi.request("/api/quiz/start", {
        method: "POST",
        body: JSON.stringify({
          count: Number(document.getElementById("quizCount")?.value || 10),
          difficulty: document.getElementById("quizDifficulty")?.value || "all",
          type: document.getElementById("quizType")?.value || "mixed"
        })
      });
      quizState.questions = result.questions || [];
      quizState.attemptId = result.attemptId || null;
    } catch (error) {
      setUiHidden(empty, false);
      setUiHidden(card, true);
      setUiHidden(summary, true);
      empty.querySelector("p")?.replaceChildren(
        document.createTextNode(error.message || "Could not start the quiz.")
      );
      return;
    }
  } else {
    if (getWords().length < 4) {
      setUiHidden(empty, false);
      setUiHidden(card, true);
      setUiHidden(summary, true);
      return;
    }
    quizState.questions = buildQuizQuestions();
  }

  if (!quizState.questions.length) {
    setUiHidden(empty, false);
    setUiHidden(card, true);
    setUiHidden(summary, true);
    return;
  }

  setUiHidden(empty, true);
  setUiHidden(summary, true);
  setUiHidden(card, false);
  renderQuizQuestion();
}

document.addEventListener("vocabflow:pageinit", () => {
  const root = document.querySelector("main.main-content");
  if (window.VocabFlowEvents && !VocabFlowEvents.pageSetup("quiz", root, () => {})) return;

  document.getElementById("quizOptions")?.addEventListener("click", event => {
    const button = event.target.closest(".quiz-option");
    if (button) answerQuestion(button);
  });
  document.getElementById("quizNext")?.addEventListener("click", nextQuestion);
  document.getElementById("startQuiz")?.addEventListener("click", startQuiz);
  document.getElementById("restartQuiz")?.addEventListener("click", startQuiz);

  if (window.VocabFlowEvents) {
    VocabFlowEvents.once("word-quiz", "vocabflow:langchange", () => {
      if (
        quizState.questions.length
        && document.getElementById("quizCard")
        && !document.getElementById("quizCard").hidden
      ) {
        renderQuizQuestion();
      }
    });
  }

  startQuiz();
});
