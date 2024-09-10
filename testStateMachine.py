# test statemachine
import serial
import json
import time

serial_port = '/dev/ttyUSB0'
baud_rate = 9600
ser = serial.Serial(serial_port, baud_rate)

def send_state(state_number):
    message = json.dumps({"state": state_number})
    
    # Send the JSON data over serial
    ser.write((message + '\n').encode('utf-8'))
    print(f"Sent: {message}")

try:
    #INIT, FILL, FIRE, PURGE, OVERLOAD, ABORT
    states = [0, 1, 2, 3, 4, 5]
    for state in states:
        send_state(state)
        time.sleep(10)

finally:
    print("Closing connection")
    ser.close()
