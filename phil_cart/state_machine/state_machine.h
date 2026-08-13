#ifndef STATE_MACHINE_STATES_H
#define STATE_MACHINE_STATES_H

#include <StateMachine.h>

// The global state machine instance
extern StateMachine stateMachine;

// The current state of the system
extern State *targetState;

// States are identified by the order in which they are added. 
// This should match the base station's definitions of states
extern State *ValveTesting;
extern State *Init;
extern State *FuelFill;
extern State *LoxFill;
extern State *Fire;
extern State *Purge;
extern State *Overload;
extern State *Abort;

void ValveTestingStateHandler();
void InitStateHandler();
void FuelFillStateHandler();
void LoxFillStateHandler();
void FireStateHandler();
void PurgeStateHandler();
void OverloadStateHandler();
void AbortStateHandler();

void defineStateTransitions();

#endif
