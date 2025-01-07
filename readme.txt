Setup instructions:
-------------------

1. Install the p1am library: https://github.com/facts-engineering/P1AM?tab=readme-ov-file#p1am-library

2. Connect p1am to 24 volts

3. Connect ethernet shield to computer

4. Give ethernet an ip address. Linux instructions:

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