Arduino IDE Setup Instructions
-------------------------------

1. Install
- the P1AM library: https://github.com/facts-engineering/P1AM?tab=readme-ov-file#installing-the-library
- the ArduinoJson, StateMachine, and TaskManagerIO library in the Arduino IDE

If you encounter an error like "No device found on ttyACM0", this probably means you don't have the right permissions for the /dev/ttyACM0 file. See https://stackoverflow.com/a/49063205.

Ethernet Setup Instructions
---------------------------

2. Connect ethernet shield to computer (no power source is needed, it seems like the computer by itself can power the P1AM).

3. Give ethernet an ip address. Linux instructions:

    $ ip a
    ...
    7: enp0s20f0u2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
        link/ether 00:e0:4c:88:fb:b3 brd ff:ff:ff:ff:ff:ff
        altname enx00e04c88fbb3
        inet6 fe80::5d3b:7df6:d4bc:8a15/64 scope link tentative noprefixroute
           valid_lft forever preferred_lft forever

Note that the id here is enp0s20f0u2

    $ sudo ifconfig enp0s20f0u2 192.168.1.1

    $ ip a
    ...
    7: enp0s20f0u2: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000
        link/ether 00:e0:4c:88:fb:b3 brd ff:ff:ff:ff:ff:ff
        altname enx00e04c88fbb3
        inet 192.168.1.1/24 brd 192.168.1.255 scope global enp0s20f0u2
           valid_lft forever preferred_lft forever
        inet6 fe80::5d3b:7df6:d4bc:8a15/64 scope link noprefixroute
           valid_lft forever preferred_lft forever

Now, we have the ip 192.168.1.1, and can connect.


Talking to the Arduino
----------------------

Every command is a single byte. The response will be first a length byte l, then l body bytes.

Commands 0 through 5 set the state. The response's body, an acknowledgement, will echo back the command. However, this doesn't mean that the state was set: perhaps it is an invalid transition.

Command 255 queries the state. The body of the response is the current state.

Command 254 queries possible transitions from the current state. Each byte in the body of the response is a state number that can be transitioned to.

All other commands are invalid, and their response body is 255.


Starting the Box
----------------
1. Breaker on
2. Blue button
3. Connect arduino
4. Make sure coaxial cable is connected
5. Connect ethernet

Stopping the Box
----------------
1. Breaker off
