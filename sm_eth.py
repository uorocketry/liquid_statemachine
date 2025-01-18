# connect to the arduino over ethernet

import time
import socket

INIT, FILL, FIRE, PURGE, OVERLOAD, ABORT = 0, 1, 2, 3, 4, 5
STATES = [INIT, FILL, FIRE, PURGE, OVERLOAD, ABORT]
def state_number_to_string(state_number):
	return ["INIT", "FILL", "FIRE", "PURGE", "OVERLOAD", "ABORT"][state_number]

HOST = "192.168.1.30"
PORT = 80
def send(command):
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
	return response
