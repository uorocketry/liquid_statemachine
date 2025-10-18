# labjack_gui.py

import tkinter as tk
from tkinter import ttk, scrolledtext
import threading
import time
from labjack import ljm
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import pandas as pd
import datetime # For timestamped filenames
import os       # For creating the data directory
from collections import deque # For efficient live plotting

# --- Configuration ---
DEFAULT_IP = "192.168.0.250"  # IMPORTANT: Change this to your T7's static IP address
DATA_DIR = "stream_data"      # Folder to save CSV files in
PLOT_HISTORY_SIZE = 1000      # Number of points to show on the LIVE plots

class LabJackGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("LabJack T7 Pro - Dual Channel Differential Logger")
        self.root.geometry("1400x900") # Wider window for more controls/plots

        # --- LabJack Members ---
        self.handle = None
        self.stream_thread = None
        self.stream_stop_flag = False
        self.csv_file = None

        # --- Data Members for Channel 1 (AIN0-AIN1) ---
        self.plot_data_live_ch1 = deque(maxlen=PLOT_HISTORY_SIZE)
        self.x_axis_live_ch1 = deque(maxlen=PLOT_HISTORY_SIZE)
        self.full_data_history_raw_ch1 = []
        self.full_data_history_filtered_ch1 = []

        # --- Data Members for Channel 2 (AIN2-AIN3) ---
        self.plot_data_live_ch2 = deque(maxlen=PLOT_HISTORY_SIZE)
        self.x_axis_live_ch2 = deque(maxlen=PLOT_HISTORY_SIZE)
        self.full_data_history_raw_ch2 = []
        self.full_data_history_filtered_ch2 = []

        self.history_plot_update_counter = 0

        # --- Create Main UI Frames ---
        self.create_widgets()

        # --- Set up clean exit ---
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)

    # --------------------------------------------------------------------------
    # GUI Creation
    # --------------------------------------------------------------------------
    def create_widgets(self):
        main_frame = ttk.Frame(self.root, padding="10")
        main_frame.pack(expand=True, fill='both')
        
        paned_window = ttk.PanedWindow(main_frame, orient=tk.HORIZONTAL)
        paned_window.pack(expand=True, fill='both')

        controls_pane = ttk.Frame(paned_window, padding="10")
        paned_window.add(controls_pane, weight=1)

        data_pane = ttk.Frame(paned_window, padding="10")
        paned_window.add(data_pane, weight=3)

        self._create_connection_frame(controls_pane)
        self._create_streaming_frame(controls_pane)

        # --- UPDATED: Create a paned window for the plots themselves ---
        plot_paned_window = ttk.PanedWindow(data_pane, orient=tk.VERTICAL)
        plot_paned_window.pack(expand=True, fill='both')

        live_plot_frame = ttk.LabelFrame(plot_paned_window, text="Live View", padding=5)
        plot_paned_window.add(live_plot_frame, weight=1)
        
        history_plot_frame = ttk.LabelFrame(plot_paned_window, text="Full History", padding=5)
        plot_paned_window.add(history_plot_frame, weight=1)

        self._create_live_plots(live_plot_frame)
        self._create_history_plots(history_plot_frame)
        self._create_log_frame(data_pane)

    def _create_connection_frame(self, parent):
        frame = ttk.LabelFrame(parent, text="1. Connection", padding="10")
        frame.pack(fill='x', pady=5)
        # ... (rest of connection frame is unchanged)
        ttk.Label(frame, text="IP Address:").grid(row=0, column=0, sticky='w')
        self.ip_entry = ttk.Entry(frame, width=20)
        self.ip_entry.insert(0, DEFAULT_IP)
        self.ip_entry.grid(row=0, column=1, padx=5)
        self.connect_button = ttk.Button(frame, text="Connect", command=self.connect_labjack)
        self.connect_button.grid(row=0, column=2, padx=5)
        self.disconnect_button = ttk.Button(frame, text="Disconnect", command=self.disconnect_labjack, state='disabled')
        self.disconnect_button.grid(row=0, column=3, padx=5)
        self.connection_status = tk.StringVar(value="Status: Disconnected")
        ttk.Label(frame, textvariable=self.connection_status).grid(row=1, column=0, columnspan=4, sticky='w', pady=(5,0))

    def _create_streaming_frame(self, parent):
        frame = ttk.LabelFrame(parent, text="2. Continuous Dual Differential Stream", padding="10")
        frame.pack(fill='x', pady=5)
        # ... (rest of streaming frame is unchanged)
        ttk.Label(frame, text="Scan Rate (Hz):").grid(row=0, column=0, sticky='w')
        self.scan_rate_entry = ttk.Entry(frame, width=10)
        self.scan_rate_entry.insert(0, "1000")
        self.scan_rate_entry.grid(row=0, column=1)
        self.filter_enabled_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(frame, text="Enable Centered Moving Average", variable=self.filter_enabled_var).grid(row=1, column=0, columnspan=2, sticky='w', pady=(10,0))
        ttk.Label(frame, text="Filter Window:").grid(row=2, column=0, sticky='w', pady=5)
        self.filter_window_entry = ttk.Entry(frame, width=10)
        self.filter_window_entry.insert(0, "100")
        self.filter_window_entry.grid(row=2, column=1)
        self.save_to_csv_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(frame, text="Save Stream to CSV", variable=self.save_to_csv_var).grid(row=3, column=0, columnspan=2, sticky='w', pady=5)
        self.stream_start_button = ttk.Button(frame, text="Start Dual Stream", command=self.start_stream_thread)
        self.stream_start_button.grid(row=4, column=0, pady=10, sticky='ew')
        self.stream_stop_button = ttk.Button(frame, text="Stop Stream", command=self.stop_stream, state='disabled')
        self.stream_stop_button.grid(row=4, column=1, pady=10, sticky='ew')

    def _create_live_plots(self, parent):
        # --- NEW: Create two side-by-side plots for live data ---
        self.fig_live, (self.ax_live_ch1, self.ax_live_ch2) = plt.subplots(nrows=1, ncols=2, figsize=(10, 3), dpi=100)
        
        self.ax_live_ch1.set_title("Live: AIN0 - AIN1")
        self.ax_live_ch1.set_xlabel("Scan Number")
        self.ax_live_ch1.set_ylabel("Voltage (V)")
        self.ax_live_ch1.grid(True)

        self.ax_live_ch2.set_title("Live: AIN2 - AIN3")
        self.ax_live_ch2.set_xlabel("Scan Number")
        self.ax_live_ch2.grid(True)

        self.fig_live.tight_layout()
        self.canvas_live = FigureCanvasTkAgg(self.fig_live, master=parent)
        self.canvas_live.get_tk_widget().pack(expand=True, fill='both')

    def _create_history_plots(self, parent):
        # --- NEW: Create two side-by-side plots for history data ---
        self.fig_history, (self.ax_history_ch1, self.ax_history_ch2) = plt.subplots(nrows=1, ncols=2, figsize=(10, 3), dpi=100)
        
        self.ax_history_ch1.set_title("History: AIN0 - AIN1")
        self.ax_history_ch1.set_xlabel("Scan Number")
        self.ax_history_ch1.set_ylabel("Voltage (V)")
        self.ax_history_ch1.grid(True)
        
        self.ax_history_ch2.set_title("History: AIN2 - AIN3")
        self.ax_history_ch2.set_xlabel("Scan Number")
        self.ax_history_ch2.grid(True)

        self.fig_history.tight_layout()
        self.canvas_history = FigureCanvasTkAgg(self.fig_history, master=parent)
        self.canvas_history.get_tk_widget().pack(expand=True, fill='both')
    
    def _create_log_frame(self, parent):
        frame = ttk.LabelFrame(parent, text="Log", padding="5")
        frame.pack(fill='x', pady=(10, 0))
        self.log_text = scrolledtext.ScrolledText(frame, height=6, wrap=tk.WORD, state='disabled')
        self.log_text.pack(expand=True, fill='both')

    # --------------------------------------------------------------------------
    # LabJack Logic
    # --------------------------------------------------------------------------
    def connect_labjack(self):
        if self.handle: return
        threading.Thread(target=self._connect_worker, daemon=True).start()

    def _connect_worker(self):
        try:
            ip = self.ip_entry.get()
            self.log(f"Connecting to {ip}...")
            self.handle = ljm.openS("T7", "ETHERNET", ip)
            info = ljm.getHandleInfo(self.handle)
            self.log(f"Connected! Device: {info[0]}, S/N: {info[2]}")
            self.connection_status.set(f"Status: Connected to S/N {info[2]}")
            self.connect_button.config(state='disabled')
            self.disconnect_button.config(state='normal')
        except ljm.LJMError as e:
            self.log(f"Connection Error: {e}", "error")
            self.handle = None

    def disconnect_labjack(self):
        if not self.handle: return
        threading.Thread(target=self._disconnect_worker, daemon=True).start()

    def _disconnect_worker(self):
        try:
            ljm.close(self.handle)
            self.log("Disconnected successfully.")
        except ljm.LJMError as e:
            self.log(f"Disconnection Error: {e}", "error")
        finally:
            self.handle = None
            self.connection_status.set("Status: Disconnected")
            self.connect_button.config(state='normal')
            self.disconnect_button.config(state='disabled')
    
    def start_stream_thread(self):
        if not self.handle: self.log("Not connected.", "error"); return
        if self.stream_thread and self.stream_thread.is_alive():
            self.log("Stream already running.", "error"); return
            
        # Clear all data buffers
        self.plot_data_live_ch1.clear(); self.x_axis_live_ch1.clear()
        self.full_data_history_raw_ch1 = []; self.full_data_history_filtered_ch1 = []
        self.plot_data_live_ch2.clear(); self.x_axis_live_ch2.clear()
        self.full_data_history_raw_ch2 = []; self.full_data_history_filtered_ch2 = []
        self.history_plot_update_counter = 0
        
        self.stream_stop_flag = False
        self.stream_start_button.config(state='disabled')
        self.stream_stop_button.config(state='normal')
        
        self.stream_thread = threading.Thread(target=self._stream_worker, daemon=True)
        self.stream_thread.start()

    def stop_stream(self):
        if self.stream_thread and self.stream_thread.is_alive():
            self.stream_stop_flag = True
            self.log("Stop signal sent to stream...")
        self.stream_stop_button.config(state='disabled')

    def _stream_worker(self):
        """This function runs in a separate thread to handle the continuous stream."""
        scan_counter = 0
        try:
            scan_rate = int(self.scan_rate_entry.get())
            filter_enabled = self.filter_enabled_var.get()
            try:
                filter_window = int(self.filter_window_entry.get())
                if filter_window < 2: filter_window = 2
            except ValueError:
                filter_window = 100
                self.root.after(0, self.log, "Invalid filter window, using 100.", "error")

            if self.save_to_csv_var.get():
                if not os.path.exists(DATA_DIR):
                    os.makedirs(DATA_DIR)
                    self.root.after(0, self.log, f"Created data directory: {DATA_DIR}")
                
                timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
                filename = os.path.join(DATA_DIR, f"dual_stream_{timestamp}.csv")
                self.csv_file = open(filename, "w", encoding="utf-8")
                # --- NEW: Updated CSV Header for two channels ---
                self.csv_file.write("Time (s),AIN0-AIN1 (V),AIN2-AIN3 (V)\n")
                self.root.after(0, self.log, f"Opened log file: {filename}")

            self.root.after(0, self.log, "Configuring differential channels...")
            # --- NEW: Configure both channels for differential mode ---
            ljm.eWriteName(self.handle, "AIN0_NEGATIVE_CH", 1) # AIN0 ref = AIN1
            ljm.eWriteName(self.handle, "AIN0_RANGE", 0.1)
            ljm.eWriteName(self.handle, "AIN2_NEGATIVE_CH", 3) # AIN2 ref = AIN3
            ljm.eWriteName(self.handle, "AIN2_RANGE", 0.1)

            # --- NEW: Scan list now includes both AIN0 and AIN2 ---
            scan_list_names = ["AIN0", "AIN2"]
            num_addresses = len(scan_list_names)
            scan_list = ljm.namesToAddresses(num_addresses, scan_list_names)[0]
            scans_per_read = scan_rate // 2

            self.root.after(0, self.log, f"Starting dual stream at {scan_rate} Hz...")
            ljm.eStreamStart(self.handle, scans_per_read, num_addresses, scan_list, scan_rate)

            while not self.stream_stop_flag:
                ret = ljm.eStreamRead(self.handle)
                data_chunk = ret[0]
                self.root.after(0, self.process_stream_chunk, data_chunk, scan_rate, scan_counter, filter_enabled, filter_window)
                scan_counter += len(data_chunk) // num_addresses # Divide by num channels
                
        except ljm.LJMError as e: self.root.after(0, self.log, f"Stream Error: {e}", "error")
        except ValueError: self.root.after(0, self.log, "Invalid scan rate.", "error")
        finally:
            if self.handle:
                ljm.eStreamStop(self.handle)
                # --- NEW: Revert both channels to single-ended mode ---
                ljm.eWriteName(self.handle, "AIN0_NEGATIVE_CH", 199)
                ljm.eWriteName(self.handle, "AIN2_NEGATIVE_CH", 199)
                self.root.after(0, self.log, "Stream stopped and channels reverted to single-ended.")
            
            if self.csv_file:
                self.csv_file.close(); self.csv_file = None
                self.root.after(0, self.log, "Log file saved and closed.")

            self.stream_start_button.config(state='normal')
            self.stream_stop_button.config(state='disabled')
            self.root.after(0, self.update_history_plots)

    def process_stream_chunk(self, data_chunk, scan_rate, start_scan_number, filter_enabled, filter_window):
        try:
            # --- NEW: De-interleave data for two channels ---
            ch1_data_chunk = data_chunk[0::2]
            ch2_data_chunk = data_chunk[1::2]
            
            self.full_data_history_raw_ch1.extend(ch1_data_chunk)
            self.full_data_history_raw_ch2.extend(ch2_data_chunk)
            
            data_to_log_ch1, data_to_log_ch2 = [], []

            if filter_enabled:
                # Filter Channel 1
                s1 = pd.Series(self.full_data_history_raw_ch1)
                ma1 = s1.rolling(window=filter_window, center=True, min_periods=1).mean().dropna()
                self.full_data_history_filtered_ch1 = ma1.tolist()
                self.plot_data_live_ch1.clear()
                self.plot_data_live_ch1.extend(self.full_data_history_filtered_ch1[-PLOT_HISTORY_SIZE:])
                
                # Filter Channel 2
                s2 = pd.Series(self.full_data_history_raw_ch2)
                ma2 = s2.rolling(window=filter_window, center=True, min_periods=1).mean().dropna()
                self.full_data_history_filtered_ch2 = ma2.tolist()
                self.plot_data_live_ch2.clear()
                self.plot_data_live_ch2.extend(self.full_data_history_filtered_ch2[-PLOT_HISTORY_SIZE:])

                # Determine data to log based on the shorter filtered list
                num_to_log = len(self.full_data_history_filtered_ch1) - (start_scan_number - (filter_window // 2))
                if num_to_log > 0:
                     data_to_log_ch1 = self.full_data_history_filtered_ch1[-num_to_log:]
                     data_to_log_ch2 = self.full_data_history_filtered_ch2[-num_to_log:]

            else:
                data_to_log_ch1 = ch1_data_chunk
                data_to_log_ch2 = ch2_data_chunk
                self.plot_data_live_ch1.extend(ch1_data_chunk)
                self.plot_data_live_ch2.extend(ch2_data_chunk)

            x_values = range(start_scan_number, start_scan_number + len(ch1_data_chunk))
            self.x_axis_live_ch1.extend(x_values)
            self.x_axis_live_ch2.extend(x_values)
            
            if self.csv_file and data_to_log_ch1:
                lag_offset = (filter_window // 2) if filter_enabled else 0
                for i in range(len(data_to_log_ch1)):
                    timestamp = (start_scan_number + i - lag_offset) / scan_rate
                    if timestamp >= 0:
                        self.csv_file.write(f"{timestamp:.6f},{data_to_log_ch1[i]:.6f},{data_to_log_ch2[i]:.6f}\n")
            
            self.update_live_plots()

            self.history_plot_update_counter += 1
            if self.history_plot_update_counter >= 10:
                self.update_history_plots()
                self.history_plot_update_counter = 0

        except Exception as e:
            self.log(f"Data Processing Error: {e}", "error")

    def update_live_plots(self):
        """Updates both live matplotlib plots with the latest data."""
        try:
            plot_label = "Moving Average" if self.filter_enabled_var.get() else "Raw Data"
            plot_color = "orange" if self.filter_enabled_var.get() else "blue"

            # Update Channel 1 Plot
            self.ax_live_ch1.clear()
            self.ax_live_ch1.plot(list(self.x_axis_live_ch1), list(self.plot_data_live_ch1), label=plot_label, color=plot_color)
            self.ax_live_ch1.set_title("Live: AIN0 - AIN1")
            self.ax_live_ch1.set_xlabel("Scan Number")
            self.ax_live_ch1.set_ylabel("Voltage (V)")
            self.ax_live_ch1.grid(True); self.ax_live_ch1.legend()
            
            # Update Channel 2 Plot
            self.ax_live_ch2.clear()
            self.ax_live_ch2.plot(list(self.x_axis_live_ch2), list(self.plot_data_live_ch2), label=plot_label, color=plot_color)
            self.ax_live_ch2.set_title("Live: AIN2 - AIN3")
            self.ax_live_ch2.set_xlabel("Scan Number")
            self.ax_live_ch2.grid(True); self.ax_live_ch2.legend()
            
            self.canvas_live.draw()
        except Exception as e:
            self.log(f"Live Plot Error: {e}", "error")

    def update_history_plots(self):
        """Updates both history matplotlib plots with all collected data."""
        try:
            plot_label = "Moving Average" if self.filter_enabled_var.get() else "Raw Data"
            plot_color = "orange" if self.filter_enabled_var.get() else "blue"
            
            # Update Channel 1 History
            self.ax_history_ch1.clear()
            data_ch1 = self.full_data_history_filtered_ch1 if self.filter_enabled_var.get() else self.full_data_history_raw_ch1
            self.ax_history_ch1.plot(data_ch1, label=plot_label, color=plot_color)
            self.ax_history_ch1.set_title("History: AIN0 - AIN1")
            self.ax_history_ch1.set_xlabel("Scan Number")
            self.ax_history_ch1.set_ylabel("Voltage (V)")
            self.ax_history_ch1.grid(True); self.ax_history_ch1.legend()

            # Update Channel 2 History
            self.ax_history_ch2.clear()
            data_ch2 = self.full_data_history_filtered_ch2 if self.filter_enabled_var.get() else self.full_data_history_raw_ch2
            self.ax_history_ch2.plot(data_ch2, label=plot_label, color=plot_color)
            self.ax_history_ch2.set_title("History: AIN2 - AIN3")
            self.ax_history_ch2.set_xlabel("Scan Number")
            self.ax_history_ch2.grid(True); self.ax_history_ch2.legend()
            
            self.canvas_history.draw()
        except Exception as e:
            self.log(f"History Plot Error: {e}", "error")

    def log(self, message, level="info"):
        """Adds a message to the log text box."""
        self.log_text.config(state='normal')
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.config(state='disabled')
        self.log_text.see(tk.END)

    def on_closing(self):
        """Handles the window closing event."""
        self.log("Closing application...")
        if self.stream_thread and self.stream_thread.is_alive():
            self.stream_stop_flag = True
            self.stream_thread.join(timeout=1)

        if self.handle:
            try:
                ljm.eWriteName(self.handle, "AIN0_NEGATIVE_CH", 199)
                ljm.eWriteName(self.handle, "AIN2_NEGATIVE_CH", 199)
            except ljm.LJMError: pass
            self.disconnect_labjack()
            time.sleep(0.1)
            
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = LabJackGUI(root)
    root.mainloop()