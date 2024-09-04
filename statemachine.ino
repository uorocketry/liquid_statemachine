#include <StateMachine.h>

StateMachine machine = StateMachine();

// State variables
State *initStateVar = machine.addState(&initState);
State *fillStateVar = machine.addState(&fillState);
State *fireStateVar = machine.addState(&fireState);
State *purgeStateVar = machine.addState(&purgeState);
State *overloadStateVar = machine.addState(&overloadState);
State *abortStateVar = machine.addState(&abortState);

void setup()
{
    // Define state transitions
    initStateVar->addTransition(&transitionInitFill, fillStateVar);
    initStateVar->addTransition(&transitionInitOverload, overloadStateVar);
    initStateVar->addTransition(&transitionInitAbort, abortStateVar);
    fillStateVar->addTransition(&transitionFillFire, fireStateVar);
    fillStateVar->addTransition(&transitionFillAbort, abortStateVar);
    fireStateVar->addTransition(&transitionFirePurge, purgeStateVar);
    fireStateVar->addTransition(&transitionFireAbort, abortStateVar);
    purgeStateVar->addTransition(&transitionPurgeOverload, overloadStateVar);
    purgeStateVar->addTransition(&transitionPurgeAbort, abortStateVar);
    overloadStateVar->addTransition(&transitionOverloadInit, initStateVar);
    overloadStateVar->addTransition(&transitionOverloadAbort, abortStateVar);
    overloadStateVar->addTransition(&transitionOverloadPurge, purgeStateVar);
}

void loop()
{
    machine.run();
}