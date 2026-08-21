"""Atomic persistence for the current DAQ configuration document."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import RLock
from typing import Callable

from base_station.web.daq_config.schema import normalize_config


class DaqConfigRepository:
    """Own one current-schema document and expose section-scoped writes."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()

    def load(self) -> dict:
        with self._lock:
            return normalize_config(self._read())

    def save(self, document: dict) -> dict:
        """Replace the complete document. Intended for tests/bootstrap only."""
        with self._lock:
            canonical = normalize_config(document)
            self._write(canonical)
            return canonical

    def save_graph(self, graph: dict) -> dict:
        return self._update(lambda document: document.__setitem__("graph", graph))["graph"]

    def save_labjack_settings(self, settings: dict) -> dict:
        def mutate(document: dict) -> None:
            document["sources"]["labjack"] = settings

        return self._update(mutate)["sources"]["labjack"]

    def save_dashboard_layout(self, layout: dict) -> dict:
        def mutate(document: dict) -> None:
            document["dashboard"]["layout"] = layout

        return self._update(mutate)["dashboard"]["layout"]

    def _update(self, mutate: Callable[[dict], None]) -> dict:
        with self._lock:
            document = normalize_config(self._read())
            mutate(document)
            canonical = normalize_config(document)
            self._write(canonical)
            return canonical

    def _read(self) -> object:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, document: dict) -> None:
        payload = json.dumps(document, indent=2, sort_keys=True) + "\n"
        with NamedTemporaryFile(
            "w", encoding="utf-8", dir=self.path.parent, delete=False
        ) as temporary:
            temporary.write(payload)
            temporary.flush()
            temporary_path = Path(temporary.name)
        temporary_path.replace(self.path)
