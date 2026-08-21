#ifndef COMMANDS_H
#define COMMANDS_H

#include "../state_machine/state_machine.h"

int getState();
int getStateCount();
const char* getStateName(int stateIndex);
bool setState(int stateIndex);
LinkedList<Transition*>* getAvailableTransitions();

#endif
