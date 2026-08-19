#include "valves.h"
#include <SPI.h>

Valve::Valve(String valveName, uint8_t valveSlot, uint8_t valveChannel) {
	name = valveName;
	slot = valveSlot;
	channel = valveChannel;
	state = LOW;
}

void Valve::open() {
	Serial.println("Opening valve: " + name);
	state = HIGH;
	P1.writeDiscrete(state, slot, channel);
	// P1 I/O and P1AM-ETH share SPI. P1 ends the bus after its transaction;
	// restore it once so Ethernet can continue servicing the control server.
	SPI.begin();
}

void Valve::close() {
	Serial.println("Closing valve: " + name);
	state = LOW;
	P1.writeDiscrete(state, slot, channel);
	SPI.begin();
}

void Valve::test() {
	Serial.println("Starting to test valve: " + name);
	this->open();
	delay(500);
	this->close();
	delay(500);
	this->open();
	delay(500);
	this->close();
	Serial.println("Finished testing valve: " + name);
}

// Valves are defined as Valve(name, slot, channel)
Valve FuelN2PressureValve = Valve("Fuel N2 Pressure [BV_1001]", 2, 1);
Valve LoxVentValve = Valve("Lox [BV_1002]", 2, 2);
Valve FuelVentValve = Valve("Fuel [BV_1004]", 2, 3);
Valve LoxMainValve = Valve("Lox Main [BV_1008]", 2, 4);
Valve FuelMainValve = Valve("Fuel Main [BV_1009]", 2, 6);
Valve LoxN2PressureValve = Valve("Lox N2 Pressure [BV_1014]", 2, 7);
Valve Igniter1 = Valve("IGN_1", 2, 9);
Valve Igniter2 = Valve("IGN_2", 2, 10);

Valve* valves[] = { &FuelN2PressureValve, &LoxVentValve, &FuelVentValve, &LoxMainValve, &FuelMainValve, &LoxN2PressureValve, &Igniter1, &Igniter2 };

void initializeValves() {
	for (Valve* valve : valves) {
		valve->close();
	}
}
