import sqlite3
import numpy as np
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "db" / "meetings.db"


def get_connection(db_path: str | Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def create_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS voice_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS meetings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_name TEXT NOT NULL,
            mp3_path TEXT NOT NULL,
            transcript_path TEXT,
            language TEXT NOT NULL DEFAULT 'es',
            meeting_date TEXT NOT NULL,
            processed_at TEXT,
            duration_seconds INTEGER,
            status TEXT NOT NULL DEFAULT 'pending',
            error_message TEXT
        );

        CREATE TABLE IF NOT EXISTS voice_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL REFERENCES voice_profiles(id) ON DELETE CASCADE,
            embedding BLOB NOT NULL,
            source_meeting_id INTEGER REFERENCES meetings(id),
            quality_score REAL,
            clip_duration_seconds REAL,
            segment_count INTEGER,
            clean_segment_count INTEGER,
            has_overlap INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS meeting_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
            profile_id INTEGER REFERENCES voice_profiles(id),
            speaker_label TEXT NOT NULL,
            is_identified INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS unknown_speakers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
            speaker_label TEXT NOT NULL,
            embedding BLOB NOT NULL,
            clip_path TEXT,
            quality_score REAL,
            clip_duration_seconds REAL,
            segment_count INTEGER,
            clean_segment_count INTEGER,
            has_overlap INTEGER NOT NULL DEFAULT 0,
            assigned_profile_id INTEGER REFERENCES voice_profiles(id),
            status TEXT NOT NULL DEFAULT 'pending'
        );

        CREATE INDEX IF NOT EXISTS idx_voice_embeddings_profile ON voice_embeddings(profile_id);
        CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants(meeting_id);
        CREATE INDEX IF NOT EXISTS idx_unknown_speakers_meeting ON unknown_speakers(meeting_id);
        CREATE INDEX IF NOT EXISTS idx_unknown_speakers_status ON unknown_speakers(status);
    """)

    migrations = [
        "ALTER TABLE meeting_participants ADD COLUMN clip_path TEXT",
        "ALTER TABLE voice_embeddings ADD COLUMN quality_score REAL",
        "ALTER TABLE voice_embeddings ADD COLUMN clip_duration_seconds REAL",
        "ALTER TABLE voice_embeddings ADD COLUMN segment_count INTEGER",
        "ALTER TABLE voice_embeddings ADD COLUMN clean_segment_count INTEGER",
        "ALTER TABLE voice_embeddings ADD COLUMN has_overlap INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE unknown_speakers ADD COLUMN quality_score REAL",
        "ALTER TABLE unknown_speakers ADD COLUMN clip_duration_seconds REAL",
        "ALTER TABLE unknown_speakers ADD COLUMN segment_count INTEGER",
        "ALTER TABLE unknown_speakers ADD COLUMN clean_segment_count INTEGER",
        "ALTER TABLE unknown_speakers ADD COLUMN has_overlap INTEGER NOT NULL DEFAULT 0",
    ]
    for statement in migrations:
        try:
            conn.execute(statement)
        except sqlite3.OperationalError:
            pass
    conn.commit()


def insert_meeting(conn: sqlite3.Connection, folder_name: str, mp3_path: str,
                   language: str, meeting_date: str) -> int:
    cursor = conn.execute(
        "INSERT INTO meetings (folder_name, mp3_path, language, meeting_date, status) VALUES (?, ?, ?, ?, 'processing')",
        (folder_name, mp3_path, language, meeting_date)
    )
    conn.commit()
    return cursor.lastrowid


def update_meeting_completed(conn: sqlite3.Connection, meeting_id: int,
                             transcript_path: str, duration_seconds: int) -> None:
    conn.execute(
        "UPDATE meetings SET status='completed', transcript_path=?, duration_seconds=?, processed_at=datetime('now') WHERE id=?",
        (transcript_path, duration_seconds, meeting_id)
    )
    conn.commit()


def update_meeting_error(conn: sqlite3.Connection, meeting_id: int, error_message: str | None = None) -> None:
    conn.execute("UPDATE meetings SET status='error', error_message=? WHERE id=?", (error_message, meeting_id))
    conn.commit()


def get_profile_embeddings(conn: sqlite3.Connection) -> dict[int, tuple[str, list[np.ndarray], list[float]]]:
    """Returns {profile_id: (name, [embeddings], [quality_scores])}"""
    rows = conn.execute("""
        SELECT ve.profile_id, vp.name, ve.embedding, COALESCE(ve.quality_score, 0.5) as quality_score
        FROM voice_embeddings ve
        JOIN voice_profiles vp ON vp.id = ve.profile_id
    """).fetchall()

    profiles: dict[int, tuple[str, list[np.ndarray], list[float]]] = {}
    for row in rows:
        pid = row["profile_id"]
        name = row["name"]
        emb = np.frombuffer(row["embedding"], dtype=np.float32)
        quality = float(row["quality_score"])
        if pid not in profiles:
            profiles[pid] = (name, [], [])
        profiles[pid][1].append(emb)
        profiles[pid][2].append(quality)
    return profiles


def insert_unknown_speaker(conn: sqlite3.Connection, meeting_id: int,
                           speaker_label: str, embedding: np.ndarray,
                           clip_path: str | None,
                           quality_score: float | None = None,
                           clip_duration_seconds: float | None = None,
                           segment_count: int | None = None,
                           clean_segment_count: int | None = None,
                           has_overlap: bool = False) -> int:
    cursor = conn.execute(
        """
        INSERT INTO unknown_speakers (
            meeting_id, speaker_label, embedding, clip_path,
            quality_score, clip_duration_seconds, segment_count, clean_segment_count, has_overlap
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            meeting_id,
            speaker_label,
            embedding.tobytes(),
            clip_path,
            quality_score,
            clip_duration_seconds,
            segment_count,
            clean_segment_count,
            int(has_overlap),
        )
    )
    conn.commit()
    return cursor.lastrowid


def insert_participant(conn: sqlite3.Connection, meeting_id: int,
                       speaker_label: str, profile_id: int | None,
                       is_identified: bool,
                       clip_path: str | None = None) -> None:
    conn.execute(
        "INSERT INTO meeting_participants (meeting_id, speaker_label, profile_id, is_identified, clip_path) VALUES (?, ?, ?, ?, ?)",
        (meeting_id, speaker_label, profile_id, int(is_identified), clip_path)
    )
    conn.commit()


def insert_voice_embedding(conn: sqlite3.Connection, profile_id: int,
                           embedding: np.ndarray, meeting_id: int | None,
                           quality_score: float | None = None,
                           clip_duration_seconds: float | None = None,
                           segment_count: int | None = None,
                           clean_segment_count: int | None = None,
                           has_overlap: bool = False) -> None:
    conn.execute(
        """
        INSERT INTO voice_embeddings (
            profile_id, embedding, source_meeting_id,
            quality_score, clip_duration_seconds, segment_count, clean_segment_count, has_overlap
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            profile_id,
            embedding.tobytes(),
            meeting_id,
            quality_score,
            clip_duration_seconds,
            segment_count,
            clean_segment_count,
            int(has_overlap),
        )
    )
    conn.commit()


def get_all_voice_profiles(conn: sqlite3.Connection) -> list[dict]:
    """Returns all voice profiles (even those without embeddings)."""
    rows = conn.execute("SELECT id, name FROM voice_profiles ORDER BY name").fetchall()
    return [{"profile_id": row["id"], "name": row["name"]} for row in rows]


def get_profiles_needing_backfill(conn: sqlite3.Connection) -> list[dict]:
    """
    Returns (profile_id, name, clip_path, meeting_id) for all profiles
    that have assigned audio clips in unknown_speakers.
    Used to detect and backfill profiles with missing or zero embeddings.
    """
    rows = conn.execute("""
        SELECT
            us.assigned_profile_id AS profile_id,
            vp.name,
            us.clip_path,
            us.meeting_id
        FROM unknown_speakers us
        JOIN voice_profiles vp ON vp.id = us.assigned_profile_id
        WHERE us.status = 'assigned'
          AND us.clip_path IS NOT NULL
        ORDER BY us.id
    """).fetchall()
    return [dict(row) for row in rows]
