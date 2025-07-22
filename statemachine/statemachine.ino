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
const int BV_1008 = 4;
const int BV_1009 = 6;
const int BV_1014 = 7;

// Set pilot valves to closed state
int BV_1001_state = LOW;
int BV_1002_state = LOW;
int BV_1004_state = LOW;
int BV_1008_state = LOW;
int BV_1009_state = LOW;
int BV_1014_state = LOW;


// State variables
State *Init      = machine.addState(&initState);      // 0
State *Fuel_Fill = machine.addState(&FuelFillState);  // 1
State *LOX_Fill  = machine.addState(&LOXFillState);   // 2
State *Fire      = machine.addState(&fireState);      // 3
State *Purge     = machine.addState(&purgeState);     // 4
State *Overload  = machine.addState(&overloadState);  // 5
State *Abort     = machine.addState(&abortState);     // 6
// the state numbers are the order in which the states are added

State *targetState = 0;

#define ADD_TRANSITION(start, end) start->addTransition([](){ return targetState == end; }, end)

void setup()
{ 
    P1.init();


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

    // Wait for user input
    Serial.print("initlize system?\n");
    waitForUserInput();

    // Define state transitions
    ADD_TRANSITION(Init, Fuel_Fill);
    ADD_TRANSITION(Init, Overload);
    ADD_TRANSITION(Init, Abort);

    ADD_TRANSITION(Fuel_Fill, Abort);
    ADD_TRANSITION(Fuel_Fill, LOX_Fill);

    ADD_TRANSITION(LOX_Fill, Abort);
    ADD_TRANSITION(LOX_Fill, Fire);

    ADD_TRANSITION(Fire, Purge);
    ADD_TRANSITION(Fire, Abort);

    ADD_TRANSITION(Purge, Overload);
    ADD_TRANSITION(Purge, Abort);

    ADD_TRANSITION(Overload, Init);
    ADD_TRANSITION(Overload, Abort);
    ADD_TRANSITION(Overload, Purge);


    // This is the pilot valve test to ensure electical connection
    for (int pin = 1; pin <= 7; pin++) { // Include BV_1014 (pin 7)
        if (pin != 5) { // Skip pin 5 as it's used for Ethernet CS
            P1.writeDiscrete(HIGH, 2, pin);
            delay(500);
            P1.writeDiscrete(LOW, 2, pin);
            delay(500);
            P1.writeDiscrete(HIGH, 2, pin);
            delay(500);
            P1.writeDiscrete(LOW, 2, pin);
        }
    }
    // Test multiple valves
    for (int pin = 1; pin <= 7; pin++) {
        if (pin != 5) {
            P1.writeDiscrete(HIGH, 2, pin);
            delay(500);
        }
    }
    for (int pin = 1; pin <= 7; pin++) {
        if (pin != 5) {
            P1.writeDiscrete(LOW, 2, pin);
        }
    }
    delay(500);
}

void loop()
{
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
                switch (r) {
                    // query state
                    case 255:
                        client.write(1);
                        client.write(machine.currentState);
                        break;

                    // query possible transitions
                    case 254: {
                        LinkedList<struct Transition*> *transitions = machine.stateList->get(machine.currentState)->transitions;
                        int len = transitions->size();
                        client.write(len);
                        for (int i = 0; i < len; i++) {
                            client.write(transitions->get(i)->stateNumber);
                        }
                        break;
                    }

                    // transition state
                    default:
                        targetState = machine.stateList->get(r);
                        client.write(1);
                        client.write(targetState ? r : 255);  // the get returns null if the state is invalid
                }
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
        Serial.println("delaying for 30s to test");
        delay(30000);
    }
}

// fill
void FuelFillState()
{
    if (machine.executeOnce)
    {
        Serial.println("Fuel Fill State");
        BV_1001_state = LOW;
        BV_1009_state = LOW;
        BV_1004_state = LOW;
        P1.writeDiscrete(BV_1001_state, 2, BV_1001);
        P1.writeDiscrete(BV_1009_state, 2, BV_1009);
        P1.writeDiscrete(BV_1004_state, 2, BV_1004);
    }
    
}
void LOXFillState()
{
    if (machine.executeOnce)
    {
        Serial.println("LOX Fill State");
        BV_1014_state = LOW;
        BV_1002_state = LOW;
        BV_1008_state = LOW;
        P1.writeDiscrete(BV_1001_state, 2, BV_1014);
        P1.writeDiscrete(BV_1009_state, 2, BV_1002);
        P1.writeDiscrete(BV_1004_state, 2, BV_1008);
    }
    
}



// fire
void fireState()
{
    if (machine.executeOnce)
    {
        Serial.println("Fire state");
        Serial.println("Tank Press");
        BV_1004_state = HIGH; //fuel vent CLose
        BV_1002_state = HIGH;  // LOX Vent CLose
        BV_1001_state = HIGH;  // Fuel N2 Press valve
        BV_1014_state = LOW;  // LOX N2 Press Valve
        BV_1009_state = HIGH;  // Fuel main valve open
        BV_1008_state = HIGH;  // LOX main valve open



        P1.writeDiscrete(BV_1004_state, 2, BV_1004);  // close fuel vent
        P1.writeDiscrete(BV_1002_state, 2, BV_1002);  // close LOX vent
        P1.writeDiscrete(BV_1001_state, 2, BV_1001);  // open fuel main press valve
        P1.writeDiscrete(BV_1014_state, 2, BV_1014);  // open LOX main press valve
        //Need a 10 second delay here

        P1.writeDiscrete(BV_1009_state, 2, BV_1009);  // open main fuel valve
        //will need a delay here based on arrival time of propellants
        P1.writeDiscrete(BV_1008_state, 2, BV_1008);  // open main LOX valve 

        // this delay is based on expected duration of fire(aka how much LOX we have)
        taskManager.schedule(onceMillis(10000), []() { targetState = Purge; });
    }
}

// purge
void purgeState()
{
    if (machine.executeOnce)
    {
        Serial.println("Purge state");
        delay(1000);
        

        BV_1004_state = LOW;
        BV_1002_state = LOW;
        P1.writeDiscrete(BV_1002_state, 2, BV_1002);
        P1.writeDiscrete(BV_1004_state, 2, BV_1004);


    }
}

// overload
void overloadState()  //We will use this state to have manual control over induvidual valves 
{
    if (machine.executeOnce)
    {
        Serial.println("Overload state");
    }
}

// abort
void abortState()
{
    if (machine.executeOnce)
    {
        Serial.println("Abort state");
        // set valve state
        BV_1004_state = LOW;  //fuel vent 
        BV_1002_state = LOW;  // LOX Vent
        BV_1001_state = LOW;  // Fuel N2 Press valve
        BV_1009_state = LOW;  // Fuel main valve 
        BV_1014_state = LOW;  // LOX N2 Press Valve
        BV_1008_state = LOW;  // LOX main valve



        P1.writeDiscrete(BV_1004_state, 2, BV_1004);  // close fuel vent
        P1.writeDiscrete(BV_1002_state, 2, BV_1002);  // close LOX vent
        P1.writeDiscrete(BV_1001_state, 2, BV_1001);  // open fuel main press valve
        P1.writeDiscrete(BV_1014_state, 2, BV_1014);  // open LOX main press valve
        P1.writeDiscrete(BV_1009_state, 2, BV_1009);  // open main fuel valve
        P1.writeDiscrete(BV_1008_state, 2, BV_1008);  // open main LOX valve



    }
}

void waitForUserInput() {
  Serial.println("Address error message and press enter to continue");

  // Wait until data is available
  while (!Serial.available()) {
    delay(100); // Avoid busy-waiting
  }
}
