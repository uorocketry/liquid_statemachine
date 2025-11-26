#ifndef COMMANDS_H
#define COMMANDS_H

#include "../state_machine/state_machine.h"

// Commands that can be received by the base station
enum Command {
	GetState = 1,
	SetState = 2,
	GetAvailableTransitions = 3,
};

int getState();
void setState(int stateIndex);
LinkedList<Transition*>* getAvailableTransitions();

#endif
