# sm_eth.py

import socket
from threading import Thread
from enum import IntEnum

# Using IntEnum for robust state definition. This acts like an integer but provides more clarity.
class State(IntEnum):
    VALVE_TESTING = 0
    INIT = 1
    FUEL_FILL = 2
    LOX_FILL = 3
    FIRE = 4
    PURGE = 5
    OVERLOAD = 6
    ABORT = 7
    # Custom commands for getting status
    GET_STATE = 255
    GET_TRANSITIONS = 254

# A dictionary to map the enum members to their display names
STATE_NAMES = {
    State.VALVE_TESTING: "VALVE TESTING",
    State.INIT: "INIT",
    State.FUEL_FILL: "FUEL FILL",
    State.LOX_FILL: "LOX FILL",
    State.FIRE: "FIRE",
    State.PURGE: "PURGE",
    State.OVERLOAD: "OVERLOAD",
    State.ABORT: "ABORT"
}

# The states that have corresponding buttons on the GUI
UI_STATES = [State.VALVE_TESTING, State.INIT, State.FUEL_FILL, State.LOX_FILL, State.FIRE, State.PURGE, State.OVERLOAD, State.ABORT]

# --- Network Configuration ---
HOST = "192.168.1.50"
#HOST = "127.0.0.1" # Changed for local testing
PORT = 80
TIMEOUT = 5 # seconds

def _send_and_get_response_blocking(command: int) -> bytes:
    """
    Handles the core blocking socket communication. Connects, sends, and receives.
    This is the base function used by both sync and async wrappers.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(TIMEOUT)
        try:
            # Helper function to ensure all required bytes are read
            def read_exact(n):
                result = b''
                while len(result) < n:
                    chunk = s.recv(n - len(result))
                    if not chunk:
                        raise ConnectionError("Socket connection broken")
                    result += chunk
                return result

            s.connect((HOST, PORT))
            s.sendall(bytes([command])) # Use sendall for reliability
            
            size_byte = read_exact(1)
            if not size_byte: return b'' # Handle empty response
            
            size = size_byte[0]
            response = read_exact(size)
            return response
            
        except socket.timeout:
            print(f"Error: Connection to {HOST}:{PORT} timed out.")
            return b''
        except ConnectionRefusedError:
            print(f"Error: Connection to {HOST}:{PORT} was refused.")
            return b''
        except Exception as e:
            print(f"An unexpected network error occurred: {e}")
            return b''

def send_and_get_response(command: int) -> bytes:
    """
    Synchronous (blocking) function. Sends a command and waits for the response.
    Ideal for scripts and testing.
    """
    return _send_and_get_response_blocking(command)

def send_async(command: int, callback):
    """
    Asynchronous (non-blocking) function. Runs the network request in a new thread.
    The callback is executed with the response once it's received. Ideal for GUIs.
    """
    def target_func():
        response = _send_and_get_response_blocking(command)
        # The callback might update a GUI, so it's good practice to ensure
        # it's called, even with an empty response on failure.
        callback(response)

    Thread(target=target_func, daemon=True).start()