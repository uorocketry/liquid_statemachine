#include <SPI.h>
#include <Ethernet.h>

namespace {
constexpr uint8_t ETHERNET_CHIP_SELECT = 5;
constexpr uint16_t SERVER_PORT = 80;

byte macAddress[] = {0x60, 0x52, 0xD0, 0x08, 0x17, 0x38};
IPAddress localAddress(192, 168, 8, 50);
EthernetServer server(SERVER_PORT);

const char* hardwareName(EthernetHardwareStatus status) {
  switch (status) {
    case EthernetW5100: return "W5100";
    case EthernetW5200: return "W5200";
    case EthernetW5500: return "W5500";
    default: return "not detected";
  }
}

const char* linkName(EthernetLinkStatus status) {
  switch (status) {
    case LinkON: return "on";
    case LinkOFF: return "off";
    default: return "unknown";
  }
}

void printStatus() {
  Serial.print("hardware=");
  Serial.print(hardwareName(Ethernet.hardwareStatus()));
  Serial.print(" link=");
  Serial.print(linkName(Ethernet.linkStatus()));
  Serial.print(" ip=");
  Serial.println(Ethernet.localIP());
}
}  // namespace

void setup() {
  Serial.begin(115200);
  const unsigned long serialDeadline = millis() + 3000;
  while (!Serial && millis() < serialDeadline) {
    delay(10);
  }

  Serial.println("P1AM-ETH diagnostic starting");
  Ethernet.init(ETHERNET_CHIP_SELECT);
  Ethernet.begin(macAddress, localAddress);
  server.begin();
  printStatus();
}

void loop() {
  EthernetClient client = server.available();
  if (client) {
    client.println("P1AM-ETH diagnostic online");
    client.stop();
  }

  static unsigned long previousReport = 0;
  if (millis() - previousReport >= 1000) {
    previousReport = millis();
    printStatus();
  }
}
