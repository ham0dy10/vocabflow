from datetime import datetime, timezone

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(32), nullable=False, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    email: Mapped[str] = mapped_column(String(160), nullable=True, unique=True, index=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False, default=lambda: datetime.now(timezone.utc).isoformat())
    security_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class Word(Base):
    __tablename__ = "words"
    __table_args__ = (
        CheckConstraint("difficulty IN ('easy','medium','hard')", name="ck_words_difficulty"),
        CheckConstraint("status IN ('new','learning','reviewing','mastered')", name="ck_words_status"),
        CheckConstraint("repetitions >= 0", name="ck_words_repetitions_nonnegative"),
        CheckConstraint("interval >= 0", name="ck_words_interval_nonnegative"),
        CheckConstraint("ease_factor >= 1.0", name="ck_words_ease_factor_min"),
        Index("ix_words_user_category", "user_id", "category"),
        Index("ix_words_user_status_next_review", "user_id", "status", "next_review"),
    )

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    word: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    definition: Mapped[str] = mapped_column(Text, nullable=False, default="")
    part_of_speech: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    example_sentence: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(120), nullable=False, default="General", index=True)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="medium", index=True)
    favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new", index=True)
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    interval: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ease_factor: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
    last_review: Mapped[str | None] = mapped_column(String(40), nullable=True)
    next_review: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


class Sentence(Base):
    __tablename__ = "sentences"
    __table_args__ = (
        CheckConstraint("difficulty IN ('easy','medium','hard')", name="ck_sentences_difficulty"),
        CheckConstraint("status IN ('new','learning','reviewing','mastered')", name="ck_sentences_status"),
        CheckConstraint("repetitions >= 0", name="ck_sentences_repetitions_nonnegative"),
        CheckConstraint("interval >= 0", name="ck_sentences_interval_nonnegative"),
        CheckConstraint("ease_factor >= 1.0", name="ck_sentences_ease_factor_min"),
        Index("ix_sentences_user_category", "user_id", "category"),
        Index("ix_sentences_user_status_next_review", "user_id", "status", "next_review"),
    )

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    sentence: Mapped[str] = mapped_column(Text, nullable=False)
    arabic_meaning: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(120), nullable=False, default="General", index=True)
    difficulty: Mapped[str] = mapped_column(String(20), nullable=False, default="medium", index=True)
    favorite: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="new", index=True)
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    interval: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ease_factor: Mapped[float] = mapped_column(Float, nullable=False, default=2.5)
    last_review: Mapped[str | None] = mapped_column(String(40), nullable=True)
    next_review: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    created_at: Mapped[str] = mapped_column(String(40), nullable=False)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        CheckConstraint("rating IN ('again','hard','good','easy')", name="ck_reviews_rating"),
        CheckConstraint("interval >= 0", name="ck_reviews_interval_nonnegative"),
        Index("ix_reviews_user_reviewed_at", "user_id", "reviewed_at"),
        Index("ix_reviews_user_word_reviewed_at", "user_id", "word_id", "reviewed_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    word_id: Mapped[str | None] = mapped_column(ForeignKey("words.id", ondelete="CASCADE"), nullable=True, index=True)
    rating: Mapped[str] = mapped_column(String(20), nullable=False)
    reviewed_at: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    interval: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SentenceReview(Base):
    __tablename__ = "sentence_reviews"
    __table_args__ = (
        CheckConstraint("rating IN ('again','hard','good','easy')", name="ck_sentence_reviews_rating"),
        CheckConstraint("interval >= 0", name="ck_sentence_reviews_interval_nonnegative"),
        Index("ix_sentence_reviews_user_reviewed_at", "user_id", "reviewed_at"),
        Index("ix_sentence_reviews_user_sentence_reviewed_at", "user_id", "sentence_id", "reviewed_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    sentence_id: Mapped[str | None] = mapped_column(ForeignKey("sentences.id", ondelete="CASCADE"), nullable=True, index=True)
    rating: Mapped[str] = mapped_column(String(20), nullable=False)
    reviewed_at: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    interval: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class QuizSession(Base):
    __tablename__ = "quiz_history"
    __table_args__ = (
        CheckConstraint("total_questions >= 0", name="ck_quiz_history_total_nonnegative"),
        CheckConstraint("correct >= 0 AND correct <= total_questions", name="ck_quiz_history_correct_range"),
        CheckConstraint("duration_seconds >= 0", name="ck_quiz_history_duration_nonnegative"),
        Index("ix_quiz_history_user_date", "user_id", "date"),
    )

    session_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    date: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SentenceQuizSession(Base):
    __tablename__ = "sentence_quiz_history"
    __table_args__ = (
        CheckConstraint("total_questions >= 0", name="ck_sentence_quiz_total_nonnegative"),
        CheckConstraint("correct >= 0 AND correct <= total_questions", name="ck_sentence_quiz_correct_range"),
        Index("ix_sentence_quiz_history_user_date", "user_id", "date"),
    )

    session_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    date: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    total_questions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class PracticeSession(Base):
    __tablename__ = "practice_history"
    __table_args__ = (
        CheckConstraint("total_tasks >= 0", name="ck_practice_total_nonnegative"),
        CheckConstraint("correct >= 0 AND correct <= total_tasks", name="ck_practice_correct_range"),
        CheckConstraint("words >= 0", name="ck_practice_words_nonnegative"),
        CheckConstraint("sentences >= 0", name="ck_practice_sentences_nonnegative"),
        Index("ix_practice_history_user_date", "user_id", "date"),
    )

    session_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    date: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    total_tasks: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    words: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sentences: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class LearningAttempt(Base):
    """Server-owned state for an active learning attempt."""

    __tablename__ = "learning_attempts"
    __table_args__ = (
        CheckConstraint("kind IN ('quiz','sentence-quiz','practice')", name="ck_learning_attempts_kind"),
        CheckConstraint("current_index >= 0", name="ck_learning_attempts_index_nonnegative"),
        CheckConstraint("correct >= 0", name="ck_learning_attempts_correct_nonnegative"),
        CheckConstraint("total_items >= 0", name="ck_learning_attempts_total_nonnegative"),
        CheckConstraint("words >= 0", name="ck_learning_attempts_words_nonnegative"),
        CheckConstraint("sentences >= 0", name="ck_learning_attempts_sentences_nonnegative"),
        Index("ix_learning_attempts_user_kind_completed", "user_id", "kind", "completed"),
        Index("ix_learning_attempts_user_started", "user_id", "started_at"),
    )

    attempt_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    questions_json: Mapped[str] = mapped_column(Text, nullable=False)
    current_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    correct: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    words: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sentences: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    started_at: Mapped[str] = mapped_column(String(40), nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)


class Settings(Base):
    __tablename__ = "settings"
    __table_args__ = (
        CheckConstraint("theme IN ('light','dark')", name="ck_settings_theme"),
        CheckConstraint("daily_new_words >= 0", name="ck_settings_daily_new_words_nonnegative"),
        CheckConstraint("language IN ('en','ar')", name="ck_settings_language"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True, unique=True, index=True)
    theme: Mapped[str] = mapped_column(String(20), nullable=False, default="light")
    daily_new_words: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="en")
