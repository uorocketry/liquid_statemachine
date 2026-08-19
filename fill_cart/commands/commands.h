#ifndef COMMANDS_H
#define COMMANDS_H

#include "../state_machine/state_machine.h"

int getState();
bool setState(int stateIndex);
LinkedList<Transition*>* getAvailableTransitions();

#endif
