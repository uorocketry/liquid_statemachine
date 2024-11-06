#include <StateMachine.h>
#include <ArduinoJson.h>
// #include <P1AM.h>

StateMachine machine = StateMachine();

// define valve slot
const int BV_1001 = 1;
const int BV_1002 = 2;
const int BV_1004 = 3;
int BV_1001_state = LOW;
int BV_1002_state = LOW;
int BV_1004_state = LOW;
int targetState = -1;

// STATE LEDS
const int LED_INIT = 4;
const int LED_FILL = 5;
const int LED_FIRE = 6;
const int LED_PURGE = 7;
const int LED_OVERLOAD = 8;
const int LED_ABORT = 9;

// State variables
State *initStateVar = machine.addState(&initState);
State *fillStateVar = machine.addState(&fillState);
State *fireStateVar = machine.addState(&fireState);
State *purgeStateVar = machine.addState(&purgeState);
State *overloadStateVar = machine.addState(&overloadState);
State *abortStateVar = machine.addState(&abortState);

#define ADD_TRANSITION(start, end, target) start->addTransition([](){ return targetState == target; }, end)

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
    // while (!P1.init())
    // {
    //     ; // wait for base to initialize
    // }

    // Set the state LED pins as outputs
    pinMode(LED_INIT, OUTPUT);
    pinMode(LED_FILL, OUTPUT);
    pinMode(LED_FIRE, OUTPUT);
    pinMode(LED_PURGE, OUTPUT);
    pinMode(LED_OVERLOAD, OUTPUT);
    pinMode(LED_ABORT, OUTPUT);

    // Define state transitions
    ADD_TRANSITION(initStateVar, fillStateVar, FILL);
    ADD_TRANSITION(initStateVar, overloadStateVar, OVERLOAD);
    ADD_TRANSITION(initStateVar, abortStateVar, ABORT);

    ADD_TRANSITION(fillStateVar, fireStateVar, FIRE);
    ADD_TRANSITION(fillStateVar, abortStateVar, ABORT);

    ADD_TRANSITION(fireStateVar, purgeStateVar, PURGE);
    ADD_TRANSITION(fireStateVar, abortStateVar, ABORT);

    ADD_TRANSITION(purgeStateVar, overloadStateVar, OVERLOAD);
    ADD_TRANSITION(purgeStateVar, abortStateVar, ABORT);

    ADD_TRANSITION(overloadStateVar, initStateVar, INIT);
    ADD_TRANSITION(overloadStateVar, abortStateVar, ABORT);
    ADD_TRANSITION(overloadStateVar, purgeStateVar, PURGE);
}

void loop()
{
    // if (P1.isBaseActive() == false)
    // {
    //     Serial.println("Re-init() the base modules.");
    //     delay(10);
    //     while (!P1.init())
    //     {
    //         Serial.println("Waiting for 24V");
    //         delay(60);
    //     }
    // }
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
        DeserializationError error = deserializeJson(doc, input);
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

// receive http request and get json body

// init
void initState()
{
    if (machine.executeOnce)
    {
        Serial.println("Init state");
        pinMode(LED_INIT, HIGH);
    }
}

// fill
void fillState()
{
    if (machine.executeOnce)
    {
        Serial.println("Fill state");
        pinMode(LED_FILL, HIGH);
        BV_1002_state = HIGH;
        BV_1004_state = HIGH;
    }
    // P1.writeDiscrete(BV_1001_state, BV_1001, 1);
    // P1.writeDiscrete(BV_1002_state, BV_1004, 1);
    // P1.writeDiscrete(BV_1004_state, BV_1002, 1);
}

// fire
unsigned long purgeSwitchTime;
void fireState()
{
    if (machine.executeOnce)
    {
        Serial.println("Fire state");
        pinMode(LED_FIRE, HIGH);
        // switch to purge in 10 seconds (10,000 ms)
        purgeSwitchTime = millis() + 10000;
    }
    else if (millis() > purgeSwitchTime)
    {
        targetState = PURGE;
    }
}

// purge
void purgeState()
{
    if (machine.executeOnce)
    {
        Serial.println("Purge state");
        pinMode(LED_PURGE, HIGH);
    }
}

// overload
void overloadState()
{
    if (machine.executeOnce)
    {
        Serial.println("Overload state");
        pinMode(LED_OVERLOAD, HIGH);
    }
}

// abort
void abortState()
{
    if (machine.executeOnce)
    {
        Serial.println("Abort state");
        pinMode(LED_ABORT, HIGH);
    }
}
