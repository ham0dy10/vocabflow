/*
 * VocabFlow review scheduling is server-authoritative.
 * The browser sends only the user's rating.
 * Schedule, interval, repetitions, ease factor, and next review are calculated by Flask.
 */
const RATING = Object.freeze({
  AGAIN: "again",
  HARD: "hard",
  GOOD: "good",
  EASY: "easy"
});
