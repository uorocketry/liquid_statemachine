#include <StateMachine.h>
#include <ArduinoJson.h>
#include <P1AM.h>
#include <Ethernet.h>
#include <SPI.h>

StateMachine machine = StateMachine();
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED};

// Set the static IP address to use if the DHCP fails to assign
IPAddress ip(192, 168, 0, 177);
IPAddress myDns(192, 168, 0, 1);

// Initialize the Ethernet client library
// with the IP address and port of the server
// that you want to connect to (port 80 is default for HTTP):
EthernetClient client;

// define valve slot
const int BV_1001 = 1;
const int BV_1002 = 2;
const int BV_1004 = 3;
int BV_1001_state = LOW;
int BV_1002_state = LOW;
int BV_1004_state = LOW;
int targetState = -1;

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
    processJson();
    machine.run();
}

void processJson()
{
    // switch to ethernet after testing statemachine logic
    if (Serial.available())
    {
        String input = Serial.readStringUntil('\n');
        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, Serial);
        if (!error)
        {
            int stateValue = doc["state"];
            targetState = stateValue;
        }
        else
        {
            Serial.print(F("deserializeJson() failed: "));
            Serial.println(error.f_str());
            return;
        }
    }
}
// init
void initState()
{
    Serial.println("Init state");
}

bool transitionInitFill()
{
    if (targetState == 1)
    {
        return true;
    }
    return false;
}

bool transitionInitOverload()
{
    if (targetState == 4)
    {
        return true;
    }
    return false;
}

bool transitionInitAbort()
{
    if (targetState == 5)
    {
        return true;
    }
    return false;
}

// fill
void fillState()
{
    Serial.println("Fill state");
    BV_1002_state = HIGH;
    BV_1004_state = HIGH;
    P1.writeDiscrete(BV_1001_state, BV_1001, 1);
    P1.writeDiscrete(BV_1002_state, BV_1004, 1);
    P1.writeDiscrete(BV_1004_state, BV_1002, 1);
}

bool transitionFillFire()
{
    // check if the targetState is 2 and valves are in the correct position
    if (targetState == 2 && BV_1001_state == LOW && BV_1002_state == HIGH && BV_1004_state == HIGH)
    {
        return true;
    }
    return false;
}

bool transitionFillAbort()
{
    if (targetState == 5)
    {
        return true;
    }
    return false;
}

// fire
void fireState()
{
    Serial.println("Fire state");
}

bool transitionFirePurge()
{
    if (targetState == 3)
    {
        return true;
    }
    return false;
}

bool transitionFireAbort()
{
    if (targetState == 5)
    {
        return true;
    }
    return false;
}

// purge
void purgeState()
{
    Serial.println("Purge state");
}

bool transitionPurgeOverload()
{
    if (targetState == 4)
    {
        return true;
    }
    return false;
}

bool transitionPurgeAbort()
{
    if (targetState == 5)
    {
        return true;
    }
    return false;
}

// overload
void overloadState()
{
    Serial.println("Overload state");
}

bool transitionOverloadInit()
{
    if (targetState == 1)
    {
        return true;
    }
}

bool transitionOverloadAbort()
{
    if (targetState == 5)
    {
        return true;
    }
}

bool transitionOverloadPurge()
{
    if (targetState == 3)
    {
        return true;
    }
}

// abort
void abortState()
{
    Serial.println("Abort state");
}