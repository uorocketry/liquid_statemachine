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
	if (p1Initialized) initializeValves();

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
	if (!P1AMOta::stageUpdate(target, imageSize, imageCrc32, headers.firmwareVersion.c_str(), headers.firmwareBuild.c_str())) {
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
