#ifndef SERVER_CPP
#define SERVER_CPP

#include <SPI.h>
#include <Ethernet.h>
#include <P1AM.h>
#include <P1AMOta.h>
#include <stdlib.h>

#include "server.h"
#include "../commands/commands.h"
#include "../version.h"

byte mac[] = { 0x60, 0x52, 0xD0, 0x08, 0x17, 0x38 };
// The machine LAN is 192.168.8.0/24. Keep the controller on a predictable
// address so the base station and OTA tooling do not need network discovery.
IPAddress ip(192,168,8,50);
IPAddress dns(192,168,8,1);
IPAddress gateway(192,168,8,1);
IPAddress subnet(255,255,255,0);
constexpr uint16_t SERVER_PORT = 80;
constexpr unsigned long REQUEST_TIMEOUT_MS = 750;
constexpr unsigned long FIRMWARE_BODY_TIMEOUT_MS = 5000;
constexpr size_t MAX_REQUEST_LINE = 96;
EthernetServer server(SERVER_PORT);
uint8_t detectedModuleCount = 0;
bool p1Initialized = false;
bool resetRequested = false;

namespace {
#include "http.cpp"
#include "status.cpp"
#include "firmware.cpp"

void routeRequest(
	EthernetClient& client,
	const String& method,
	const String& path,
	const RequestHeaders& headers
) {
	if (method == "GET" && path == "/api/status") {
		sendJson(client, 200, "OK", statusJson());
		return;
	}
	if (method == "GET" && path == "/api/system") {
		sendJson(client, 200, "OK", systemJson());
		return;
	}
	if (method == "POST" && path == "/api/firmware/confirm") {
		if (!P1AMOta::confirmCurrentApplication(FILL_CART_VERSION, P1AM_OTA_BUILD_ID)) {
			sendJson(client, 500, "Internal Server Error", "{\"error\":\"could not confirm firmware\"}");
			return;
		}
		sendJson(client, 200, "OK", systemJson());
		return;
	}
	if (method == "POST" && path == "/api/firmware") {
		receiveFirmware(client, headers);
		return;
	}
	if (method == "POST" && path == "/api/p1/initialize") {
		if (p1Initialized) {
			sendJson(client, 200, "OK", statusJson());
			return;
		}
		detectedModuleCount = P1.init();
		p1Initialized = detectedModuleCount > 0;
		SPI.begin();
		if (!p1Initialized) {
			sendJson(client, 503, "Service Unavailable", "{\"error\":\"P1 rack initialization failed\"}");
			return;
		}
		sendJson(client, 200, "OK", statusJson());
		return;
	}
	if (method == "POST" && path == "/api/reset") {
		if (p1Initialized) {
			initializeValves();
		}
		resetRequested = true;
		sendJson(client, 202, "Accepted", "{\"accepted\":true}");
		return;
	}
	if (method == "PUT" && path.startsWith("/api/state/")) {
		if (!p1Initialized) {
			sendJson(client, 503, "Service Unavailable", "{\"error\":\"P1 rack is not initialized\"}");
			return;
		}
		const String stateText = path.substring(11);
		if (stateText.length() != 1 || !isDigit(stateText[0])) {
			sendJson(client, 400, "Bad Request", "{\"error\":\"invalid state\"}");
			return;
		}
		const int requestedState = stateText.toInt();
		if (!setState(requestedState)) {
			sendJson(client, 409, "Conflict", "{\"error\":\"transition unavailable\"}");
			return;
		}
		sendJson(client, 202, "Accepted", "{\"accepted\":true}");
		return;
	}
	sendJson(client, 404, "Not Found", "{\"error\":\"not found\"}");
}
}  // namespace

void setupServer() {
	Serial.println("Setting up Server...");

	Ethernet.init(5);
	Ethernet.begin(mac, ip, dns, gateway, subnet);

	if (Ethernet.hardwareStatus() == EthernetNoHardware) {
		Serial.println("Ethernet shield was not found.");
	}
	if (Ethernet.linkStatus() == LinkOFF) {
		Serial.println("Ethernet cable is not connected.");
	}

	server.begin();
	Serial.print("Server is running at ");
	Serial.print(Ethernet.localIP());
	Serial.print(":");
	Serial.println(SERVER_PORT);
}

void handleClientRequests(){
	EthernetClient client = server.available();
	if (!client) {
		return;
	}

	String requestLine;
	RequestHeaders headers;
	if (!readLine(client, requestLine) || !readHeaders(client, headers)) {
		sendJson(client, 408, "Request Timeout", "{\"error\":\"incomplete request\"}");
		client.stop();
		return;
	}

	const int firstSpace = requestLine.indexOf(' ');
	const int secondSpace = requestLine.indexOf(' ', firstSpace + 1);
	if (firstSpace <= 0 || secondSpace <= firstSpace) {
		sendJson(client, 400, "Bad Request", "{\"error\":\"malformed request\"}");
		client.stop();
		return;
	}

	const String method = requestLine.substring(0, firstSpace);
	const String path = requestLine.substring(firstSpace + 1, secondSpace);
	routeRequest(client, method, path, headers);
	delay(1);
	client.stop();
	if (resetRequested) {
		delay(75);
		NVIC_SystemReset();
	}
}

#endif
