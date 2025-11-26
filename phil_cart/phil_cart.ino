#include <P1AM.h>
#include <TaskManagerIO.h>
#include "valves/valves.cpp"
#include "state_machine/state_machine.cpp"
#include "commands/commands.cpp"
#include "server/server.cpp"


void setup() {
	P1.init();

	Serial.begin(9600);
	Serial.println("Starting Arduino...");

	setupServer();
	defineStateTransitions();
}

void loop() {
	handleClientRequests();
	taskManager.runLoop();
	stateMachine.run();
}
