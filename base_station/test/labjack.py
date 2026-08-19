# test_internal_signal.py
from labjack import ljm
import time
import math

# --- Use the same IP as your GUI ---
identifier = "192.168.8.51"

try:
    handle = ljm.openS("T7", "ETHERNET", identifier)
    print("Connected to LabJack.")

    # --- Configure AIN0 for differential reading with AIN1 ---
    ljm.eWriteName(handle, "AIN0_NEGATIVE_CH", 1)
    ljm.eWriteName(handle, "AIN0_RANGE", 10.0)
    print("AIN0 configured for differential measurement (AIN0-AIN1).")

    print("\nGenerating a sine wave on DAC0. Press Ctrl+C to stop.")
    print("----------------------------------------------------")
    print("Timestamp (s) | DAC0 Output (V) | Differential Reading (V)")
    
    start_time = time.time()
    while True:
        # Generate a sine wave from 0V to 2.5V
        elapsed_time = time.time() - start_time
        voltage_to_write = 1.25 + 1.25 * math.sin(2 * math.pi * 0.5 * elapsed_time) # 0.5 Hz sine wave
        
        # Write the voltage to DAC0
        ljm.eWriteName(handle, "DAC0", voltage_to_write)
        
        # Read the differential voltage
        diff_voltage = ljm.eReadName(handle, "AIN0")
        
        print(f"{elapsed_time:13.2f} | {voltage_to_write:15.4f} | {diff_voltage:24.4f}")
        time.sleep(0.1)

except ljm.LJMError as e:
    print(f"LJM Error: {e}")
except KeyboardInterrupt:
    print("\nStopping test.")
finally:
    if 'handle' in locals():
        # IMPORTANT: Clean up and set AIN0 back to default
        ljm.eWriteName(handle, "AIN0_NEGATIVE_CH", 199)
        ljm.eWriteName(handle, "DAC0", 0) # Turn DAC off
        ljm.close(handle)
        print("Cleaned up and disconnected.")
