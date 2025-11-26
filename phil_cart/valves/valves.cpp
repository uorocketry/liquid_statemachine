#include "valves.h"

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
