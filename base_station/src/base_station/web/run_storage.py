"""SQLite connection and schema ownership for acquisition runs."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path


SCHEMA_VERSION = 2


class RunStorage:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        # StreamingResponse may resume its iterator on a different worker thread.
        connection = sqlite3.connect(self.path, timeout=15, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            version = int(connection.execute("PRAGMA user_version").fetchone()[0])
            if version != SCHEMA_VERSION:
                connection.executescript(
                    """
                    DROP TABLE IF EXISTS sample_chunks;
                    DROP TABLE IF EXISTS run_signals;
                    DROP TABLE IF EXISTS samples;
                    DROP TABLE IF EXISTS runs;
                    """
                )
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    id INTEGER PRIMARY KEY,
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    source_id TEXT NOT NULL,
                    scan_rate INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    sample_count INTEGER NOT NULL DEFAULT 0,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS run_signals (
                    run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                    signal_id TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    label TEXT NOT NULL,
                    unit TEXT NOT NULL,
                    PRIMARY KEY (run_id, signal_id),
                    UNIQUE (run_id, position)
                ) WITHOUT ROWID;
                CREATE TABLE IF NOT EXISTS sample_chunks (
                    run_id INTEGER NOT NULL,
                    signal_id TEXT NOT NULL,
                    start_index INTEGER NOT NULL,
                    sample_count INTEGER NOT NULL,
                    valid_count INTEGER NOT NULL,
                    minimum REAL,
                    maximum REAL,
                    total REAL NOT NULL,
                    values_blob BLOB NOT NULL,
                    PRIMARY KEY (run_id, signal_id, start_index),
                    FOREIGN KEY (run_id, signal_id)
                        REFERENCES run_signals(run_id, signal_id) ON DELETE CASCADE
                ) WITHOUT ROWID;
                CREATE INDEX IF NOT EXISTS sample_chunks_window
                    ON sample_chunks(run_id, signal_id, start_index);
                """
            )
            connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            connection.execute(
                """UPDATE runs SET status = 'interrupted', ended_at = ?
                   WHERE status = 'recording'""",
                (datetime.now().astimezone().isoformat(timespec="seconds"),),
            )
