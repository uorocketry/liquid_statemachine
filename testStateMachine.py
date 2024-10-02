# test statemachine
# this doesn't test overload or abort yet, only init -> fill -> fire -> purge

# usage: python3 testStateMachine.py baudrate
# baudrate defaults to 9600 if not specified

import serial
import json
import time
import sys

INIT, FILL, FIRE, PURGE, OVERLOAD, ABORT = 0, 1, 2, 3, 4, 5
def state_number_to_string(state_number):
	return ["INIT", "FILL", "FIRE", "PURGE", "OVERLOAD", "ABORT"][state_number]

def send_state(state_number):
    message = json.dumps({"state": state_number})
    ser.write((message + '\n').encode('utf-8'))
    print(f"Sent: {state_number_to_string(state_number)} (message: {message})")

def should_work(state_number):
	send_state(state_number)
	print(f"Should change to state {state_number_to_string(state_number)}")
	print()
	time.sleep(10)

def should_fail(state_number):
	send_state(state_number)
	print(f"Shouldn't change to state {state_number_to_string(state_number)}")
	print()
	time.sleep(10)

serial_port = '/dev/ttyUSB0'
baud_rate = 9600 if len(sys.argv) == 1 else int(sys.argv[1])
ser = serial.Serial(serial_port, baud_rate)
print("Connection opened")

print("Should be in the init state")
print()

try:
	should_fail(FIRE)
	should_fail(PURGE)

	should_work(FILL)
	should_fail(INIT)
	should_fail(PURGE)

	should_work(FIRE)
	should_fail(INIT)
	should_fail(FILL)

	should_work(PURGE)

finally:
	print("Closing connection")
	ser.close()
