Crc32::Crc32() : state_(0xFFFFFFFFUL) {
}
void Crc32::update(const uint8_t* data, size_t length) {
    state_ = crc32Raw(state_, data, length);
}

uint32_t Crc32::value() const {
    return state_ ^ 0xFFFFFFFFUL;
}

FlashWriter::FlashWriter()
    : baseAddress_(0), imageSize_(0), bytesWritten_(0), pageAddress_(0), pageUsed_(0), active_(false) {
    memset(page_, 0xFF, sizeof(page_));
}

bool FlashWriter::begin(uint32_t baseAddress, uint32_t imageSize) {
    if ((baseAddress != APP_A_BASE && baseAddress != APP_B_BASE) || imageSize == 0 ||
        imageSize > APP_SLOT_SIZE) {
        return false;
    }
    const uint32_t eraseBytes = (imageSize + OTA_FLASH_ROW_SIZE - 1) & ~(OTA_FLASH_ROW_SIZE - 1);
    for (uint32_t offset = 0; offset < eraseBytes; offset += OTA_FLASH_ROW_SIZE) {
        if (!eraseRow(baseAddress + offset)) {
            return false;
        }
    }

    baseAddress_ = baseAddress;
    imageSize_ = imageSize;
    bytesWritten_ = 0;
    pageAddress_ = baseAddress;
    pageUsed_ = 0;
    active_ = true;
    memset(page_, 0xFF, sizeof(page_));
    return true;
}

bool FlashWriter::write(const uint8_t* data, size_t length) {
    if (!active_ || bytesWritten_ + length > imageSize_) {
        return false;
    }
    size_t consumed = 0;
    while (consumed < length) {
        const size_t space = OTA_FLASH_PAGE_SIZE - pageUsed_;
        const size_t chunk = (length - consumed < space) ? length - consumed : space;
        memcpy(page_ + pageUsed_, data + consumed, chunk);
        pageUsed_ += chunk;
        bytesWritten_ += chunk;
        consumed += chunk;
        if (pageUsed_ == OTA_FLASH_PAGE_SIZE && !flushPage()) {
            return false;
        }
    }
    return true;
}

bool FlashWriter::finish() {
    if (!active_ || bytesWritten_ != imageSize_) {
        return false;
    }
    if (pageUsed_ > 0 && !flushPage()) {
        return false;
    }
    active_ = false;
    return true;
}

uint32_t FlashWriter::bytesWritten() const {
    return bytesWritten_;
}

bool FlashWriter::flushPage() {
    if (!writePage(pageAddress_, page_)) {
        active_ = false;
        return false;
    }
    pageAddress_ += OTA_FLASH_PAGE_SIZE;
    pageUsed_ = 0;
    memset(page_, 0xFF, sizeof(page_));
    return true;
}

Slot currentSlot() {
#if P1AM_OTA_SLOT == 0
    return SLOT_A;
#elif P1AM_OTA_SLOT == 1
    return SLOT_B;
#else
    return SLOT_NONE;
#endif
}

Slot inactiveSlot() {
    return currentSlot() == SLOT_A ? SLOT_B : (currentSlot() == SLOT_B ? SLOT_A : SLOT_NONE);
}

uint32_t slotBase(Slot slot) {
    return slot == SLOT_A ? APP_A_BASE : (slot == SLOT_B ? APP_B_BASE : 0);
}

const char* slotName(Slot slot) {
    return slot == SLOT_A ? "A" : (slot == SLOT_B ? "B" : "none");
}

const char* bootReasonName(BootReason reason) {
    switch (reason) {
        case BOOT_REASON_INITIALIZED: return "initialized";
        case BOOT_REASON_TRIAL: return "trial";
        case BOOT_REASON_ROLLBACK: return "rollback";
        case BOOT_REASON_INVALID_UPDATE: return "invalid_update";
        case BOOT_REASON_CONFIRMED: return "confirmed";
        default: return "unknown";
    }
}

const char* updateResultName(UpdateResult result) {
    switch (result) {
        case UPDATE_RESULT_CONFIRMED: return "confirmed";
        case UPDATE_RESULT_ROLLED_BACK: return "rolled_back";
        case UPDATE_RESULT_INVALID_IMAGE: return "invalid_image";
        default: return "none";
    }
}

const char* resetCauseName(uint8_t cause) {
    if (cause & PM_RCAUSE_WDT) return "watchdog";
    if (cause & PM_RCAUSE_SYST) return "software";
    if (cause & PM_RCAUSE_EXT) return "external";
    if (cause & PM_RCAUSE_BOD33) return "brownout_33";
    if (cause & PM_RCAUSE_BOD12) return "brownout_12";
    if (cause & PM_RCAUSE_POR) return "power_on";
    return "unknown";
}

bool loadState(BootState& state) {
    int source = -1;
    return loadStateDetailed(state, source);
}

bool saveState(BootState& state) {
    BootState previous;
    int source = -1;
    if (loadStateDetailed(previous, source)) {
        if (!newerGeneration(state.generation, previous.generation)) {
            state.generation = previous.generation + 1;
        }
    } else {
        state.generation = state.generation + 1;
    }

    state.magic = METADATA_MAGIC;
    state.schema = METADATA_SCHEMA;
    state.bytes = sizeof(BootState);
    state.stateCrc32 = stateCrc(state);

    const uint32_t target = source == 0 ? METADATA_1_BASE : METADATA_0_BASE;
    return writeMetadataRow(target, state);
}

bool validateImage(Slot slot, uint32_t imageSize, uint32_t expectedCrc32) {
    if ((slot != SLOT_A && slot != SLOT_B) || imageSize == 0 || imageSize > APP_SLOT_SIZE ||
        !vectorValid(slot)) {
        return false;
    }
    return crcFlash(slotBase(slot), imageSize) == expectedCrc32;
}

bool stageUpdate(
    Slot target,
    uint32_t imageSize,
    uint32_t imageCrc32,
    const char* version,
    const char* build
) {
    if (target == SLOT_NONE || target == currentSlot() || imageSize == 0 || imageSize > APP_SLOT_SIZE) {
        return false;
    }

    BootState state;
    if (!loadState(state) || state.trialSlot != SLOT_NONE) {
        return false;
    }

    SlotInfo& info = state.slots[static_cast<uint8_t>(target)];
    info.imageSize = imageSize;
    info.imageCrc32 = imageCrc32;
    copyText(info.version, sizeof(info.version), version);
    copyText(info.build, sizeof(info.build), build);
    state.pendingSlot = target;
    state.activeSlot = currentSlot();
    state.lastResetCause = PM->RCAUSE.reg;
    return saveState(state);
}
