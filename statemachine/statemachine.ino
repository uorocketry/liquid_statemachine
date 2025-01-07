#include <StateMachine.h>
#include <ArduinoJson.h>
#include <TaskManagerIO.h>
#include <P1AM.h>

// ethernet stuff
#include <SPI.h>
#include <Ethernet.h>

byte mac[] = { 0x60, 0x52, 0xD0, 0x08, 0x17, 0x38 };
IPAddress ip(192,168,1,30);
IPAddress gateway(192,168,1,1);
IPAddress subnet(255,255,255,0);

// 10.192.87.89

EthernetServer server(80);

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

enum StateEnum
{
    INIT,
    FILL,
    FIRE,
    PURGE,
    OVERLOAD,
    ABORT
};

#define INIT_VAR initStateVar
#define FILL_VAR fillStateVar
#define FIRE_VAR fireStateVar
#define PURGE_VAR purgeStateVar
#define OVERLOAD_VAR overloadStateVar
#define ABORT_VAR abortStateVar

#define ADD_TRANSITION(start, end) start ## _VAR ->addTransition([](){ return targetState == end; }, end ## _VAR)

void setup()
{
    Serial.begin(9600);
    while (!Serial); // wait for serial port to connect. Needed for native USB port only

    Ethernet.init(5);

      // start the Ethernet connection and the server:
    Ethernet.begin(mac, ip, gateway, gateway, subnet);
    Serial.println(Ethernet.localIP());
    Serial.println(Ethernet.gatewayIP());

    // Check for Ethernet hardware present
    if (Ethernet.hardwareStatus() == EthernetNoHardware) {
      Serial.println("Ethernet shield was not found.  Sorry, can't run without hardware. :(");
      while (true) {
        delay(1); // do nothing, no point running without Ethernet hardware
      }
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
    ADD_TRANSITION(INIT, FILL);
    ADD_TRANSITION(INIT, OVERLOAD);
    ADD_TRANSITION(INIT, ABORT);

    ADD_TRANSITION(FILL, FIRE);
    ADD_TRANSITION(FILL, ABORT);

    ADD_TRANSITION(FIRE, PURGE);
    ADD_TRANSITION(FIRE, ABORT);

    ADD_TRANSITION(PURGE, OVERLOAD);
    ADD_TRANSITION(PURGE, ABORT);

    ADD_TRANSITION(OVERLOAD, INIT);
    ADD_TRANSITION(OVERLOAD, ABORT);
    ADD_TRANSITION(OVERLOAD, PURGE);
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
                  if (INIT <= r && r <= ABORT) client.write(targetState = r);
                  if (r == 255) client.write(machine.currentState);
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
        taskManager.schedule(onceMillis(10000), []() { targetState = PURGE; });
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
