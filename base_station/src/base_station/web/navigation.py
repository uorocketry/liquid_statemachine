"""Canonical metadata for top-level operator navigation."""

from __future__ import annotations

from dataclasses import dataclass


PRODUCT_NAME = "Fill Cart"


@dataclass(frozen=True, slots=True)
class NavigationPage:
    id: str
    path: str
    label: str
    icon_class: str
    section: str = "main"
    includes_children: bool = False

    @property
    def title(self) -> str:
        return f"{self.label} · {PRODUCT_NAME}"


NAVIGATION_PAGES = (
    NavigationPage("dashboard", "/dashboard", "Live Dashboard", "icon-dashboard"),
    NavigationPage("dashboard-layout", "/dashboard/layout", "Dashboard Layout", "icon-dashboard-layout"),
    NavigationPage("dashboard-views", "/dashboard/views", "Dashboard Views", "icon-dashboard-views"),
    NavigationPage("signals", "/signals", "Signal Graph", "icon-daq"),
    NavigationPage("state", "/state", "State Machine", "icon-state-machine"),
    NavigationPage("runs", "/runs", "Runs", "icon-runs", includes_children=True),
    NavigationPage("logs", "/logs", "Logs", "icon-logs"),
    NavigationPage("settings", "/settings", "Settings", "icon-settings", section="footer"),
)

NAVIGATION_BY_ID = {page.id: page for page in NAVIGATION_PAGES}


def page_path(page_id: str) -> str:
    return NAVIGATION_BY_ID[page_id].path


def page_for_path(path: str) -> NavigationPage | None:
    for page in NAVIGATION_PAGES:
        if path == page.path:
            return page
        if page.includes_children and path.startswith(f"{page.path}/"):
            return page
    return None
