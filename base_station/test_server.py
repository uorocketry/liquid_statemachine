# test_server.py
# A fake server that mimics the Arduino state machine to test the GUI.
# Run this script first, then run gui.py in a separate terminal.

import socket
import time
from sm_eth import State, STATE_NAMES

class FakeArduinoServer:
    def __init__(self, host='0.0.0.0', port=80):
        self.host = host
        self.port = port
        self.server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        
        # --- Mimic the State Machine Logic from the Arduino Code ---
        self.current_state = State.INIT
        self.transitions = {
            State.VALVE_TESTING: [State.INIT, State.OVERLOAD, State.ABORT],
            State.INIT:          [State.FUEL_FILL, State.OVERLOAD, State.ABORT],
            State.FUEL_FILL:     [State.LOX_FILL, State.ABORT],
            State.LOX_FILL:      [State.FIRE, State.ABORT],
            State.FIRE:          [State.PURGE, State.ABORT], # Note: Fire auto-transitions to Purge
            State.PURGE:         [State.OVERLOAD, State.ABORT, State.INIT], # Added INIT for looping tests
            State.OVERLOAD:      [State.INIT, State.ABORT, State.PURGE],
            State.ABORT:         [State.INIT] # Allow resetting from Abort
        }
        print("Fake Arduino Server initialized.")

    def run(self):
        self.server_socket.bind((self.host, self.port))
        self.server_socket.listen(1)
        print(f"Server listening on {self.host}:{self.port}...")
        print(f"Initial state is {STATE_NAMES[self.current_state]}")

        while True:
            try:
                conn, addr = self.server_socket.accept()
                print(f"\n--- Connection from {addr} ---")
                self.handle_client(conn)
            except KeyboardInterrupt:
                print("\nServer is shutting down.")
                break
            except Exception as e:
                print(f"An error occurred: {e}")
                break
        self.server_socket.close()

    def handle_client(self, conn):
        with conn:
            try:
                command_byte = conn.recv(1)
                if not command_byte:
                    return

                command = int.from_bytes(command_byte, 'big')
                response_payload = b''

                if command == State.GET_STATE.value:
                    print(f"Received GET_STATE command.")
                    response_payload = bytes([self.current_state])
                    print(f"Responding with current state: {STATE_NAMES[self.current_state]}")

                elif command == State.GET_TRANSITIONS.value:
                    print(f"Received GET_TRANSITIONS command.")
                    valid_next_states = self.transitions.get(self.current_state, [])
                    response_payload = bytes(valid_next_states)
                    print(f"Responding with valid transitions: {[STATE_NAMES.get(State(s), 'UNKNOWN') for s in valid_next_states]}")

                else: # This is a state change request
                    try:
                        requested_state = State(command)
                        print(f"Received state change request to {STATE_NAMES[requested_state]}")
                        
                        # Check if the transition is valid
                        if requested_state in self.transitions.get(self.current_state, []):
                            print(f"Transition from {STATE_NAMES[self.current_state]} to {STATE_NAMES[requested_state]} is VALID.")
                            self.current_state = requested_state
                            print(f"State changed to -> {STATE_NAMES[self.current_state]}")
                            
                            # --- Special simulation logic for FIRE state ---
                            if self.current_state == State.FIRE:
                                print("--- SIMULATING 5 SECOND BURN ---")
                                time.sleep(5)
                                self.current_state = State.PURGE
                                print(f"--- BURN COMPLETE. Auto-transitioning to {STATE_NAMES[self.current_state]} ---")
                        else:
                            print(f"Transition from {STATE_NAMES[self.current_state]} to {STATE_NAMES[requested_state]} is ILLEGAL. State unchanged.")
                        
                        # The client expects a 1-byte acknowledgment for state changes
                        response_payload = bytes([command])

                    except ValueError:
                        print(f"Received unknown command: {command}")
                        response_payload = b'\xff' # Send back an error byte

                # --- Send the size-prefixed response ---
                response = bytes([len(response_payload)]) + response_payload
                conn.sendall(response)
                print("Response sent.")

            except Exception as e:
                print(f"Error handling client: {e}")
            finally:
                print("--- Connection closed ---")


if __name__ == "__main__":
    server = FakeArduinoServer()
    server.run()