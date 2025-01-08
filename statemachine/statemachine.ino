#include <P1AM.h>
#include <ArduinoJson.h>
#include <StateMachine.h>
#include <TaskManagerIO.h>

// ethernet stuff
#include <SPI.h>
#include <Ethernet.h>

byte mac[] = { 0x60, 0x52, 0xD0, 0x08, 0x17, 0x38 };
IPAddress ip(192,168,1,30);
EthernetServer server(80);

StateMachine machine = StateMachine();

// define valve slot
const int BV_1001 = 1;
const int BV_1002 = 2;
const int BV_1004 = 3;
int BV_1001_state = LOW;
int BV_1002_state = LOW;
int BV_1004_state = LOW;

// STATE LEDS
const int LED_INIT = 4;
const int LED_FILL = 5;
const int LED_FIRE = 6;
const int LED_PURGE = 7;
const int LED_OVERLOAD = 8;
const int LED_ABORT = 9;

// State variables
State *Init     = machine.addState(&initState);
State *Fill     = machine.addState(&fillState);
State *Fire     = machine.addState(&fireState);
State *Purge    = machine.addState(&purgeState);
State *Overload = machine.addState(&overloadState);
State *Abort    = machine.addState(&abortState);
// must be the same order as variables above are added
State *states[] = {
    Init,      // 0
    Fill,      // 1
    Fire,      // 2
    Purge,     // 3
    Overload,  // 4
    Abort      // 5
};

State *targetState = 0;

#define ADD_TRANSITION(start, end) start->addTransition([](){ return targetState == end; }, end)

void setup()
{
    Serial.begin(9600);
    while (!Serial); // wait for serial port to connect. Needed for native USB port only
    Serial.println("\nstarting arduino");

    Ethernet.init(5);
    Ethernet.begin(mac, ip);

    // Check for Ethernet hardware present
    if (Ethernet.hardwareStatus() == EthernetNoHardware) {
        Serial.println("Ethernet shield was not found.  Sorry, can't run without hardware. :(");
    }
    if (Ethernet.linkStatus() == LinkOFF) {
        Serial.println("Ethernet cable is not connected.");
    }

    // start the server
    server.begin();
    Serial.print("server is at ");
    Serial.println(Ethernet.localIP());

    // while (!P1.init())
    // {
    //     ; // wait for base to initialize
    // }

    // Set the state LED pins as outputs
    // pinMode(LED_INIT, OUTPUT);
    // pinMode(LED_FILL, OUTPUT);
    // pinMode(LED_FIRE, OUTPUT);
    // pinMode(LED_PURGE, OUTPUT);
    // pinMode(LED_OVERLOAD, OUTPUT);
    // pinMode(LED_ABORT, OUTPUT);

    // Define state transitions
    ADD_TRANSITION(Init, Fill);
    ADD_TRANSITION(Init, Overload);
    ADD_TRANSITION(Init, Abort);

    ADD_TRANSITION(Fill, Fire);
    ADD_TRANSITION(Fill, Abort);

    ADD_TRANSITION(Fire, Purge);
    ADD_TRANSITION(Fire, Abort);

    ADD_TRANSITION(Purge, Overload);
    ADD_TRANSITION(Purge, Abort);

    ADD_TRANSITION(Overload, Init);
    ADD_TRANSITION(Overload, Abort);
    ADD_TRANSITION(Overload, Purge);
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
    processCommand();
    taskManager.runLoop();
    machine.run();
}

void processCommand()
{
    EthernetClient client = server.available();
    if (client) {
        while (client.connected()) {
            if (client.available()) {
                int r = client.read();
                if (r == 255) client.write(machine.currentState);
                else         { targetState = states[r]; client.write(r); }
            }
        }
    }
}

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
void fireState()
{
    if (machine.executeOnce)
    {
        Serial.println("Fire state");
        pinMode(LED_FIRE, HIGH);
        taskManager.schedule(onceMillis(10000), []() { targetState = Purge; });
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
