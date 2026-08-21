void beginApplication(const char* version, const char* build) {
    BootState state;
    if (!loadState(state)) {
        trialRunning = false;
        disableWatchdog();
        return;
    }

    trialRunning = state.trialSlot == currentSlot();
    trialStartedMs = millis();
    recordCurrentIdentity(state, version, build);

    if (trialRunning) {
        // SystemInit() resets the generic clock controller before setup().
        // Rebuild the watchdog clock as the first application-level action.
        configureTrialWatchdog();
    } else {
        disableWatchdog();
    }
}

void service() {
    if (!trialRunning) {
        return;
    }
    if (millis() - trialStartedMs < TRIAL_CONFIRM_WINDOW_MS) {
        feedWatchdog();
    }
}

bool isTrial() {
    return trialRunning;
}

uint32_t trialConfirmRemainingMs() {
    if (!trialRunning) {
        return 0;
    }
    const uint32_t elapsed = millis() - trialStartedMs;
    return elapsed >= TRIAL_CONFIRM_WINDOW_MS ? 0 : TRIAL_CONFIRM_WINDOW_MS - elapsed;
}

bool confirmCurrentApplication(const char* version, const char* build) {
    BootState state;
    const Slot current = currentSlot();
    if (!loadState(state) || current == SLOT_NONE) {
        return false;
    }

    SlotInfo& info = state.slots[static_cast<uint8_t>(current)];
    copyText(info.version, sizeof(info.version), version);
    copyText(info.build, sizeof(info.build), build);

    if (state.trialSlot == current) {
        state.knownGoodSlot = current;
        state.activeSlot = current;
        state.trialSlot = SLOT_NONE;
        state.pendingSlot = SLOT_NONE;
        state.bootReason = BOOT_REASON_CONFIRMED;
        state.lastUpdateResult = UPDATE_RESULT_CONFIRMED;
        if (!saveState(state)) {
            return false;
        }
    }

    trialRunning = false;
    disableWatchdog();
    return true;
}

void updaterBoot() {
    const uint8_t resetCause = PM->RCAUSE.reg;
    BootState state;

    if (!loadState(state)) {
        Slot initial = vectorValid(SLOT_A) ? SLOT_A : (vectorValid(SLOT_B) ? SLOT_B : SLOT_NONE);
        if (initial == SLOT_NONE) {
            return;
        }
        initializeState(state, initial, resetCause);
        if (!saveState(state)) {
            return;
        }
        disableWatchdog();
        jumpToSlot(initial);
    }

    state.lastResetCause = resetCause;

    if (state.pendingSlot != SLOT_NONE) {
        const Slot target = static_cast<Slot>(state.pendingSlot);
        const SlotInfo& info = state.slots[static_cast<uint8_t>(target)];
        if (!validateImage(target, info.imageSize, info.imageCrc32)) {
            state.lastFailedSlot = target;
            copyText(state.lastFailedVersion, sizeof(state.lastFailedVersion), info.version);
            copyText(state.lastFailedBuild, sizeof(state.lastFailedBuild), info.build);
            state.pendingSlot = SLOT_NONE;
            state.trialSlot = SLOT_NONE;
            state.activeSlot = state.knownGoodSlot;
            state.bootReason = BOOT_REASON_INVALID_UPDATE;
            state.lastUpdateResult = UPDATE_RESULT_INVALID_IMAGE;
            saveState(state);
            disableWatchdog();
            if (vectorValid(static_cast<Slot>(state.knownGoodSlot))) {
                jumpToSlot(static_cast<Slot>(state.knownGoodSlot));
            }
            return;
        }

        state.activeSlot = target;
        state.trialSlot = target;
        state.pendingSlot = SLOT_NONE;
        state.bootReason = BOOT_REASON_TRIAL;
        if (!saveState(state)) {
            return;
        }
        configureTrialWatchdog();
        jumpToSlot(target);
    }

    if (state.trialSlot != SLOT_NONE) {
        const Slot failed = static_cast<Slot>(state.trialSlot);
        const SlotInfo& info = state.slots[static_cast<uint8_t>(failed)];
        state.lastFailedSlot = failed;
        copyText(state.lastFailedVersion, sizeof(state.lastFailedVersion), info.version);
        copyText(state.lastFailedBuild, sizeof(state.lastFailedBuild), info.build);
        state.trialSlot = SLOT_NONE;
        state.pendingSlot = SLOT_NONE;
        state.activeSlot = state.knownGoodSlot;
        state.bootReason = BOOT_REASON_ROLLBACK;
        state.lastUpdateResult = UPDATE_RESULT_ROLLED_BACK;
        state.rollbackCount += 1;
        if (!saveState(state)) {
            return;
        }
        disableWatchdog();
        if (vectorValid(static_cast<Slot>(state.knownGoodSlot))) {
            jumpToSlot(static_cast<Slot>(state.knownGoodSlot));
        }
        return;
    }

    Slot selected = static_cast<Slot>(state.knownGoodSlot);
    if (!vectorValid(selected)) {
        selected = vectorValid(SLOT_A) ? SLOT_A : (vectorValid(SLOT_B) ? SLOT_B : SLOT_NONE);
    }
    disableWatchdog();
    if (selected != SLOT_NONE) {
        jumpToSlot(selected);
    }
}
