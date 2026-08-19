"""Atomic JSON persistence for the operator-authored DAQ graph."""

from __future__ import annotations

import json
from pathlib import Path
from tempfile import NamedTemporaryFile


EMPTY_GRAPH = {
    "nodes": [],
    "links": [],
    "metadata": {
        "name": "Liquid DAQ",
        "scanRate": 1000,
        "streamResolutionIndex": 0,
        "streamSettlingUs": 0,
        "mux80Enabled": False,
        "schemaVersion": 5,
    },
}


class DaqConfigRepository:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict:
        if not self.path.exists():
            return json.loads(json.dumps(EMPTY_GRAPH))
        return json.loads(self.path.read_text(encoding="utf-8"))

    def save(self, graph: dict) -> None:
        payload = json.dumps(graph, indent=2, sort_keys=True) + "\n"
        with NamedTemporaryFile(
            "w", encoding="utf-8", dir=self.path.parent, delete=False
        ) as temporary:
            temporary.write(payload)
            temporary.flush()
            temporary_path = Path(temporary.name)
        temporary_path.replace(self.path)
