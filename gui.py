# gui.py

import tkinter as tk
from tkinter import scrolledtext
import tkinter.font as font
import sys
import time
import datetime # Added for timestamped log file
from sm_eth import State, STATE_NAMES, UI_STATES, send_async

# --- Configuration ---
# How long to wait for a response before declaring the connection lost (in seconds)
CONNECTION_TIMEOUT = 3.0
FIRE_COUNTDOWN_SECONDS = 10

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
        self.log_file = None # Will hold the file handle for the log file
        
        # --- Countdown specific members ---
        self.countdown_job = None
        self.countdown_value = 0

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
        
        # --- Set up file logging ---
        self.setup_file_logging()

        # --- Configure Log Tags for Colors ---
        bold_font = font.Font(family="Helvetica", size=10, weight="bold")
        self.log_viewer.tag_configure("success", foreground="#009900", font=bold_font)
        self.log_viewer.tag_configure("error", foreground="red", font=bold_font)

        # --- Redirect stdout ---
        self.redirector = TextRedirector(self.root, self.log)
        sys.stdout = self.redirector
        sys.stderr = self.redirector # Also redirect errors
        
        # --- Catch window close event to safely close the log file ---
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)

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
        
        # --- Countdown Timer Label (hidden by default) ---
        self.countdown_label = tk.Label(right_frame, text="", font=('Helvetica', 48, 'bold'), fg=self.colors['fire_fg'])
        # It will be packed later when the countdown starts

        # 3. Buttons Frame (in the right pane)
        button_frame = tk.Frame(right_frame)
        button_frame.pack(pady=10, padx=20)

        for state in UI_STATES:
            text = STATE_NAMES.get(state, "UNKNOWN")
            
            # Special command for the FIRE and ABORT buttons
            if state == State.FIRE:
                command = self.start_fire_sequence
            elif state == State.ABORT:
                command = self.send_abort_command
            else:
                command = lambda s=state: send_async(s.value, lambda resp: None)

            btn = tk.Button(button_frame, text=text, command=command, state='disabled')
            
            if state == State.FIRE:
                btn.configure(fg=self.colors['fire_fg'], font=('Helvetica', 14, 'bold'))
            
            btn.pack(pady=5, fill='x')
            self.buttons[state] = btn

        # --- Left Pane for the Log Viewer ---
        left_frame = tk.Frame(self.root)
        left_frame.pack(side=tk.LEFT, expand=True, fill='both', padx=(10, 0), pady=10)
        
        log_container = tk.Frame(left_frame)
        log_container.place(relx=0, rely=0.25, relwidth=1.0, relheight=0.5)

        log_label = tk.Label(log_container, text="Log Output:")
        log_label.pack(anchor='w')
        self.log_viewer = scrolledtext.ScrolledText(log_container, state='disabled', wrap=tk.WORD, width=50)
        self.log_viewer.pack(expand=True, fill='both')

        # Now that the log viewer definitely exists, log the logo error if it happened.
        if not self.logo_image:
            self.log("Error: icon.png not found. Make sure it's in the same folder.", tags=["error"])

    def start_fire_sequence(self):
        """Disables buttons and starts the 10-second countdown."""
        self.log(f"FIRE sequence initiated. Countdown started from {FIRE_COUNTDOWN_SECONDS} seconds.")
        
        # --- KEY CHANGE HERE ---
        # Disable all buttons EXCEPT for the ABORT button.
        for state, button in self.buttons.items():
            if state != State.ABORT:
                button.config(state='disabled')
        
        self.countdown_value = FIRE_COUNTDOWN_SECONDS
        self.countdown_label.pack(pady=10) # Make the label visible
        self.update_countdown()

    def update_countdown(self):
        """Recursively updates the countdown timer each second."""
        if self.countdown_value > 0:
            self.countdown_label.config(text=str(self.countdown_value))
            self.countdown_value -= 1
            self.countdown_job = self.root.after(1000, self.update_countdown)
        else:
            self.countdown_label.config(text="FIRING...")
            self.log("Countdown complete. Sending FIRE command.")
            send_async(State.FIRE.value, lambda resp: None)
            # Hide the label after a short delay
            self.root.after(2000, self.end_fire_sequence)

    def end_fire_sequence(self):
        """Hides the countdown label and allows the UI to update normally."""
        if self.countdown_job:
            self.root.after_cancel(self.countdown_job)
            self.countdown_job = None
        self.countdown_label.pack_forget() # Hide the label
        # The regular update_status loop will re-enable the correct buttons
        
    def send_abort_command(self):
        """Sends the ABORT command and cancels any ongoing countdown."""
        if self.countdown_job:
            self.log("FIRE sequence ABORTED by user.", tags=["error"])
            self.end_fire_sequence()
        
        self.log("Sending ABORT command.")
        send_async(State.ABORT.value, lambda resp: None)

    def setup_file_logging(self):
        """Creates a timestamped log file."""
        try:
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
            filename = f"output_{timestamp}.txt"
            self.log_file = open(filename, "w", encoding="utf-8")
            self.log(f"Logging session to {filename}")
        except Exception as e:
            self.log(f"Error: Could not create log file. {e}", tags=["error"])

    def setup_half_screen_layout(self):
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        width = int(screen_width * 0.7) 
        height = int(screen_height * 0.9)
        x_position = screen_width - width
        y_position = 0
        self.root.geometry(f"{width}x{height}+{x_position}+{y_position}")

    def log(self, message, tags=None):
        """Logs messages to both the GUI's text widget and the text file."""
        timestamp = time.strftime("%H:%M:%S")
        full_message = f"[{timestamp}] {message.strip()}"
        self.log_viewer.configure(state='normal')
        if tags: self.log_viewer.insert(tk.END, full_message + "\n", tags)
        else: self.log_viewer.insert(tk.END, full_message + "\n")
        self.log_viewer.see(tk.END)
        self.log_viewer.configure(state='disabled')
        if self.log_file:
            try:
                self.log_file.write(full_message + "\n")
                self.log_file.flush()
            except Exception as e:
                error_msg = f"CRITICAL: Failed to write to log file: {e}"
                self.log_viewer.insert(tk.END, error_msg + "\n", ["error"])

    def on_closing(self):
        """Handles the window closing event to safely shut down."""
        self.log("Application closing...")
        if self.log_file: self.log_file.close()
        self.root.destroy()

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
        # Do not update buttons if a countdown is in progress
        if self.countdown_job: return
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
            # Cancel countdown on connection loss
            if self.countdown_job:
                self.log("FIRE sequence cancelled due to connection loss.", tags=["error"])
                self.end_fire_sequence()
            for button in self.buttons.values():
                button.config(state='disabled', bg=self.colors['normal_bg'])
        self.root.after(1000, self.check_connection)

if __name__ == "__main__":
    window = tk.Tk()
    app = StateMachineGUI(window)
    window.mainloop()