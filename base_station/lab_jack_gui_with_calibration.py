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
DEFAULT_IP = "192.168.1.200"  # IMPORTANT: Change this to your T7's static IP address
DATA_DIR = "logs/labjack"      # Folder to save CSV files in
PLOT_HISTORY_SIZE = 1000      # Number of points to show on the LIVE plots

class LabJackGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("LabJack T7 Pro - Dual Channel Differential Logger")
        self.root.geometry("1400x900")

        # --- LabJack Members ---
        self.handle = None
        self.stream_thread = None
        self.stream_stop_flag = False
        self.csv_file = None

        # --- Data Members ---
        self.plot_data_live_ch1 = deque(maxlen=PLOT_HISTORY_SIZE)
        self.x_axis_live_ch1 = deque(maxlen=PLOT_HISTORY_SIZE)
        self.full_data_history_raw_ch1, self.full_data_history_filtered_ch1 = [], []
        self.plot_data_live_ch2 = deque(maxlen=PLOT_HISTORY_SIZE)
        self.x_axis_live_ch2 = deque(maxlen=PLOT_HISTORY_SIZE)
        self.full_data_history_raw_ch2, self.full_data_history_filtered_ch2 = [], []
        self.history_plot_update_counter = 0

        # --- Dictionaries to hold calibration parameters and UI variables for each channel ---
        self.cal_params = {
            'ch1': {'p1_volts': None, 'p2_volts': None, 'slope': 1.0, 'offset': 0.0},
            'ch2': {'p1_volts': None, 'p2_volts': None, 'slope': 1.0, 'offset': 0.0}
        }
        self.cal_vars = {'ch1': {}, 'ch2': {}} # For tk.StringVars

        # --- Create Main UI Frames ---
        self.create_widgets()

        # --- Set up clean exit ---
        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.update_device_temperature()

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
        self._create_calibration_frame(controls_pane)
        self._create_streaming_frame(controls_pane)

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
        
        ttk.Label(frame, text="IP Address:").grid(row=0, column=0, sticky='w')
        self.ip_entry = ttk.Entry(frame, width=20); self.ip_entry.insert(0, DEFAULT_IP)
        self.ip_entry.grid(row=0, column=1, padx=5)
        self.connect_button = ttk.Button(frame, text="Connect", command=self.connect_labjack)
        self.connect_button.grid(row=0, column=2, padx=5)
        self.disconnect_button = ttk.Button(frame, text="Disconnect", command=self.disconnect_labjack, state='disabled')
        self.disconnect_button.grid(row=0, column=3, padx=5)
        self.connection_status = tk.StringVar(value="Status: Disconnected")
        ttk.Label(frame, textvariable=self.connection_status).grid(row=1, column=0, columnspan=4, sticky='w', pady=(5,0))
        self.temperature_status = tk.StringVar(value="Device Temp: --")
        ttk.Label(frame, textvariable=self.temperature_status, font=('Courier', 10)).grid(row=2, column=0, columnspan=4, sticky='w', pady=(5,0))

    def _create_calibration_frame(self, parent):
        frame = ttk.LabelFrame(parent, text="2. Calibration", padding="10")
        frame.pack(fill='x', pady=5)
        
        self.cal_enabled_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(frame, text="Apply Calibration to All Channels", variable=self.cal_enabled_var).pack(anchor='w', pady=(0,5))
        
        notebook = ttk.Notebook(frame)
        notebook.pack(expand=True, fill='both')

        tab1 = ttk.Frame(notebook, padding="5")
        tab2 = ttk.Frame(notebook, padding="5")
        
        notebook.add(tab1, text='Channel 1 (AIN0-1) Cal')
        notebook.add(tab2, text='Channel 2 (AIN2-3) Cal')

        self._populate_cal_tab(tab1, 'ch1')
        self._populate_cal_tab(tab2, 'ch2')

    def _populate_cal_tab(self, parent_frame, channel_id):
        self.cal_vars[channel_id] = {
            'units_var': tk.StringVar(value="PSI"),
            'p1_units_var': tk.StringVar(value="0"),
            'p2_units_var': tk.StringVar(value="1000"),
            'p1_volts_var': tk.StringVar(value="- V"),
            'p2_volts_var': tk.StringVar(value="- V"),
            'slope_var': tk.StringVar(value="Slope (m): 1.0"),
            'offset_var': tk.StringVar(value="Offset (b): 0.0")
        }
        
        ttk.Label(parent_frame, text="Engineering Units:").grid(row=0, column=0, sticky='w')
        ttk.Entry(parent_frame, textvariable=self.cal_vars[channel_id]['units_var'], width=10).grid(row=0, column=1)
        ttk.Label(parent_frame, text="Low Point Value:").grid(row=1, column=0, sticky='w', pady=(10,0))
        ttk.Entry(parent_frame, textvariable=self.cal_vars[channel_id]['p1_units_var'], width=10).grid(row=1, column=1, pady=(10,0))
        ttk.Button(parent_frame, text="Read Low Point", command=lambda: self.read_calibration_point(channel_id, 1)).grid(row=1, column=2, padx=5, pady=(10,0))
        ttk.Label(parent_frame, textvariable=self.cal_vars[channel_id]['p1_volts_var']).grid(row=1, column=3, sticky='w', pady=(10,0))
        ttk.Label(parent_frame, text="High Point Value:").grid(row=2, column=0, sticky='w')
        ttk.Entry(parent_frame, textvariable=self.cal_vars[channel_id]['p2_units_var'], width=10).grid(row=2, column=1)
        ttk.Button(parent_frame, text="Read High Point", command=lambda: self.read_calibration_point(channel_id, 2)).grid(row=2, column=2, padx=5)
        ttk.Label(parent_frame, textvariable=self.cal_vars[channel_id]['p2_volts_var']).grid(row=2, column=3, sticky='w')
        ttk.Label(parent_frame, textvariable=self.cal_vars[channel_id]['slope_var']).grid(row=3, column=0, columnspan=2, sticky='w', pady=(10,0))
        ttk.Label(parent_frame, textvariable=self.cal_vars[channel_id]['offset_var']).grid(row=4, column=0, columnspan=2, sticky='w')

    def _create_streaming_frame(self, parent):
        frame = ttk.LabelFrame(parent, text="3. Stream Controls", padding="10")
        frame.pack(fill='x', pady=5)
        ttk.Label(frame, text="Scan Rate (Hz):").grid(row=0, column=0, sticky='w')
        self.scan_rate_entry = ttk.Entry(frame, width=10); self.scan_rate_entry.insert(0, "2000")
        self.scan_rate_entry.grid(row=0, column=1)
        self.filter_enabled_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(frame, text="Enable Centered Moving Average", variable=self.filter_enabled_var).grid(row=1, column=0, columnspan=2, sticky='w', pady=(10,0))
        ttk.Label(frame, text="Filter Window:").grid(row=2, column=0, sticky='w', pady=5)
        self.filter_window_entry = ttk.Entry(frame, width=10); self.filter_window_entry.insert(0, "250")
        self.filter_window_entry.grid(row=2, column=1)
        self.save_to_csv_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(frame, text="Save Stream to CSV", variable=self.save_to_csv_var).grid(row=3, column=0, columnspan=2, sticky='w', pady=5)
        self.stream_start_button = ttk.Button(frame, text="Start Dual Stream", command=self.start_stream_thread)
        self.stream_start_button.grid(row=4, column=0, pady=10, sticky='ew')
        self.stream_stop_button = ttk.Button(frame, text="Stop Stream", command=self.stop_stream, state='disabled')
        self.stream_stop_button.grid(row=4, column=1, pady=10, sticky='ew')

    def _create_live_plots(self, parent):
        self.fig_live, (self.ax_live_ch1, self.ax_live_ch2) = plt.subplots(nrows=1, ncols=2, figsize=(10, 3), dpi=100)
        self.fig_live.tight_layout(pad=3.0)
        self.canvas_live = FigureCanvasTkAgg(self.fig_live, master=parent)
        self.canvas_live.get_tk_widget().pack(expand=True, fill='both')

    def _create_history_plots(self, parent):
        self.fig_history, (self.ax_history_ch1, self.ax_history_ch2) = plt.subplots(nrows=1, ncols=2, figsize=(10, 3), dpi=100)
        self.fig_history.tight_layout(pad=3.0)
        self.canvas_history = FigureCanvasTkAgg(self.fig_history, master=parent)
        self.canvas_history.get_tk_widget().pack(expand=True, fill='both')
    
    def _create_log_frame(self, parent):
        frame = ttk.LabelFrame(parent, text="Log", padding="5")
        frame.pack(fill='x', pady=(10, 0))
        self.log_text = scrolledtext.ScrolledText(frame, height=6, wrap=tk.WORD, state='disabled')
        self.log_text.pack(expand=True, fill='both')

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
    
    def read_calibration_point(self, channel_id, point_num):
        if not self.handle: self.log("Not connected.", "error"); return
        threading.Thread(target=self._read_cal_point_worker, args=(channel_id, point_num), daemon=True).start()

    def _read_cal_point_worker(self, channel_id, point_num):
        try:
            self.log(f"Reading calibration voltage for {channel_id}, point {point_num}...")
            ain_positive = "AIN0" if channel_id == 'ch1' else "AIN2"
            ain_negative_num = 1 if channel_id == 'ch1' else 3
            ljm.eWriteName(self.handle, f"{ain_positive}_NEGATIVE_CH", ain_negative_num)
            ljm.eWriteName(self.handle, f"{ain_positive}_RANGE", 0.1)
            time.sleep(0.1)
            voltage = ljm.eReadName(self.handle, ain_positive)
            
            if point_num == 1:
                self.cal_params[channel_id]['p1_volts'] = voltage
                self.cal_vars[channel_id]['p1_volts_var'].set(f"{voltage:.4f} V")
            else:
                self.cal_params[channel_id]['p2_volts'] = voltage
                self.cal_vars[channel_id]['p2_volts_var'].set(f"{voltage:.4f} V")
            
            self.log(f"{channel_id} point {point_num} voltage: {voltage:.4f} V")
            self.calculate_calibration(channel_id)
        except ljm.LJMError as e:
            self.log(f"Calibration Read Error: {e}", "error")
        finally:
            if self.handle:
                ljm.eWriteName(self.handle, f"{ain_positive}_NEGATIVE_CH", 199)

    def calculate_calibration(self, channel_id):
        params = self.cal_params[channel_id]
        if params['p1_volts'] is None or params['p2_volts'] is None: return
        try:
            v1, v2 = params['p1_volts'], params['p2_volts']
            u1 = float(self.cal_vars[channel_id]['p1_units_var'].get())
            u2 = float(self.cal_vars[channel_id]['p2_units_var'].get())
            
            if abs(v2 - v1) < 1e-9:
                self.log(f"Calibration Error ({channel_id}): Voltages are the same.", "error"); return
            
            params['slope'] = (u2 - u1) / (v2 - v1)
            params['offset'] = u1 - params['slope'] * v1
            
            self.cal_vars[channel_id]['slope_var'].set(f"Slope (m): {params['slope']:.4f}")
            self.cal_vars[channel_id]['offset_var'].set(f"Offset (b): {params['offset']:.4f}")
            self.log(f"New calibration for {channel_id} applied.")
        except ValueError:
            self.log(f"Invalid unit values for {channel_id}.", "error")
        except Exception as e:
            self.log(f"Calibration calculation error ({channel_id}): {e}", "error")

    def apply_calibration(self, data_chunk, channel_id):
        if not self.cal_enabled_var.get():
            return data_chunk
        slope = self.cal_params[channel_id]['slope']
        offset = self.cal_params[channel_id]['offset']
        return [(val * slope) + offset for val in data_chunk]

    def start_stream_thread(self):
        if not self.handle: self.log("Not connected.", "error"); return
        if self.stream_thread and self.stream_thread.is_alive():
            self.log("Stream already running.", "error"); return
            
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
                units1 = self.cal_vars['ch1']['units_var'].get() if self.cal_enabled_var.get() else "V"
                units2 = self.cal_vars['ch2']['units_var'].get() if self.cal_enabled_var.get() else "V"
                header = f"Time (s),AIN0-AIN1 ({units1}),AIN2-AIN3 ({units2})\n"
                self.csv_file.write(header)
                self.root.after(0, self.log, f"Opened log file: {filename}")

            self.root.after(0, self.log, "Configuring differential channels...")
            ljm.eWriteName(self.handle, "AIN0_NEGATIVE_CH", 1)
            ljm.eWriteName(self.handle, "AIN0_RANGE", 0.1)
            ljm.eWriteName(self.handle, "AIN2_NEGATIVE_CH", 3)
            ljm.eWriteName(self.handle, "AIN2_RANGE", 0.1)

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
                scan_counter += len(data_chunk) // num_addresses
                
        except ljm.LJMError as e: self.root.after(0, self.log, f"Stream Error: {e}", "error")
        except ValueError: self.root.after(0, self.log, "Invalid scan rate.", "error")
        finally:
            if self.handle:
                ljm.eStreamStop(self.handle)
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
            ch1_raw_chunk = data_chunk[0::2]
            ch2_raw_chunk = data_chunk[1::2]
            
            ch1_cal_chunk = self.apply_calibration(ch1_raw_chunk, 'ch1')
            ch2_cal_chunk = self.apply_calibration(ch2_raw_chunk, 'ch2')
            
            self.full_data_history_raw_ch1.extend(ch1_cal_chunk)
            self.full_data_history_raw_ch2.extend(ch2_cal_chunk)
            
            data_to_log_ch1, data_to_log_ch2 = [], []

            if filter_enabled:
                s1 = pd.Series(self.full_data_history_raw_ch1)
                ma1 = s1.rolling(window=filter_window, center=True, min_periods=1).mean().dropna()
                self.full_data_history_filtered_ch1 = ma1.tolist()
                self.plot_data_live_ch1.clear(); self.plot_data_live_ch1.extend(self.full_data_history_filtered_ch1[-PLOT_HISTORY_SIZE:])
                
                s2 = pd.Series(self.full_data_history_raw_ch2)
                ma2 = s2.rolling(window=filter_window, center=True, min_periods=1).mean().dropna()
                self.full_data_history_filtered_ch2 = ma2.tolist()
                self.plot_data_live_ch2.clear(); self.plot_data_live_ch2.extend(self.full_data_history_filtered_ch2[-PLOT_HISTORY_SIZE:])

                num_to_log = len(self.full_data_history_filtered_ch1) - (start_scan_number - (filter_window // 2))
                if num_to_log > 0:
                     data_to_log_ch1 = self.full_data_history_filtered_ch1[-num_to_log:]
                     data_to_log_ch2 = self.full_data_history_filtered_ch2[-num_to_log:]
            else:
                data_to_log_ch1 = ch1_cal_chunk
                data_to_log_ch2 = ch2_cal_chunk
                self.plot_data_live_ch1.extend(ch1_cal_chunk)
                self.plot_data_live_ch2.extend(ch2_cal_chunk)

            x_values = range(start_scan_number, start_scan_number + len(ch1_raw_chunk))
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
        try:
            units1 = self.cal_vars['ch1']['units_var'].get() if self.cal_enabled_var.get() else "V"
            units2 = self.cal_vars['ch2']['units_var'].get() if self.cal_enabled_var.get() else "V"
            plot_label = "Moving Average" if self.filter_enabled_var.get() else "Raw Data"
            plot_color = "orange" if self.filter_enabled_var.get() else "blue"

            self.ax_live_ch1.clear()
            self.ax_live_ch1.plot(list(self.x_axis_live_ch1), list(self.plot_data_live_ch1), label=plot_label, color=plot_color)
            self.ax_live_ch1.set_title("Live: AIN0 - AIN1"); self.ax_live_ch1.set_xlabel("Scan Number"); self.ax_live_ch1.set_ylabel(units1)
            self.ax_live_ch1.grid(True); self.ax_live_ch1.legend()
            
            self.ax_live_ch2.clear()
            self.ax_live_ch2.plot(list(self.x_axis_live_ch2), list(self.plot_data_live_ch2), label=plot_label, color=plot_color)
            self.ax_live_ch2.set_title("Live: AIN2 - AIN3"); self.ax_live_ch2.set_xlabel("Scan Number"); self.ax_live_ch2.set_ylabel(units2)
            self.ax_live_ch2.grid(True); self.ax_live_ch2.legend()
            
            self.canvas_live.draw()
        except Exception as e:
            self.log(f"Live Plot Error: {e}", "error")

    def update_history_plots(self):
        try:
            units1 = self.cal_vars['ch1']['units_var'].get() if self.cal_enabled_var.get() else "V"
            units2 = self.cal_vars['ch2']['units_var'].get() if self.cal_enabled_var.get() else "V"
            plot_label = "Moving Average" if self.filter_enabled_var.get() else "Raw Data"
            plot_color = "orange" if self.filter_enabled_var.get() else "blue"
            
            data_ch1 = self.full_data_history_filtered_ch1 if self.filter_enabled_var.get() else self.full_data_history_raw_ch1
            self.ax_history_ch1.clear()
            self.ax_history_ch1.plot(data_ch1, label=plot_label, color=plot_color)
            self.ax_history_ch1.set_title("History: AIN0 - AIN1"); self.ax_history_ch1.set_xlabel("Scan Number"); self.ax_history_ch1.set_ylabel(units1)
            self.ax_history_ch1.grid(True); self.ax_history_ch1.legend()

            data_ch2 = self.full_data_history_filtered_ch2 if self.filter_enabled_var.get() else self.full_data_history_raw_ch2
            self.ax_history_ch2.clear()
            self.ax_history_ch2.plot(data_ch2, label=plot_label, color=plot_color)
            self.ax_history_ch2.set_title("History: AIN2 - AIN3"); self.ax_history_ch2.set_xlabel("Scan Number"); self.ax_history_ch2.set_ylabel(units2)
            self.ax_history_ch2.grid(True); self.ax_history_ch2.legend()
            
            self.canvas_history.draw()
        except Exception as e:
            self.log(f"History Plot Error: {e}", "error")

    def update_device_temperature(self):
        if self.handle:
            threading.Thread(target=self._read_temp_worker, daemon=True).start()
        else:
            self.temperature_status.set("Device Temp: --")
        self.root.after(2000, self.update_device_temperature)

    def _read_temp_worker(self):
        try:
            temp_k = ljm.eReadName(self.handle, "TEMPERATURE_DEVICE_K")
            temp_c = temp_k - 273.15
            self.temperature_status.set(f"Device Temp: {temp_c:.1f} °C")
        except ljm.LJMError:
            self.temperature_status.set("Device Temp: Error")
            
    def log(self, message, level="info"): # ... (unchanged)
        self.log_text.config(state='normal')
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.insert(tk.END, f"[{timestamp}] {message}\n")
        self.log_text.config(state='disabled')
        self.log_text.see(tk.END)

    def on_closing(self): # ... (updated for dual channel cleanup)
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
