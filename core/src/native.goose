// Extern bindings to native.c: the operations Goose's os module lacks.
extern fn native_sha256_hex(data: const u8[:], out: u8[>..]&);
extern fn native_stat_file(path: const u8[:], size: i64&, mtime_ns: i64&) -> i64;
extern fn native_create_excl(path: const u8[:], data: const u8[:]) -> i64;
extern fn native_realpath(path: const u8[:], out: u8[>..]&) -> i64;
extern fn native_getpid() -> i64;
extern fn native_cpu_ns() -> i64;
extern fn native_pid_alive(pid: i64) -> i64;
extern fn native_pid_start(pid: i64) -> i64;
extern fn native_utc_rfc3339(out: u8[>..]&);
