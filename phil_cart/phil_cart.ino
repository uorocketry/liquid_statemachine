#include <P1AM.h>
#include <TaskManagerIO.h>
#include "valves/valves.cpp"
#include "state_machine/state_machine.cpp"
#include "commands/commands.cpp"
#include "server/server.cpp"


void setup() {
	Serial.begin(9600);
	const unsigned long serialDeadline = millis() + 3000;
	while (!Serial && millis() < serialDeadline) {
		delay(10);
	}
	Serial.println("Starting Arduino...");

	// Keep diagnostics reachable even when rack initialization fails. The rack
	// is initialized explicitly through the HTTP API before transitions unlock.
	setupServer();
	defineStateTransitions();
}

void loop() {
	handleClientRequests();
	taskManager.runLoop();
	stateMachine.run();
}
