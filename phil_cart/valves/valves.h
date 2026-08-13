#ifndef VALVES_H
#define VALVES_H

#include <P1AM.h>

class Valve {
	public:
	String name;
	uint8_t channel;
	uint8_t slot;
	uint8_t state;

	Valve(String valveName, uint8_t valveSlot, uint8_t valveChannel);

	void open();
	void close();
	void test();
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

// Apply the safe closed state after the P1 base controller is initialized.
void initializeValves();

#endif
