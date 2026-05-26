---
"@zintl/compiler": patch
---

**⚡ Performance Benchmark Changes Detected**:

**Summary:** 🔴 1 benchmark(s) regressed (normalized and calibrated against Reference Calibration machine-speed differences).

| Benchmark                   | Baseline | New Run                        | Calibrated Delta | Status       |
| :-------------------------- | :------- | :----------------------------- | :--------------- | :----------- |
| Catalog Serialization Logic | 210.1 µs | 278.9 µs (278.6 µs calibrated) | +32.60%          | ⚠️ Regressed |
