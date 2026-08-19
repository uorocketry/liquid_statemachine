#pragma once

#include <Arduino.h>

#ifndef P1AM_OTA_SLOT
#define P1AM_OTA_SLOT 255
#endif

namespace P1AMOta {

static const uint32_t FACTORY_BOOTLOADER_BASE = 0x00000;
static const uint32_t FACTORY_BOOTLOADER_SIZE = 0x02000;
static const uint32_t UPDATER_BASE = 0x02000;
static const uint32_t UPDATER_SIZE = 0x06000;
static const uint32_t APP_A_BASE = 0x08000;
static const uint32_t APP_B_BASE = 0x20000;
static const uint32_t APP_SLOT_SIZE = 0x18000;
static const uint32_t METADATA_0_BASE = 0x3FE00;
static const uint32_t METADATA_1_BASE = 0x3FF00;
static const uint32_t FLASH_END = 0x40000;
static const uint32_t OTA_FLASH_PAGE_SIZE = 64;
static const uint32_t OTA_FLASH_ROW_SIZE = 256;
static const uint32_t TRIAL_CONFIRM_WINDOW_MS = 30000;

static const uint32_t METADATA_MAGIC = 0x504F5441;  // "POTA"
static const uint16_t METADATA_SCHEMA = 1;

enum Slot : uint8_t {
    SLOT_A = 0,
    SLOT_B = 1,
    SLOT_NONE = 0xFF,
};

enum BootReason : uint8_t {
    BOOT_REASON_UNKNOWN = 0,
    BOOT_REASON_INITIALIZED = 1,
    BOOT_REASON_TRIAL = 2,
    BOOT_REASON_ROLLBACK = 3,
    BOOT_REASON_INVALID_UPDATE = 4,
    BOOT_REASON_CONFIRMED = 5,
};

enum UpdateResult : uint8_t {
    UPDATE_RESULT_NONE = 0,
    UPDATE_RESULT_CONFIRMED = 1,
    UPDATE_RESULT_ROLLED_BACK = 2,
    UPDATE_RESULT_INVALID_IMAGE = 3,
};

struct SlotInfo {
    uint32_t imageSize;
    uint32_t imageCrc32;
    char version[16];
    char build[16];
};

struct BootState {
    uint32_t magic;
    uint16_t schema;
    uint16_t bytes;
    uint32_t generation;
    uint8_t activeSlot;
    uint8_t knownGoodSlot;
    uint8_t pendingSlot;
    uint8_t trialSlot;
    uint8_t lastFailedSlot;
    uint8_t lastResetCause;
    uint8_t bootReason;
    uint8_t lastUpdateResult;
    uint32_t rollbackCount;
    char lastFailedVersion[16];
    char lastFailedBuild[16];
    SlotInfo slots[2];
    uint32_t stateCrc32;
};

class Crc32 {
public:
    Crc32();
    void update(const uint8_t* data, size_t length);
    uint32_t value() const;

private:
    uint32_t state_;
};

class FlashWriter {
public:
    FlashWriter();
    bool begin(uint32_t baseAddress, uint32_t imageSize);
    bool write(const uint8_t* data, size_t length);
    bool finish();
    uint32_t bytesWritten() const;

private:
    bool flushPage();

    uint32_t baseAddress_;
    uint32_t imageSize_;
    uint32_t bytesWritten_;
    uint32_t pageAddress_;
    uint8_t page_[OTA_FLASH_PAGE_SIZE];
    size_t pageUsed_;
    bool active_;
};

Slot currentSlot();
Slot inactiveSlot();
uint32_t slotBase(Slot slot);
const char* slotName(Slot slot);
const char* bootReasonName(BootReason reason);
const char* updateResultName(UpdateResult result);
const char* resetCauseName(uint8_t cause);

bool loadState(BootState& state);
bool saveState(BootState& state);
bool validateImage(Slot slot, uint32_t imageSize, uint32_t expectedCrc32);
bool stageUpdate(
    Slot target,
    uint32_t imageSize,
    uint32_t imageCrc32,
    const char* version,
    const char* build
);

void beginApplication(const char* version, const char* build);
void service();
bool isTrial();
uint32_t trialConfirmRemainingMs();
bool confirmCurrentApplication(const char* version, const char* build);

void updaterBoot();

}  // namespace P1AMOta
