
function getDateKey(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function progressLocale(){return document.documentElement.lang==="ar"?"ar-IQ":"en-US"}
function progressText(key,fallback){return typeof t==="function"?t(key):fallback}
function progressNumber(value){return new Intl.NumberFormat(progressLocale()).format(value)}

function getActivityMap() {
  const map = {};
  getReviews().forEach(review => {
    const key = getDateKey(review.reviewedAt);
    if (!key) return;
    if (!map[key]) map[key] = { reviews:0, correct:0 };
    map[key].reviews++;
    if (review.rating !== "again") map[key].correct++;
  });
  return map;
}

function calculateDetailedProgress() {
  const words = getWords();
  const reviews = getReviews();
  const total = words.length;
  const newWords = words.filter(w => w.status === "new").length;
  const learning = words.filter(w => w.status === "learning").length;
  const reviewing = words.filter(w => w.status === "reviewing").length;
  const mastered = words.filter(w => w.status === "mastered").length;
  const correct = reviews.filter(r => r.rating !== "again").length;
  const accuracy = reviews.length ? Math.round((correct / reviews.length) * 100) : 0;

  return { total, newWords, learning, reviewing, mastered, reviews:reviews.length, accuracy };
}

function getStreaks() {
  const activity = getActivityMap();
  const dates = Object.keys(activity).sort();
  if (!dates.length) return { current:0, longest:0 };

  let longest = 1, running = 1;
  for (let i=1; i<dates.length; i++) {
    const prev = new Date(`${dates[i-1]}T00:00:00`);
    const curr = new Date(`${dates[i]}T00:00:00`);
    const diff = Math.round((curr-prev)/86400000);
    if (diff === 1) { running++; longest = Math.max(longest, running); }
    else running = 1;
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const latest = new Date(`${dates[dates.length-1]}T00:00:00`);
  const daysSinceLatest = Math.round((today-latest)/86400000);
  let current = 0;

  if (daysSinceLatest <= 1) {
    const cursor = new Date(latest);
    while (activity[getDateKey(cursor)]) {
      current++;
      cursor.setDate(cursor.getDate()-1);
    }
  }
  return { current, longest };
}

function lastSevenDays() {
  const activity = getActivityMap();
  const result = [];
  const today = new Date();
  today.setHours(0,0,0,0);

  for (let i=6; i>=0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate()-i);
    const key = getDateKey(d);
    result.push({
      key,
      label: d.toLocaleDateString(progressLocale(), { weekday:"short" }),
      reviews: activity[key]?.reviews || 0,
      correct: activity[key]?.correct || 0
    });
  }
  return result;
}


function renderStatusFill(fill, percentage) {
  const value = Math.max(0, Math.min(100, Number(percentage) || 0));
  fill.innerHTML = `<svg viewBox="0 0 100 6" preserveAspectRatio="none" role="img" aria-label="${progressNumber(Math.round(value))}%"><rect x="0" y="0" width="${value}" height="6" rx="3"></rect></svg>`;
}

function renderProgressPage() {
  if (!document.getElementById("pTotal")) return;
  const stats = calculateDetailedProgress();
  const streaks = getStreaks();
  const activity = lastSevenDays();

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  set("pTotal", progressNumber(stats.total));
  set("pNew", progressNumber(stats.newWords));
  set("pLearning", progressNumber(stats.learning));
  set("pReviewing", progressNumber(stats.reviewing));
  set("pMastered", progressNumber(stats.mastered));
  set("pAccuracy", `${progressNumber(stats.accuracy)}%`);
  set("pReviews", progressNumber(stats.reviews));
  set("pCurrentStreak", progressNumber(streaks.current));
  set("pStreakBig", progressNumber(streaks.current));
  set("pLongestStreak", `${progressNumber(streaks.longest)} ${progressText("pg_dayUnit","days")}`);

  const total = Math.max(stats.total, 1);
  ["new","learning","reviewing","mastered"].forEach(status => {
    const count = status === "new" ? stats.newWords :
      status === "learning" ? stats.learning :
      status === "reviewing" ? stats.reviewing : stats.mastered;
    const fill = document.getElementById(`fill-${status}`);
    if (fill) renderStatusFill(fill, (count / total) * 100);
    set(`count-${status}`, progressNumber(count));
  });

  const chart = document.getElementById("weeklyChart");
  if (!chart) return;
  const max = Math.max(...activity.map(d => d.reviews), 1);
  chart.innerHTML = activity.map(d => {
    const height = Math.max(2, (d.reviews / max) * 150);
    return `
      <div class="bar-wrap">
        <span class="bar-value">${progressNumber(d.reviews)}</span>
        <div class="bar" role="img" aria-label="${progressNumber(d.reviews)} ${progressText("pg_reviewsUnit","reviews")}" title="${progressNumber(d.reviews)} ${progressText("pg_reviewsUnit","reviews")}">
          <svg viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true">
            <rect x="0" y="${150 - height}" width="100" height="${height}" rx="1.5"></rect>
          </svg>
        </div>
        <span class="bar-label">${d.label}</span>
      </div>`;
  }).join("");

  const list = document.getElementById("activityList");
  if (list) list.innerHTML = activity.slice().reverse().map(d => `
    <div class="activity-row">
      <span>${new Date(`${d.key}T00:00:00`).toLocaleDateString(progressLocale(),{month:"short",day:"numeric"})}</span>
      <strong>${progressNumber(d.reviews)} ${progressText("pg_reviewsUnit","reviews")} · ${progressNumber(d.correct)} ${progressText("common_correct","correct")}</strong>
    </div>
  `).join("");
}

document.addEventListener("vocabflow:pageinit", () => {
  renderProgressPage();
  if(window.VocabFlowEvents)VocabFlowEvents.once("progress-page","vocabflow:langchange",renderProgressPage);
});
