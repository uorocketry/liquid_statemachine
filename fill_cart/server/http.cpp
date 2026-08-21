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
				if (line.endsWith("\r")) line.remove(line.length() - 1);
				return true;
			}
			if (line.length() >= MAX_REQUEST_LINE) return false;
			line += character;
		}
	}
	return false;
}

bool readHeaders(EthernetClient& client, RequestHeaders& headers) {
	for (int headerCount = 0; headerCount < 24; headerCount++) {
		String header;
		if (!readLine(client, header)) return false;
		if (header.length() == 0) return true;
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
