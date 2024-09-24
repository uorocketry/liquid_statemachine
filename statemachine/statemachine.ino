#include <StateMachine.h>
#include <ArduinoJson.h>
#include <P1AM.h>
#include <Ethernet.h>
#include <SPI.h>

StateMachine machine = StateMachine();
// check the mac address of the ethernet shield
byte mac[] = {0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED};
EthernetServer server(80); // HTTP server on port 80

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

    Serial.println("Obtaining an IP address using DHCP");
    if (Ethernet.begin(mac) == 0)
    {
        Serial.println("Failed to obtaining an IP address");

        // check for Ethernet hardware present
        if (Ethernet.hardwareStatus() == EthernetNoHardware)
            Serial.println("Ethernet shield was not found");

        // check for Ethernet cable
        if (Ethernet.linkStatus() == LinkOFF)
            Serial.println("Ethernet cable is not connected.");

        while (true)
            ;
    }
    Serial.print("Arduino's IP Address: ");
    Serial.println(Ethernet.localIP());

    server.begin(); // Start the HTTP server
    Serial.println("Server is ready.");

    Serial.println("Defining state transitions");
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
            delay(60);
        }
    }
    EthernetClient client = server.available();
    if (client)
    {
        handleClientRequest(client);
    }
    // processJson();
    machine.run();
}

// Parse incoming HTTP request
void handleClientRequest(EthernetClient client)
{
    if (client.available())
    {
        String req = client.readStringUntil('\r'); // Read request line
        client.flush();

        // Parse the request line and look for 'GET' or 'POST'
        if (req.startsWith("POST "))
        {
            Serial.println("POST request received");
            // Extract the body of the request (JSON) and process it
            String body = "";
            while (client.available())
            {
                char c = client.read();
                body += c;
            }

            DynamicJsonDocument doc(200);
            DeserializationError error = deserializeJson(doc, body);

            if (error)
            {
                Serial.println("Failed to parse JSON");
            }
            else
            {
                targetState = doc["state"];
                Serial.print("Target state: ");
                Serial.println(targetState);

                // Send confirmation back to the client
                sendStateResponse(client);
            }
        }
    }
}

// Send the current state and valve status back to the client in JSON
void sendStateResponse(EthernetClient client)
{
    DynamicJsonDocument doc(256);

    // Current state info
    doc["current_state"] = targetState;
    doc["BV_1001"] = BV_1001_state;
    doc["BV_1002"] = BV_1002_state;
    doc["BV_1004"] = BV_1004_state;

    // Serialize JSON into the response
    String response;
    serializeJson(doc, response);

    client.println("HTTP/1.1 200 OK");
    client.println("Content-Type: application/json");
    client.println("Connection: close");
    client.println();
    client.println(response); // Send JSON response
    client.stop();
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