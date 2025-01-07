import socket

HOST = "192.168.1.30"
PORT = 80

def send(command):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.connect((HOST, PORT))
        s.send(bytes([command]))
        data = s.recv(1)
        print(int(data[0]));

# send(0..5) # set state
# send(255) # query state
