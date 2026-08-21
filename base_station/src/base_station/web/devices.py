"""Small explicit registry for device identity shared by app chrome and status APIs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class DeviceDefinition:
    id: str
    label: str
    route: str
    icon_class: str
    state_attribute: str
    navigation_status: Callable[[Any], str]


DEVICE_DEFINITIONS = (
    DeviceDefinition(
        id="p1am",
        label="P1AM",
        route="/devices/p1am",
        icon_class="arduino-icon",
        state_attribute="cart",
        navigation_status=lambda status: status.health,
    ),
    DeviceDefinition(
        id="labjack",
        label="LabJack",
        route="/devices/labjack",
        icon_class="labjack-icon",
        state_attribute="labjack",
        navigation_status=lambda status: "online" if status.connected else "offline",
    ),
)

DEVICE_BY_ID = {device.id: device for device in DEVICE_DEFINITIONS}
LOG_COMPONENTS = ("system", *(device.id for device in DEVICE_DEFINITIONS))
