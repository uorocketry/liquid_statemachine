# gui.py

import tkinter as tk
from tkinter import scrolledtext
import tkinter.font as font
import sys
import time
from sm_eth import State, STATE_NAMES, UI_STATES, send_async

# --- Configuration ---
# How long to wait for a response before declaring the connection lost (in seconds)
CONNECTION_TIMEOUT = 3.0

# A helper class to redirect stdout (general print statements) to the GUI's text widget
class TextRedirector:
    def __init__(self, widget, log_method):
        self.widget = widget
        self.log_method = log_method

    def write(self, text):
        # Use the GUI's log method to ensure thread-safe updates and proper formatting
        self.widget.after(0, self.log_method, text)

    def flush(self):
        # This is needed for compatibility with the sys.stdout interface.
        pass

class StateMachineGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("State Machine Controller")

        # --- Class Members ---
        self.buttons = {} # Using a dictionary for easy access
        self.last_known_state = -1
        self.connection_established = False
        self.last_update_time = 0
        self.logo_image = None # This will hold the reference to the image object

        # --- Style Configuration ---
        font.nametofont("TkDefaultFont").configure(size=14)
        self.colors = {
            'normal_bg': self.root.cget('bg'),
            'highlight_bg': '#a6d8ff', # A light blue for highlighting
            'fire_fg': '#ff0000'
        }

        # --- UI Widgets ---
        self.create_widgets()
        self.setup_half_screen_layout()

        # --- Configure Log Tags for Colors ---
        bold_font = font.Font(family="Helvetica", size=10, weight="bold")
        self.log_viewer.tag_configure("success", foreground="#009900", font=bold_font)
        self.log_viewer.tag_configure("error", foreground="red", font=bold_font)

        # --- Redirect stdout ---
        self.redirector = TextRedirector(self.root, self.log)
        sys.stdout = self.redirector
        sys.stderr = self.redirector # Also redirect errors

        # --- Start the update loops ---
        self.update_status()
        self.check_connection()

    def create_widgets(self):
        # --- LAYOUT: Controls on the right, centered log on the left ---

        # --- Right Pane for Controls (packed first to reserve its space) ---
        right_frame = tk.Frame(self.root)
        right_frame.pack(side=tk.RIGHT, fill='y', padx=(10, 10), pady=10)

        # 1. Logo (in the right pane)
        try:
            self.logo_image = tk.PhotoImage(file="icon.png")
            self.logo_image = self.logo_image.subsample(2, 2)
            logo_label = tk.Label(right_frame, image=self.logo_image)
            logo_label.pack(pady=5)
        except tk.TclError:
            pass

        # 2. State Label (in the right pane)
        self.state_label = tk.Label(right_frame, text="Current state: CONNECTING...", font=('Helvetica', 16, 'bold'))
        self.state_label.pack(pady=10)

        # 3. Buttons Frame (in the right pane)
        button_frame = tk.Frame(right_frame)
        button_frame.pack(pady=10, padx=20)

        for state in UI_STATES:
            text = STATE_NAMES.get(state, "UNKNOWN")
            command = lambda s=state: send_async(s.value, lambda resp: None)
            btn = tk.Button(button_frame, text=text, command=command, state='disabled')
            
            if state == State.FIRE:
                btn.configure(fg=self.colors['fire_fg'], font=('Helvetica', 14, 'bold'))
            
            btn.pack(pady=5, fill='x')
            self.buttons[state] = btn

        # --- Left Pane for the Log Viewer ---
        # This frame will expand to fill all remaining space to the left.
        left_frame = tk.Frame(self.root)
        left_frame.pack(side=tk.LEFT, expand=True, fill='both', padx=(10, 0), pady=10)
        
        # --- KEY CHANGE: Place the log inside the left_frame to center it and set its height ---
        log_container = tk.Frame(left_frame)
        
        # Use .place() to set relative size and position
        # relx=0, relwidth=1.0 -> Fill the horizontal space of the parent (left_frame)
        # rely=0.25 -> Start 25% down from the top to center it
        # relheight=0.5 -> Make the height 50% of the parent (left_frame)
        log_container.place(relx=0, rely=0.25, relwidth=1.0, relheight=0.5)

        log_label = tk.Label(log_container, text="Log Output:")
        log_label.pack(anchor='w')
        self.log_viewer = scrolledtext.ScrolledText(log_container, state='disabled', wrap=tk.WORD, width=50)
        self.log_viewer.pack(expand=True, fill='both')

        # Now that the log viewer definitely exists, log the logo error if it happened.
        if not self.logo_image:
            self.log("Error: icon.png not found. Make sure it's in the same folder.", tags=["error"])


    def setup_half_screen_layout(self):
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        
        # A wider window is better for a side-by-side layout
        width = int(screen_width * 0.7) 
        height = int(screen_height * 0.9) # Use most of the screen height
        x_position = screen_width - width
        y_position = 0
        
        self.root.geometry(f"{width}x{height}+{x_position}+{y_position}")

    def log(self, message, tags=None):
        """Custom method to log messages to the text widget with optional color tags."""
        self.log_viewer.configure(state='normal')
        timestamp = time.strftime("%H:%M:%S")
        full_message = f"[{timestamp}] {message.strip()}\n"
        
        if tags:
            self.log_viewer.insert(tk.END, full_message, tags)
        else:
            self.log_viewer.insert(tk.END, full_message)
            
        self.log_viewer.see(tk.END) # Auto-scroll to the bottom
        self.log_viewer.configure(state='disabled')

    def update_current_state(self, packet):
        if not packet: return
        self.last_update_time = time.time()

        if not self.connection_established:
            self.connection_established = True
            self.log("Connection established.", tags=["success"])

        try:
            new_state_val = int(packet[0])
            if new_state_val != self.last_known_state:
                self.last_known_state = new_state_val
                state_name = STATE_NAMES.get(State(new_state_val), 'UNKNOWN')
                self.state_label.config(text=f"Current state: {state_name}")
                self.log(f"Current state: {state_name}")
                self.highlight_current_state()
        except (ValueError, IndexError):
            self.state_label.config(text="Current state: INVALID")

    def highlight_current_state(self):
        for state, button in self.buttons.items():
            if state.value == self.last_known_state:
                button.config(bg=self.colors['highlight_bg'])
            else:
                button.config(bg=self.colors['normal_bg'])

    def update_transitions(self, packet):
        if not packet: return
        try:
            valid_transitions = {int(p) for p in packet}
            for state, button in self.buttons.items():
                if state.value in valid_transitions:
                    button.config(state='normal')
                else:
                    button.config(state='disabled')
        except (ValueError, IndexError):
            self.log("Error: Invalid transition data received.", tags=["error"])

    def update_status(self):
        """The main loop that periodically fetches status from the device."""
        if not self.root: return
        send_async(State.GET_STATE.value, self.update_current_state)
        send_async(State.GET_TRANSITIONS.value, self.update_transitions)
        self.root.after(500, self.update_status)

    def check_connection(self):
        """Periodically checks if the connection has timed out."""
        if not self.root: return
        time_since_last_update = time.time() - self.last_update_time
        
        if self.connection_established and time_since_last_update > CONNECTION_TIMEOUT:
            self.connection_established = False
            self.last_known_state = -1
            self.log("Connection lost.", tags=["error"])
            self.state_label.config(text="Current state: DISCONNECTED")
            for button in self.buttons.values():
                button.config(state='disabled', bg=self.colors['normal_bg'])
        
        self.root.after(1000, self.check_connection)

if __name__ == "__main__":
    window = tk.Tk()
    app = StateMachineGUI(window)
    window.mainloop()