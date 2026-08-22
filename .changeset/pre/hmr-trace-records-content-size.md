---
"zintljs": patch
"@zintljs/testing": patch
---

Record how many bytes of source each hot update carried.

A watcher that coalesces two saves reports one event, and nothing in the trace could say whether that
event carried the earlier or the later bytes — so a packet count that did not match the edit count
read as a lost event. Recording the size of the content the host handed over answers it directly,
without the compiler knowing anything about a file's contents, and it immediately disproved that
reading: the final edit of a burst does reach the compiler with the correct bytes, and the three
events before it are three separate saves that happen to be the same length.

Emitted on every `enter` entry and printed only when a contract fails, alongside the environment
recorded in the previous release.
