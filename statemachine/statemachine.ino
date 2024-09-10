#include <StateMachine.h>
#include <ArduinoJson.h>
#include <P1AM.h>

StateMachine machine = StateMachine();

// // pins
// BV_1001_P_X
// BV_1004_P_O
// BV_1001_P_X
// BV_1002_P_O

const int BV_1001 = 0;
const int BV_1002 = 1;
const int BV_1004 = 2;

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
    Serial.begin(9600);
    while (!P1.init())
    {
        ; // wait for base to initialize
    }

    // Define state transitions
    initStateVar->addTransition(true, fillStateVar);
    initStateVar->addTransition(true, overloadStateVar);
    initStateVar->addTransition(true, abortStateVar);
    fillStateVar->addTransition(true, fireStateVar);
    fillStateVar->addTransition(true, abortStateVar);
    fireStateVar->addTransition(true, purgeStateVar);
    fireStateVar->addTransition(true, abortStateVar);
    purgeStateVar->addTransition(true, overloadStateVar);
    purgeStateVar->addTransition(true, abortStateVar);
    overloadStateVar->addTransition(true, initStateVar);
    overloadStateVar->addTransition(true, abortStateVar);
    overloadStateVar->addTransition(true, purgeStateVar);
}

void loop()
{
    if (P1.isBaseActive() == false)
    {
        Serial.println("Re-init() the base modules.");
        delay(10);
        while (!P1.init())
        {
            Serial.println("Waiting for 24V");
            delay(1000);
        }
    }

    if (Serial.available())
    {
        String input = Serial.readStringUntil('\n');
        JsonDocument<200> doc;
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
    int stateValue = doc["state"];
    StateEnum state = static_cast<StateEnum>(stateValue);
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
    Serial
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