#include <Arduino.h>
#include "./commands.h"
#include "../state_machine/state_machine.h"

namespace {
const char* STATE_NAMES[] = {
	"Valve testing", "Initialize", "Fuel fill", "LOX fill",
	"Fire", "Purge", "Overload", "Abort"
};
}

int getState() {
	// The library uses -1 until its first run, at which point it enters state 0.
	const int currentState = stateMachine.currentState < 0 ? 0 : stateMachine.currentState;
	Serial.println("Got current state: " + String(currentState));
	return currentState;
}

int getStateCount() {
	return sizeof(STATE_NAMES) / sizeof(STATE_NAMES[0]);
}

const char* getStateName(int stateIndex) {
	return stateIndex >= 0 && stateIndex < getStateCount() ? STATE_NAMES[stateIndex] : "Unknown";
}

bool setState(int stateIndex) {
	Serial.println("Setting state to: " +  String(stateIndex));
	if (stateIndex < 0 || stateIndex >= stateMachine.stateList->size()) {
		Serial.println("Rejected invalid state index");
		return false;
	}

	LinkedList<Transition*>* transitions = getAvailableTransitions();
	for (int i = 0; i < transitions->size(); i++) {
		if (transitions->get(i)->stateNumber == stateIndex) {
			// StateMachine::run() applies the validated request on the next loop.
			targetState = stateMachine.stateList->get(stateIndex);
			return true;
		}
	}

	Serial.println("Rejected unavailable transition");
	return false;
}

LinkedList<Transition*>* getAvailableTransitions() {
	const int currentState = stateMachine.currentState < 0 ? 0 : stateMachine.currentState;
	Serial.println("Getting available transitions for state: " + String(currentState));
	return stateMachine.stateList->get(currentState)->transitions;
}
