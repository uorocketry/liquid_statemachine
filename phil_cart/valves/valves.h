#ifndef VALVES_H
#define VALVES_H

#include <P1AM.h>

class Valve {
	public:
	String name;
	uint8_t channel;
	uint8_t slot;
	uint8_t state;

	Valve(String valveName, uint8_t valveSlot, uint8_t valveChannel) {
		name = valveName;
		slot = valveSlot;
		channel = valveChannel;
		close();
	}

	void open() {
		Serial.println("Opening valve: " + name);
		state = HIGH;
		P1.writeDiscrete(state, slot, channel);
	}

	void close() {
		Serial.println("Closing valve: " + name);
		state = LOW;
		P1.writeDiscrete(state, slot, channel);
	}

	void test() {
		Serial.println("Starting to test valve: " + name);
		open();
		delay(500);
		close();
		delay(500);
		open();
		delay(500);
		close();
		Serial.println("Finished testing valve: " + name);
	}
};

// Valves are defined as Valve(name, slot, channel)
extern Valve FuelN2PressureValve;
extern Valve LoxVentValve;
extern Valve FuelVentValve;
extern Valve LoxMainValve;
extern Valve FuelMainValve;
extern Valve LoxN2PressureValve;
extern Valve Igniter1;
extern Valve Igniter2;

extern Valve* valves[];

#endif
