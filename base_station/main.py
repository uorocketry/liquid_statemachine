import tkinter as tk

from gui.control_panel import ControlPanel
from gui.lab_jack_logger import LabJackLogger

if __name__ == "__main__":
    # Primary root window hosts the Control Panel
    control_panel_root = tk.Tk()
    ControlPanel(control_panel_root)

    # Secondary window for the LabJack logger; shares the same mainloop
    labjack_window = tk.Toplevel(control_panel_root)
    LabJackLogger(labjack_window)

    control_panel_root.mainloop()
