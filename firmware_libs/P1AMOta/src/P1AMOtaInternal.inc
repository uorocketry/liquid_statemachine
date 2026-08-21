namespace {

static bool trialRunning = false;
static uint32_t trialStartedMs = 0;

static uint32_t crc32Raw(uint32_t state, const uint8_t* data, size_t length) {
    for (size_t i = 0; i < length; ++i) {
        state ^= data[i];
        for (uint8_t bit = 0; bit < 8; ++bit) {
            state = (state >> 1) ^ (0xEDB88320UL & (0UL - (state & 1UL)));
        }
    }
    return state;
}

static uint32_t stateCrc(const BootState& state) {
    uint32_t raw = crc32Raw(
        0xFFFFFFFFUL,
        reinterpret_cast<const uint8_t*>(&state),
        offsetof(BootState, stateCrc32)
    );
    return raw ^ 0xFFFFFFFFUL;
}

static bool slotValueValid(uint8_t slot, bool allowNone) {
    return slot == SLOT_A || slot == SLOT_B || (allowNone && slot == SLOT_NONE);
}

static bool metadataValid(const BootState& state) {
    if (state.magic != METADATA_MAGIC || state.schema != METADATA_SCHEMA ||
        state.bytes != sizeof(BootState)) {
        return false;
    }
    if (!slotValueValid(state.activeSlot, true) ||
        !slotValueValid(state.knownGoodSlot, true) ||
        !slotValueValid(state.pendingSlot, true) ||
        !slotValueValid(state.trialSlot, true) ||
        !slotValueValid(state.lastFailedSlot, true)) {
        return false;
    }
    return state.stateCrc32 == stateCrc(state);
}

static bool newerGeneration(uint32_t a, uint32_t b) {
    return static_cast<int32_t>(a - b) > 0;
}

static bool loadStateDetailed(BootState& state, int& sourceCopy) {
    const BootState& copy0 = *reinterpret_cast<const BootState*>(METADATA_0_BASE);
    const BootState& copy1 = *reinterpret_cast<const BootState*>(METADATA_1_BASE);
    const bool valid0 = metadataValid(copy0);
    const bool valid1 = metadataValid(copy1);

    if (!valid0 && !valid1) {
        sourceCopy = -1;
        return false;
    }
    if (valid0 && (!valid1 || !newerGeneration(copy1.generation, copy0.generation))) {
        state = copy0;
        sourceCopy = 0;
        return true;
    }
    state = copy1;
    sourceCopy = 1;
    return true;
}

static bool nvmWaitReady() {
    while (NVMCTRL->INTFLAG.bit.READY == 0) {
    }
    return true;
}

static void nvmClearErrors() {
    NVMCTRL->STATUS.reg |= NVMCTRL_STATUS_PROGE | NVMCTRL_STATUS_LOCKE | NVMCTRL_STATUS_NVME;
}

static bool nvmOk() {
    return (NVMCTRL->STATUS.reg &
            (NVMCTRL_STATUS_PROGE | NVMCTRL_STATUS_LOCKE | NVMCTRL_STATUS_NVME)) == 0;
}

static bool eraseRow(uint32_t address) {
    if ((address % OTA_FLASH_ROW_SIZE) != 0 || address >= FLASH_END) {
        return false;
    }
    nvmWaitReady();
    nvmClearErrors();
    NVMCTRL->ADDR.reg = address / 2;
    NVMCTRL->CTRLA.reg = NVMCTRL_CTRLA_CMDEX_KEY | NVMCTRL_CTRLA_CMD_ER;
    nvmWaitReady();
    return nvmOk();
}

static bool writePage(uint32_t address, const uint8_t* data) {
    if ((address % OTA_FLASH_PAGE_SIZE) != 0 || address + OTA_FLASH_PAGE_SIZE > FLASH_END) {
        return false;
    }

    nvmWaitReady();
    nvmClearErrors();
    NVMCTRL->CTRLB.bit.MANW = 0;
    NVMCTRL->CTRLA.reg = NVMCTRL_CTRLA_CMDEX_KEY | NVMCTRL_CTRLA_CMD_PBC;
    nvmWaitReady();
    if (!nvmOk()) {
        return false;
    }

    volatile uint32_t* destination = reinterpret_cast<volatile uint32_t*>(address);
    for (size_t i = 0; i < OTA_FLASH_PAGE_SIZE / sizeof(uint32_t); ++i) {
        uint32_t word;
        memcpy(&word, data + i * sizeof(uint32_t), sizeof(word));
        destination[i] = word;
    }

    (void)*reinterpret_cast<volatile const uint32_t*>(address);
    NVMCTRL->CTRLA.reg = NVMCTRL_CTRLA_CMDEX_KEY | NVMCTRL_CTRLA_CMD_WP;
    nvmWaitReady();
    return nvmOk();
}

static bool writeMetadataRow(uint32_t address, const BootState& state) {
    uint8_t row[OTA_FLASH_ROW_SIZE];
    memset(row, 0xFF, sizeof(row));
    memcpy(row, &state, sizeof(state));

    if (!eraseRow(address)) {
        return false;
    }
    for (uint32_t offset = 0; offset < OTA_FLASH_ROW_SIZE; offset += OTA_FLASH_PAGE_SIZE) {
        if (!writePage(address + offset, row + offset)) {
            return false;
        }
    }
    const BootState& stored = *reinterpret_cast<const BootState*>(address);
    return metadataValid(stored) && stored.generation == state.generation;
}

static void copyText(char* destination, size_t size, const char* source) {
    if (size == 0) {
        return;
    }
    memset(destination, 0, size);
    if (source != NULL) {
        strncpy(destination, source, size - 1);
    }
}

static bool textDiffers(const char* stored, size_t size, const char* expected) {
    char normalized[32];
    if (size > sizeof(normalized)) {
        return true;
    }
    memset(normalized, 0, sizeof(normalized));
    if (expected != NULL) {
        strncpy(normalized, expected, size - 1);
    }
    return memcmp(stored, normalized, size) != 0;
}

static bool vectorValid(Slot slot) {
    const uint32_t base = slotBase(slot);
    if (base == 0) {
        return false;
    }
    const uint32_t stackPointer = *reinterpret_cast<const uint32_t*>(base);
    const uint32_t resetHandler = *reinterpret_cast<const uint32_t*>(base + 4);
    const uint32_t resetAddress = resetHandler & ~1UL;
    const bool stackValid = stackPointer >= 0x20000000UL && stackPointer <= 0x20008000UL;
    const bool resetValid = (resetHandler & 1UL) != 0 && resetAddress >= base &&
                            resetAddress < base + APP_SLOT_SIZE;
    return stackValid && resetValid;
}

static uint32_t crcFlash(uint32_t address, uint32_t length) {
    Crc32 crc;
    crc.update(reinterpret_cast<const uint8_t*>(address), length);
    return crc.value();
}

static void disableWatchdog() {
    if ((WDT->CTRL.reg & WDT_CTRL_ALWAYSON) != 0) {
        return;
    }
    WDT->CTRL.reg &= ~WDT_CTRL_ENABLE;
    while (WDT->STATUS.bit.SYNCBUSY) {
    }
}

static void configureTrialWatchdog() {
    disableWatchdog();

    GCLK->GENDIV.reg = GCLK_GENDIV_ID(2) | GCLK_GENDIV_DIV(4);
    while (GCLK->STATUS.bit.SYNCBUSY) {
    }
    GCLK->GENCTRL.reg = GCLK_GENCTRL_ID(2) |
                        GCLK_GENCTRL_GENEN |
                        GCLK_GENCTRL_SRC_OSCULP32K |
                        GCLK_GENCTRL_DIVSEL;
    while (GCLK->STATUS.bit.SYNCBUSY) {
    }
    GCLK->CLKCTRL.reg = GCLK_CLKCTRL_ID_WDT |
                        GCLK_CLKCTRL_CLKEN |
                        GCLK_CLKCTRL_GEN_GCLK2;
    while (GCLK->STATUS.bit.SYNCBUSY) {
    }

    WDT->CONFIG.reg = WDT_CONFIG_PER_8K;
    while (WDT->STATUS.bit.SYNCBUSY) {
    }
    WDT->CTRL.reg = WDT_CTRL_ENABLE;
    while (WDT->STATUS.bit.SYNCBUSY) {
    }
    WDT->CLEAR.reg = WDT_CLEAR_CLEAR_KEY;
    while (WDT->STATUS.bit.SYNCBUSY) {
    }
}

static void feedWatchdog() {
    if ((WDT->CTRL.reg & WDT_CTRL_ENABLE) == 0 || WDT->STATUS.bit.SYNCBUSY) {
        return;
    }
    WDT->CLEAR.reg = WDT_CLEAR_CLEAR_KEY;
}

static void jumpToSlot(Slot slot) {
    const uint32_t base = slotBase(slot);
    const uint32_t stackPointer = *reinterpret_cast<const uint32_t*>(base);
    const uint32_t resetHandler = *reinterpret_cast<const uint32_t*>(base + 4);

#if defined(USBCON)
    USBDevice.detach();
#endif
    SysTick->CTRL = 0;
    SysTick->LOAD = 0;
    SysTick->VAL = 0;
    __disable_irq();
    NVIC->ICER[0] = 0xFFFFFFFFUL;
    NVIC->ICPR[0] = 0xFFFFFFFFUL;
    __DSB();
    __ISB();
    SCB->VTOR = base;
    __DSB();
    __ISB();

    // A real Cortex-M reset enters the application with PRIMASK clear. The
    // updater disabled interrupts while tearing down its own runtime, so restore
    // that reset-state invariant before handing control to the app. SysTick and
    // all NVIC lines are still disabled/cleared here, so there is no interrupt
    // window before the application's Reset_Handler takes over.
    __enable_irq();
    __set_MSP(stackPointer);
    reinterpret_cast<void (*)()>(resetHandler)();
    while (true) {
    }
}

static void initializeState(BootState& state, Slot knownGood, uint8_t resetCause) {
    memset(&state, 0, sizeof(state));
    state.magic = METADATA_MAGIC;
    state.schema = METADATA_SCHEMA;
    state.bytes = sizeof(BootState);
    state.generation = 0;
    state.activeSlot = knownGood;
    state.knownGoodSlot = knownGood;
    state.pendingSlot = SLOT_NONE;
    state.trialSlot = SLOT_NONE;
    state.lastFailedSlot = SLOT_NONE;
    state.lastResetCause = resetCause;
    state.bootReason = BOOT_REASON_INITIALIZED;
    state.lastUpdateResult = UPDATE_RESULT_NONE;
}

static bool recordCurrentIdentity(BootState& state, const char* version, const char* build) {
    const Slot slot = currentSlot();
    if (slot != SLOT_A && slot != SLOT_B) {
        return false;
    }
    SlotInfo& info = state.slots[static_cast<uint8_t>(slot)];
    if (!textDiffers(info.version, sizeof(info.version), version) &&
        !textDiffers(info.build, sizeof(info.build), build)) {
        return true;
    }
    copyText(info.version, sizeof(info.version), version);
    copyText(info.build, sizeof(info.build), build);
    return saveState(state);
}

}  // namespace
