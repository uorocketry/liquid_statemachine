#ifndef SERVER_CPP
#define SERVER_CPP
#include <SPI.h>
#include <Ethernet.h>
#include "server.h"
#include "../commands/commands.h"

byte mac[] = { 0x60, 0x52, 0xD0, 0x08, 0x17, 0x38 };
IPAddress ip(192,168,0,50);
#define PORT 80
EthernetServer server(PORT);

void setupServer() {
	Serial.println("Setting up Server...");

	Ethernet.init(5);
	Ethernet.begin(mac, ip);

	// Check for Ethernet hardware present
	if (Ethernet.hardwareStatus() == EthernetNoHardware) {
		Serial.println("Ethernet shield was not found.");
	}
	if (Ethernet.linkStatus() == LinkOFF) {
		Serial.println("Ethernet cable is not connected.");
	}

	// start the server
	server.begin();
	Serial.print("Server is running at ");
	Serial.print(Ethernet.localIP());
	Serial.print(":");
	Serial.println(PORT);
}

void handleClientRequests(){
	EthernetClient client = server.available();
	if (!client) {
		return;
	}

	// Assumption is that the connections are short-lived and handle one command at a time
	while (client.connected()) {
		if (!client.available()) {
			continue;
		}
		Command command = static_cast<Command>(client.read());

		switch (command) {
			case Command::GetState: {
				int state = getState();
				client.write(state);
				break;
			}
			case Command::SetState: {
				setState(client.read());
				client.write(1); //acknowledge
				break;
			}
			case Command::GetAvailableTransitions: {
				LinkedList<Transition*>* transitions = getAvailableTransitions();
				int len = transitions->size();
				client.write(len);
				for (int i = 0; i < len; i++) {
					client.write(transitions->get(i)->stateNumber);
				}
				break;
			}
		}
	}
}

#endif
