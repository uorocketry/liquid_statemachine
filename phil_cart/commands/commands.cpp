#include <Arduino.h>
#include "./commands.h"
#include "../state_machine/state_machine.h"

int getState() {
	Serial.println("Got current state: " + String(targetState->index));
	return targetState->index;
}

void setState(int stateIndex) {
	Serial.println("Setting state to: " +  String(stateIndex));
	stateMachine.transitionTo(stateIndex);
}

LinkedList<Transition*>* getAvailableTransitions() {
	Serial.println("Getting available transitions for state: " + String(targetState->index));
	return stateMachine.stateList->get(targetState->index)->transitions;
}
