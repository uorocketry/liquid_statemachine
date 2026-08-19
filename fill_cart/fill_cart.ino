#include <P1AM.h>
#include <TaskManagerIO.h>
#include <P1AMOta.h>
#include "version.h"
#include "valves/valves.cpp"
#include "state_machine/state_machine.cpp"
#include "commands/commands.cpp"
#include "server/server.cpp"


void setup() {
	P1AMOta::beginApplication(FILL_CART_VERSION, P1AM_OTA_BUILD_ID);
#if defined(P1AM_OTA_TEST_HANG)
	while (true) { }
#endif
	Serial.begin(9600);
	const unsigned long serialDeadline = millis() + 3000;
	while (!Serial && millis() < serialDeadline) {
		P1AMOta::service();
		delay(10);
	}
	Serial.println("Starting Arduino...");

	// Keep diagnostics reachable even when rack initialization fails. The rack
	// is initialized explicitly through the HTTP API before transitions unlock.
#if !defined(P1AM_OTA_TEST_NO_HTTP)
	setupServer();
#endif
	P1AMOta::service();
	defineStateTransitions();
}

void loop() {
	P1AMOta::service();
#if !defined(P1AM_OTA_TEST_NO_HTTP)
	handleClientRequests();
#endif
	taskManager.runLoop();
	stateMachine.run();
	P1AMOta::service();
}
