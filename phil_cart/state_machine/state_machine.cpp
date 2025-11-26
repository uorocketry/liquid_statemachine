#ifndef STATE_MACHINE_CPP
#define STATE_MACHINE_CPP

#include <TaskManagerIO.h>
#include <Arduino.h>
#include "state_machine.h"
#include "../valves/valves.h"

// The global state machine instance
StateMachine stateMachine = StateMachine();

// The current state of the system
State *targetState = 0;

// States are identified by the order in which they are added. 
// This should match the base station's definitions of states
State *ValveTesting	= stateMachine.addState(&ValveTestingStateHandler);	// 0
State *Init			= stateMachine.addState(&InitStateHandler);			// 1
State *FuelFill		= stateMachine.addState(&FuelFillStateHandler);		// 2
State *LoxFill		= stateMachine.addState(&LoxFillStateHandler);			// 3
State *Fire			= stateMachine.addState(&FireStateHandler);			// 4
State *Purge		= stateMachine.addState(&PurgeStateHandler);			// 5
State *Overload		= stateMachine.addState(&OverloadStateHandler);		// 6
State *Abort		= stateMachine.addState(&AbortStateHandler);			// 7

void ValveTestingStateHandler() {
	// Only execute once per state entry
	if (!stateMachine.executeOnce) {
		return;
	}

	Serial.println("Entered State: Valve Testing");

	// sizeof(valves) / sizeof(valves[0] gives the number of elements in the valves array
	for (int i = 0; i < sizeof(valves) / sizeof(valves[0]); i++) {
		valves[i]->test();
	}
}

void InitStateHandler() {
	// Only execute once per state entry
	if (!stateMachine.executeOnce) {
		return;
	}

	Serial.println("Entered State: Init");
}

void FuelFillStateHandler() {
	// Only execute once per state entry
	if (!stateMachine.executeOnce) {
		return;
	}

	Serial.println("Entered State: Fuel Fill");

	FuelN2PressureValve.close();
	FuelMainValve.close();
	FuelVentValve.close();
}

void LoxFillStateHandler() {
	// Only execute once per state entry
	if (!stateMachine.executeOnce) {
		return;
	}

	Serial.println("Entered State: LOX Fill");

	LoxN2PressureValve.close();
	LoxVentValve.close();
	LoxMainValve.close();
}

// Time it takes the tanks to pressurize after opening the N2 pressure valves
const int TIME_TO_PRESSURIZE_TANKS_MS = 10000; // 10 seconds

// Expected duration of burn
const int EXPECTED_DURATION_OF_FIRE_MS = 10000; // 10 seconds

// Estimated time for propellants to reach the combustion chamber after opening main fuel valve
const int ARRIVAL_TIME_OF_PROPELLANTS_MS = 250; // 0.25 seconds

void FireStateHandler() {
	// Only execute once per state entry
	if (!stateMachine.executeOnce) {
		return;
	}

	Serial.println("Entered State: Fire");

	// Note when calling taskManager.schedule back to back it doesn't wait between them
	// so calling `taskManager.schedule(onceMillis(2000)` and in the next line another `taskManager.schedule(onceMillis(2000)` will schedule both to run at the same time after 2 seconds.
	// SHOULD DO find a better way to delay without interrupting the main loop here the nested scheduling is a bit messy but works for now.

	// Immediately close fuel vent valves
	FuelVentValve.close();
	LoxVentValve.close();

	// After 2 seconds, pressurize the tanks
	taskManager.schedule(onceMillis(2000), []() {
		Serial.println("Pressurizing Tanks");
		FuelN2PressureValve.open();
		LoxN2PressureValve.open();


		// After some delay giving time for the tanks to pressurize
		taskManager.schedule(onceMillis(TIME_TO_PRESSURIZE_TANKS_MS), []() {
			Serial.println("Running Ignitors");
			Igniter1.open();
			Igniter2.open();

			// After 2 seconds, open main fuel valve
			taskManager.schedule(onceMillis(2000), []() {
				Serial.println("Opening Main Fuel Valve");
				FuelMainValve.open();

				taskManager.schedule(onceMillis(ARRIVAL_TIME_OF_PROPELLANTS_MS), []() { // this delay here is to be based on arrival time of propellants
					Serial.println("Opening Main LOX Valve");
					LoxMainValve.open();
					Serial.println("Main burn begun.");

					// After the expected duration of fire, transition to Purge state
					taskManager.schedule(onceMillis(EXPECTED_DURATION_OF_FIRE_MS), []() {
						Serial.println("Main burn complete. Transitioning to Purge state.");
						stateMachine.transitionTo(Purge);
					});
				});
			});
		});
	});
}

void PurgeStateHandler() {
	// Only execute once per state entry
	if (!stateMachine.executeOnce) {
		return;
	}

	Serial.println("Entered State: Purge");

	// Purge after a delay of 1 second
	taskManager.schedule(onceMillis(1000), []() {
		FuelVentValve.open();
		LoxVentValve.open();
	});
}

void OverloadStateHandler() {
	// Only execute once per state entry
	if (!stateMachine.executeOnce) {
		return;
	}

	Serial.println("Entered State: Overload");
}

void AbortStateHandler() {
	// Only execute once per state entry
	if (!stateMachine.executeOnce) {
		return;
	}

	Serial.println("Entered State: Abort");

	// sizeof(valves) / sizeof(valves[0] gives the number of elements in the valves array
	for (int i = 0; i < sizeof(valves) / sizeof(valves[0]); i++) {
		valves[i]->close();
	}
}

// Macro to simplify adding transitions
#define ADD_TRANSITION(start, end) start->addTransition([](){ return targetState == end; }, end)

void defineStateTransitions() {
	Serial.println("Defining State Transitions...");

	// Define state transitions
	ADD_TRANSITION(ValveTesting, Init);
	ADD_TRANSITION(ValveTesting, Overload);
	ADD_TRANSITION(ValveTesting, Abort);

	ADD_TRANSITION(Init, FuelFill);
	ADD_TRANSITION(Init, Overload);
	ADD_TRANSITION(Init, Abort);

	ADD_TRANSITION(FuelFill, Abort);
	ADD_TRANSITION(FuelFill, LoxFill);

	ADD_TRANSITION(LoxFill, Abort);
	ADD_TRANSITION(LoxFill, Fire);

	ADD_TRANSITION(Fire, Purge);
	ADD_TRANSITION(Fire, Abort);

	ADD_TRANSITION(Purge, Overload);
	ADD_TRANSITION(Purge, Abort);

	ADD_TRANSITION(Overload, Init);
	ADD_TRANSITION(Overload, Abort);
	ADD_TRANSITION(Overload, Purge);
}

#endif
