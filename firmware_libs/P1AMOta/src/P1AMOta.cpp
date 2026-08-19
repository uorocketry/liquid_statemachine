#include "P1AMOta.h"

#include <sam.h>
#include <stddef.h>
#include <string.h>

namespace P1AMOta {
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

}  // namespace P1AMOta
