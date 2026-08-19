"""Typed-link checks shared by persisted DAQ graph validation."""

from __future__ import annotations

REFERENCE_TYPES = {"channel-ref", "channel-pair-ref"}


def validate_link_types(graph: dict) -> list[dict[str, str]]:
    nodes = {
        node.get("id"): node
        for node in graph.get("nodes", [])
        if isinstance(node, dict) and isinstance(node.get("id"), str)
    }
    issues: list[dict[str, str]] = []
    for link in graph.get("links", []):
        if not isinstance(link, dict):
            continue
        source_node = nodes.get(link.get("fromNode"))
        target_node = nodes.get(link.get("toNode"))
        source = _pin(source_node, link.get("fromPin"))
        target = _pin(target_node, link.get("toPin"))
        if source is None or target is None or target_node is None:
            continue
        if source.get("direction") != "output" or target.get("direction") != "input":
            issues.append(_issue(target_node["id"], "Connections must run from output to input"))
            continue
        source_type = str(source.get("type", "*"))
        expected = target.get("expectedType", target.get("type", "*"))
        accepted = {str(value) for value in expected} if isinstance(expected, list) else {str(expected)}
        if source_type in REFERENCE_TYPES and source_type not in accepted:
            issues.append(_issue(target_node["id"], f"{target.get('label', 'Input')} cannot accept {source_type}"))
            continue
        if source_type in {"*", "infer"} or accepted & {"*", "infer"} or source_type in accepted:
            continue
        issues.append(_issue(target_node["id"], f"{target.get('label', 'Input')} cannot accept {source_type}"))
    return issues


def _pin(node: dict | None, pin_id: object) -> dict | None:
    if node is None:
        return None
    return next(
        (pin for pin in node.get("pins", []) if isinstance(pin, dict) and pin.get("id") == pin_id),
        None,
    )


def _issue(subject: str, message: str) -> dict[str, str]:
    return {"severity": "error", "subject": subject, "message": message}
