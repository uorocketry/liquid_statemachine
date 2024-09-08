#include <StateMachine.h>
#include <ArduinoJson.h>

StateMachine machine = StateMachine();

// State variables
State *initStateVar = machine.addState(&initState);
State *fillStateVar = machine.addState(&fillState);
State *fireStateVar = machine.addState(&fireState);
State *purgeStateVar = machine.addState(&purgeState);
State *overloadStateVar = machine.addState(&overloadState);
State *abortStateVar = machine.addState(&abortState);

enum StateEnum
{
    INIT,
    FILL,
    FIRE,
    PURGE,
    OVERLOAD,
    ABORT
};

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
    if (Serial.available())
    {
        JsonDocument doc;
        doc = Serial.readStringUntil('\n');
        DeserializationError error = deserializeJson(doc, Serial);
        if (error)
        {
            Serial.print(F("deserializeJson() failed: "));
            Serial.println(error.f_str());
            return;
        }
        processJson(doc);
    }
    machine.run();
}

void processJson(JsonDocument doc)
{
    StateEnum state = doc["state"];
    switch (state)
    {
    case INIT:
        machine.transitionTo(initStateVar);
        break;
    case FILL:
        machine.transitionTo(fillStateVar);
        break;
    case FIRE:
        machine.transitionTo(fireStateVar);
        break;
    case PURGE:
        machine.transitionTo(purgeStateVar);
        break;
    case OVERLOAD:
        machine.transitionTo(overloadStateVar);
        break;
    case ABORT:
        machine.transitionTo(abortStateVar);
        break;
    default:
        break;
    }
}
// state functions
void initState()
{
    Serial.println("Init state");
}

void fillState()
{
    Serial.println("Fill state");
}

void fireState()
{
    Serial.println("Fire state");
}

void purgeState()
{
    Serial.println("Purge state");
}

void overloadState()
{
    Serial.println("Overload state");
}

void abortState()
{
    Serial.println("Abort state");
}

// transition functions
// abort transitions
bool transitionInitAbort()
{
    return true;
}
bool transitionFillAbort()
{
    return true;
}
bool transitionFireAbort()
{
    return true;
}
bool transitionPurgeAbort()
{
    return true;
}
bool transitionOverloadAbort()
{
    return true;
}

// overload transitions
bool transitionInitOverload()
{
    return true;
}
bool transitionOverloadInit()
{
    return true;
}
bool transitionOverloadPurge()
{
    return true;
}

// init transitions
bool transitionInitFill()
{
    return true;
}

// fill transitions
bool transitionFillFire()
{
    return true;
}

// fire transitions
bool transitionFirePurge()
{
    return true;
}

// purge transitions
bool transitionPurgeOverload()
{
    return true;
}
