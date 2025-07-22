from sm_eth import *
import tkinter as tk

window = tk.Tk()

# global font size
import tkinter.font as font
font.nametofont("TkDefaultFont").configure(size=15)

state_label = tk.StringVar()
state_label.set("Current state: INIT")
tk.Label(window, textvariable=state_label).pack(pady = 10)


def make_button(state):
	text = state_number_to_string(state)
	command = lambda: send(state)
	b = tk.Button(text=text, command=command)
	b.pack(pady = 10)
	return b

buttons = [make_button(s) for s in STATES]


def update():
	global state_label

	print("GUI: updating")

	state = send(255)[0]
	state_label.set(f"Current state: {state_number_to_string(state)}")

	transitions = send(254)
	for s, b in enumerate(buttons):
		b["state"] = "active" if s in transitions else "disable"

	window.after(100, update)
window.after(100, update)


window.mainloop()
