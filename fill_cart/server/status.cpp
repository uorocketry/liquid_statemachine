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
	body += ",\"states\":[";
	for (int i = 0; i < getStateCount(); i++) {
		if (i > 0) body += ',';
		body += '\"';
		body += getStateName(i);
		body += '\"';
	}
	body += ']';
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
