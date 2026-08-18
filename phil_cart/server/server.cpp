#ifndef SERVER_CPP
#define SERVER_CPP
#include <SPI.h>
#include <Ethernet.h>
#include <P1AM.h>
#include "server.h"
#include "../commands/commands.h"

byte mac[] = { 0x60, 0x52, 0xD0, 0x08, 0x17, 0x38 };
// The GL.iNet LAN is 192.168.8.0/24. Keep the controller on a predictable
// address so the base station and OTA tooling do not need network discovery.
IPAddress ip(192,168,8,50);
IPAddress dns(192,168,8,1);
IPAddress gateway(192,168,8,1);
IPAddress subnet(255,255,255,0);
constexpr uint16_t SERVER_PORT = 80;
constexpr unsigned long REQUEST_TIMEOUT_MS = 750;
constexpr size_t MAX_REQUEST_LINE = 96;
constexpr char FIRMWARE_VERSION[] = "0.3.0";
EthernetServer server(SERVER_PORT);
uint8_t detectedModuleCount = 0;
bool p1Initialized = false;
bool resetRequested = false;

namespace {
void sendJson(EthernetClient& client, int status, const char* reason, const String& body) {
	client.print("HTTP/1.1 ");
	client.print(status);
	client.print(" ");
	client.println(reason);
	client.println("Content-Type: application/json");
	client.print("Content-Length: ");
	client.println(body.length());
	client.println("Connection: close");
	client.println();
	client.print(body);
}

bool readLine(EthernetClient& client, String& line) {
	const unsigned long deadline = millis() + REQUEST_TIMEOUT_MS;
	while (client.connected() && millis() < deadline) {
		while (client.available()) {
			const char character = client.read();
			if (character == '\n') {
				if (line.endsWith("\r")) {
					line.remove(line.length() - 1);
				}
				return true;
			}
			if (line.length() >= MAX_REQUEST_LINE) {
				return false;
			}
			line += character;
		}
	}
	return false;
}

bool discardHeaders(EthernetClient& client) {
	for (int headerCount = 0; headerCount < 24; headerCount++) {
		String header;
		if (!readLine(client, header)) {
			return false;
		}
		if (header.length() == 0) {
			return true;
		}
	}
	return false;
}

String healthJson() {
	const IPAddress localIp = Ethernet.localIP();
	String body = "{\"ok\":true,\"firmware_version\":\"";
	body += FIRMWARE_VERSION;
	body += "\",\"uptime_ms\":";
	body += millis();
	body += ",\"ethernet\":{\"link\":";
	body += Ethernet.linkStatus() == LinkON ? "true" : "false";
	body += ",\"ip\":\"";
	for (int octet = 0; octet < 4; octet++) {
		if (octet > 0) body += '.';
		body += localIp[octet];
	}
	body += "\"},\"p1\":{\"initialized\":";
	body += p1Initialized ? "true" : "false";
	body += ",\"modules_detected\":";
	body += detectedModuleCount;
	body += "}}";
	return body;
}

String statusJson() {
	String body = "{\"health\":";
	body += healthJson();
	body += ",\"state\":";
	body += getState();
	body += ",\"transitions\":";
	if (p1Initialized) {
		LinkedList<Transition*>* transitions = getAvailableTransitions();
		body += '[';
		for (int i = 0; i < transitions->size(); i++) {
			if (i > 0) body += ',';
			body += transitions->get(i)->stateNumber;
		}
		body += ']';
	} else {
		body += "[]";
	}
	body += '}';
	return body;
}

void routeRequest(EthernetClient& client, const String& method, const String& path) {
	if (method == "GET" && path == "/api/status") {
		sendJson(client, 200, "OK", statusJson());
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
		// Drive the initialized output rack to its safe state before rebooting.
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
	Serial.println(SERVER_PORT);
}

void handleClientRequests(){
	EthernetClient client = server.available();
	if (!client) {
		return;
	}

	String requestLine;
	if (!readLine(client, requestLine) || !discardHeaders(client)) {
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
	routeRequest(client, method, path);
	delay(1);
	client.stop();
	if (resetRequested) {
		delay(50);
		NVIC_SystemReset();
	}
}

#endif
