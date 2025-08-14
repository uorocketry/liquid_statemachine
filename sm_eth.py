# connect to the arduino over ethernet

import socket
from threading import Thread

VALVE_TESTING, INIT, FUEL_FILL, LOX_FILL, FIRE, PURGE, OVERLOAD, ABORT = 0, 1, 2, 3, 4, 5, 6, 7
STATES = [VALVE_TESTING, INIT, FUEL_FILL, LOX_FILL, FIRE, PURGE, OVERLOAD, ABORT]
def state_number_to_string(state_number):
	return ["VALVE_TESTING", "INIT", "FUEL FILL", "LOX FILL", "FIRE", "PURGE", "OVERLOAD", "ABORT"][state_number]

HOST = "192.168.1.30"
PORT = 80
def send_(command, callback):
	with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:

		# read n bytes
		# recv returns *at most* n bytes, but could return as little as 1
		def read(n):
			result = b''
			while n > 0:
				new = s.recv(n)
				result += new
				n -= len(new)
			return result

		s.connect((HOST, PORT))
		s.send(bytes([command]))
		size = read(1)[0]
		response = read(size)
	callback(response)

# run in a new thread so it doesn't block
def send(command, callback):
	Thread(target=send_, args=(command,callback)).start()
