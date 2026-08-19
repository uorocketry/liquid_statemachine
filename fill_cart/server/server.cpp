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
struct RequestHeaders {
	long contentLength;
	String firmwareVersion;
	String firmwareBuild;
	String firmwareCrc32;

	RequestHeaders() : contentLength(-1) {}
};

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
		P1AMOta::service();
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

bool readHeaders(EthernetClient& client, RequestHeaders& headers) {
	for (int headerCount = 0; headerCount < 24; headerCount++) {
		String header;
		if (!readLine(client, header)) {
			return false;
		}
		if (header.length() == 0) {
			return true;
		}
		if (header.startsWith("Content-Length:")) {
			String value = header.substring(15);
			value.trim();
			headers.contentLength = value.toInt();
		} else if (header.startsWith("X-Firmware-Version:")) {
			headers.firmwareVersion = header.substring(19);
			headers.firmwareVersion.trim();
		} else if (header.startsWith("X-Firmware-Build:")) {
			headers.firmwareBuild = header.substring(17);
			headers.firmwareBuild.trim();
		} else if (header.startsWith("X-Firmware-CRC32:")) {
			headers.firmwareCrc32 = header.substring(17);
			headers.firmwareCrc32.trim();
		}
	}
	return false;
}

String healthJson() {
	const IPAddress localIp = Ethernet.localIP();
	String body = "{\"ok\":true,\"firmware_version\":\"";
	body += FILL_CART_VERSION;
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

String systemJson() {
	P1AMOta::BootState otaState;
	const bool hasState = P1AMOta::loadState(otaState);
	const P1AMOta::Slot running = P1AMOta::currentSlot();
	String body = "{\"firmware\":{\"version\":\"";
	body += FILL_CART_VERSION;
	body += "\",\"build\":\"";
	body += P1AM_OTA_BUILD_ID;
	body += "\",\"slot\":\"";
	body += P1AMOta::slotName(running);
	body += "\",\"trial\":";
	body += P1AMOta::isTrial() ? "true" : "false";
	body += "},\"boot\":{\"reset_cause\":\"";
	body += P1AMOta::resetCauseName(PM->RCAUSE.reg);
	body += "\"";

	if (hasState) {
		body += ",\"last_event\":\"";
		body += P1AMOta::bootReasonName(static_cast<P1AMOta::BootReason>(otaState.bootReason));
		body += "\",\"last_update_result\":\"";
		body += P1AMOta::updateResultName(static_cast<P1AMOta::UpdateResult>(otaState.lastUpdateResult));
		body += "\",\"known_good_slot\":\"";
		body += P1AMOta::slotName(static_cast<P1AMOta::Slot>(otaState.knownGoodSlot));
		body += "\",\"pending_slot\":\"";
		body += P1AMOta::slotName(static_cast<P1AMOta::Slot>(otaState.pendingSlot));
		body += "\",\"trial_slot\":\"";
		body += P1AMOta::slotName(static_cast<P1AMOta::Slot>(otaState.trialSlot));
		body += "\",\"last_failed_slot\":\"";
		body += P1AMOta::slotName(static_cast<P1AMOta::Slot>(otaState.lastFailedSlot));
		body += "\",\"last_failed_version\":\"";
		body += otaState.lastFailedVersion;
		body += "\",\"last_failed_build\":\"";
		body += otaState.lastFailedBuild;
		body += "\",\"rollback_count\":";
		body += otaState.rollbackCount;
	} else {
		body += ",\"last_event\":\"metadata_unavailable\"";
	}
	body += "},\"ota\":{\"confirm_window_remaining_ms\":";
	body += P1AMOta::trialConfirmRemainingMs();
	body += "}}";
	return body;
}

bool receiveFirmware(EthernetClient& client, const RequestHeaders& headers) {
	if (P1AMOta::isTrial()) {
		sendJson(client, 409, "Conflict", "{\"error\":\"confirm the trial firmware before another update\"}");
		return false;
	}
	if (headers.contentLength <= 0 || static_cast<uint32_t>(headers.contentLength) > P1AMOta::APP_SLOT_SIZE) {
		sendJson(client, 413, "Payload Too Large", "{\"error\":\"firmware size is invalid\"}");
		return false;
	}
	if (headers.firmwareVersion.length() == 0 || headers.firmwareBuild.length() == 0) {
		sendJson(client, 400, "Bad Request", "{\"error\":\"firmware version/build headers are required\"}");
		return false;
	}

	const P1AMOta::Slot target = P1AMOta::inactiveSlot();
	if (target == P1AMOta::SLOT_NONE) {
		sendJson(client, 500, "Internal Server Error", "{\"error\":\"running slot is unknown\"}");
		return false;
	}

	// Stop initialized outputs before spending time erasing/writing flash.
	if (p1Initialized) {
		initializeValves();
	}

	P1AMOta::FlashWriter writer;
	const uint32_t imageSize = static_cast<uint32_t>(headers.contentLength);
	if (!writer.begin(P1AMOta::slotBase(target), imageSize)) {
		sendJson(client, 500, "Internal Server Error", "{\"error\":\"could not prepare inactive flash slot\"}");
		return false;
	}

	P1AMOta::Crc32 crc;
	uint32_t remaining = imageSize;
	unsigned long lastProgress = millis();
	uint8_t buffer[128];
	while (remaining > 0) {
		P1AMOta::service();
		const int available = client.available();
		if (available > 0) {
			const int requested = min(static_cast<int>(sizeof(buffer)), min(available, static_cast<int>(remaining)));
			const int received = client.read(buffer, requested);
			if (received > 0) {
				if (!writer.write(buffer, static_cast<size_t>(received))) {
					sendJson(client, 500, "Internal Server Error", "{\"error\":\"flash write failed\"}");
					return false;
				}
				crc.update(buffer, static_cast<size_t>(received));
				remaining -= static_cast<uint32_t>(received);
				lastProgress = millis();
			}
		} else {
			if (!client.connected() || millis() - lastProgress > FIRMWARE_BODY_TIMEOUT_MS) {
				sendJson(client, 408, "Request Timeout", "{\"error\":\"firmware upload was interrupted\"}");
				return false;
			}
			delay(1);
		}
	}

	if (!writer.finish()) {
		sendJson(client, 500, "Internal Server Error", "{\"error\":\"final flash page write failed\"}");
		return false;
	}

	const uint32_t imageCrc32 = crc.value();
	if (headers.firmwareCrc32.length() > 0) {
		const uint32_t declaredCrc = strtoul(headers.firmwareCrc32.c_str(), NULL, 16);
		if (declaredCrc != imageCrc32) {
			sendJson(client, 422, "Unprocessable Entity", "{\"error\":\"uploaded CRC does not match host CRC\"}");
			return false;
		}
	}
	if (!P1AMOta::validateImage(target, imageSize, imageCrc32)) {
		sendJson(client, 422, "Unprocessable Entity", "{\"error\":\"inactive-slot readback validation failed\"}");
		return false;
	}
	if (!P1AMOta::stageUpdate(
		target,
		imageSize,
		imageCrc32,
		headers.firmwareVersion.c_str(),
		headers.firmwareBuild.c_str()
	)) {
		sendJson(client, 500, "Internal Server Error", "{\"error\":\"could not commit OTA metadata\"}");
		return false;
	}

	String body = "{\"accepted\":true,\"target_slot\":\"";
	body += P1AMOta::slotName(target);
	body += "\",\"bytes\":";
	body += imageSize;
	body += ",\"crc32\":\"";
	char crcText[9];
	snprintf(crcText, sizeof(crcText), "%08lx", static_cast<unsigned long>(imageCrc32));
	body += crcText;
	body += "\"}";
	sendJson(client, 202, "Accepted", body);
	resetRequested = true;
	return true;
}

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
