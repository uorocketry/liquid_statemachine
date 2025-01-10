# test statemachine
# this doesn't test overload or abort yet, only init -> fill -> fire -> purge, and doesn't test the fire -> purge auto timing

import sys
import json
import time
import serial
import socket

INIT, FILL, FIRE, PURGE, OVERLOAD, ABORT = 0, 1, 2, 3, 4, 5
def state_number_to_string(state_number):
	return ["INIT", "FILL", "FIRE", "PURGE", "OVERLOAD", "ABORT"][state_number]

HOST = "192.168.1.30"
PORT = 80
def send(command):
	with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
		s.connect((HOST, PORT))
		s.send(bytes([command]))
		size = s.recv(1)[0]
		response = s.recv(size)
	return response

failing = False
def fail(message):
	global failing
	failing = True
	print("fail: " + message)

def should_work(target):
	state = send(255)[0]
	send(target)
	time.sleep(0.5)
	new_state = send(255)[0]
	if new_state != target:
		fail(f"{state_number_to_string(state)} should switch to {state_number_to_string(target)}, but remains {state_number_to_string(new_state)}")

def should_fail(target):
	state = send(255)[0]
	send(target)
	time.sleep(0.5)
	new_state = send(255)[0]
	if new_state == target:
		fail(f"{state_number_to_string(state)} should not switch to {state_number_to_string(target)}")

def test():
	global failing
	failing = False

	should_fail(FIRE)
	should_fail(PURGE)

	should_work(FILL)
	should_fail(INIT)
	should_fail(PURGE)

	should_work(FIRE)
	should_fail(INIT)
	should_fail(FILL)

	should_work(PURGE)
	should_fail(INIT)
	should_fail(FILL)
	should_fail(FIRE)

	should_work(ABORT)

	if not failing:
		print("all tests pass")

def get_transitions():
	return send(254)

test()

# print(get_transitions())
