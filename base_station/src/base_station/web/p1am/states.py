"""Operator semantics for the Fill Cart state-machine protocol."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StateDefinition:
    id: int
    label: str
    dangerous: bool = False
    confirmation: str | None = None


STATE_DEFINITIONS = (
    StateDefinition(0, "Valve testing"),
    StateDefinition(1, "Initialize"),
    StateDefinition(2, "Fuel fill"),
    StateDefinition(3, "LOX fill"),
    StateDefinition(4, "Fire", dangerous=True, confirmation="Begin FIRE state transition?"),
    StateDefinition(5, "Purge"),
    StateDefinition(6, "Overload"),
    StateDefinition(7, "Abort", dangerous=True),
)

STATE_NAMES = [state.label for state in STATE_DEFINITIONS]
STATE_BY_ID = {state.id: state for state in STATE_DEFINITIONS}


def state_name(state_id: int) -> str:
    definition = STATE_BY_ID.get(state_id)
    if definition is None:
        raise ValueError(f"Invalid cart state: {state_id}")
    return definition.label
