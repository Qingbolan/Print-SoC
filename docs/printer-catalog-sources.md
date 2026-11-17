# Printer catalogue sources

Checked 2026-11-17.

The requested [nus-soc-print README](https://github.com/yeokm1/nus-soc-print/blob/master/README.md)
contains feature descriptions, not a printer table. Its actual Android catalogue is
[`printer_names` in strings.xml](https://github.com/yeokm1/nus-soc-print/blob/master/app/src/main/res/values/strings.xml):

- psts, psts-sx
- pstsb, pstsb-sx
- pstsc, pstsc-sx
- psc008, psc008-sx
- psc011, psc011-sx
- psc245, psc245-sx

These are historical names. Existing pstsb/pstsc normalization is retained. The
missing psc245 pair is recorded with unknown model and unverified location/access;
it is shown when the connected server advertises it, not assumed public or online.

The existing catalogue also contains colour, COM3 and COM4 public printers.
Those entries are no longer hidden by the five-group common-printer whitelist.
Server-discovered queues are retained for student accounts too. Discovery is not
proof of authorization or printer health; unknown queues retain Unknown status.

The upstream catalogue is not claimed to be an exhaustive current NUS inventory.
Runtime discovery from the selected SoC server remains necessary for current queue
names, and submission authorization is enforced by that server.
