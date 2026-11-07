/* Native helpers for the incremental core. Each function is an extern fn in
   core/src/native.goose. Slices arrive as { data, len }, the layout of
   Goose's u8[:] (spec 7.10). Builders are appended through goose.h. */
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#ifdef __APPLE__
#include <sys/sysctl.h>
#endif
#include "goose.h"

#include <sys/types.h>
#include <time.h>
#include <unistd.h>

typedef struct {
    const uint8_t* data;
    int64_t len;
} bytes_t;

/* ---- SHA-256 (FIPS 180-4) ---- */
typedef struct {
    uint32_t h[8];
    uint64_t bits;
    uint8_t buf[64];
    size_t n;
} sha_ctx;

static const uint32_t K256[64] = {
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};

#define ROTR(x, n) (((x) >> (n)) | ((x) << (32 - (n))))

static void sha_block(sha_ctx* c, const uint8_t* p) {
    uint32_t w[64];
    for (int i = 0; i < 16; i++)
        w[i] = ((uint32_t)p[4 * i] << 24) | ((uint32_t)p[4 * i + 1] << 16) |
               ((uint32_t)p[4 * i + 2] << 8) | p[4 * i + 3];
    for (int i = 16; i < 64; i++) {
        uint32_t s0 = ROTR(w[i - 15], 7) ^ ROTR(w[i - 15], 18) ^ (w[i - 15] >> 3);
        uint32_t s1 = ROTR(w[i - 2], 17) ^ ROTR(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    uint32_t a = c->h[0], b = c->h[1], cc = c->h[2], d = c->h[3], e = c->h[4], f = c->h[5],
             g = c->h[6], h = c->h[7];
    for (int i = 0; i < 64; i++) {
        uint32_t S1 = ROTR(e, 6) ^ ROTR(e, 11) ^ ROTR(e, 25);
        uint32_t ch = (e & f) ^ (~e & g);
        uint32_t t1 = h + S1 + ch + K256[i] + w[i];
        uint32_t S0 = ROTR(a, 2) ^ ROTR(a, 13) ^ ROTR(a, 22);
        uint32_t mj = (a & b) ^ (a & cc) ^ (b & cc);
        uint32_t t2 = S0 + mj;
        h = g;
        g = f;
        f = e;
        e = d + t1;
        d = cc;
        cc = b;
        b = a;
        a = t1 + t2;
    }
    c->h[0] += a;
    c->h[1] += b;
    c->h[2] += cc;
    c->h[3] += d;
    c->h[4] += e;
    c->h[5] += f;
    c->h[6] += g;
    c->h[7] += h;
}

static void sha_init(sha_ctx* c) {
    static const uint32_t iv[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
                                   0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
    memcpy(c->h, iv, sizeof iv);
    c->bits = 0;
    c->n = 0;
}

static void sha_update(sha_ctx* c, const uint8_t* p, size_t len) {
    c->bits += (uint64_t)len * 8;
    while (len) {
        size_t take = 64 - c->n;
        if (take > len)
            take = len;
        memcpy(c->buf + c->n, p, take);
        c->n += take;
        p += take;
        len -= take;
        if (c->n == 64) {
            sha_block(c, c->buf);
            c->n = 0;
        }
    }
}

static void sha_final(sha_ctx* c, uint8_t out[32]) {
    uint64_t bits = c->bits;
    uint8_t pad = 0x80;
    sha_update(c, &pad, 1);
    uint8_t z = 0;
    while (c->n != 56)
        sha_update(c, &z, 1);
    uint8_t lb[8];
    for (int i = 0; i < 8; i++)
        lb[i] = (uint8_t)(bits >> (56 - 8 * i));
    sha_update(c, lb, 8);
    for (int i = 0; i < 8; i++)
        for (int j = 0; j < 4; j++)
            out[4 * i + j] = (uint8_t)(c->h[i] >> (24 - 8 * j));
}

/* sha256 of bytes as lowercase hex, appended to out. */
void native_sha256_hex(bytes_t data, gs_rref out) {
    sha_ctx c;
    uint8_t d[32];
    sha_init(&c);
    sha_update(&c, data.data, (size_t)data.len);
    sha_final(&c, d);
    static const char hx[] = "0123456789abcdef";
    char s[64];
    for (int i = 0; i < 32; i++) {
        s[2 * i] = hx[d[i] >> 4];
        s[2 * i + 1] = hx[d[i] & 15];
    }
    gs_bld_append(out, s, 64);
}

/* ---- paths ---- */
static int to_cpath(bytes_t p, char* buf, size_t cap) {
    if (p.len < 0 || (size_t)p.len >= cap)
        return 0;
    memcpy(buf, p.data, (size_t)p.len);
    buf[p.len] = 0;
    return 1;
}

/* 1 if the path is a regular file; size and mtime_ns (ns since epoch) written. */
int64_t native_stat_file(bytes_t path, int64_t* size, int64_t* mtime_ns) {
    char buf[PATH_MAX];
    struct stat st;
    if (!to_cpath(path, buf, sizeof buf) || stat(buf, &st) != 0 || !S_ISREG(st.st_mode))
        return 0;
    *size = (int64_t)st.st_size;
#ifdef __APPLE__
    *mtime_ns = (int64_t)st.st_mtimespec.tv_sec * 1000000000LL + (int64_t)st.st_mtimespec.tv_nsec;
#else
    *mtime_ns = (int64_t)st.st_mtim.tv_sec * 1000000000LL + (int64_t)st.st_mtim.tv_nsec;
#endif
    return 1;
}

/* Exclusive create with contents. 1 created, 0 already exists, -1 error. */
int64_t native_create_excl(bytes_t path, bytes_t data) {
    char buf[PATH_MAX];
    if (!to_cpath(path, buf, sizeof buf))
        return -1;
    int fd = open(buf, O_WRONLY | O_CREAT | O_EXCL, 0644);
    if (fd < 0)
        return errno == EEXIST ? 0 : -1;
    int64_t off = 0;
    while (off < data.len) {
        ssize_t w = write(fd, data.data + off, (size_t)(data.len - off));
        if (w <= 0) {
            close(fd);
            unlink(buf);
            return -1;
        }
        off += w;
    }
    close(fd);
    return 1;
}

/* Canonical path (realpath), appended to out. 1 on success. */
int64_t native_realpath(bytes_t path, gs_rref out) {
    char buf[PATH_MAX], res[PATH_MAX];
    if (!to_cpath(path, buf, sizeof buf))
        return 0;
    if (!realpath(buf, res))
        return 0;
    gs_bld_append(out, res, strlen(res));
    return 1;
}

/* ---- processes ---- */
int64_t native_getpid(void) {
    return (int64_t)getpid();
}

/* Process CPU time in nanoseconds, for the phase trace (INCREMENTAL_TRACE), so machine load does
 * not skew it. */
int64_t native_cpu_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &ts);
    return (int64_t)ts.tv_sec * 1000000000LL + (int64_t)ts.tv_nsec;
}

/* 1 if a process with this pid exists. */
int64_t native_pid_alive(int64_t pid) {
    if (pid <= 0)
        return 0;
    if (kill((pid_t)pid, 0) == 0)
        return 1;
    return errno == EPERM ? 1 : 0;
}

/* Start time of a process as microseconds since epoch, 0 if unknown. */
int64_t native_pid_start(int64_t pid) {
#ifdef __APPLE__
    struct kinfo_proc kp;
    size_t len = sizeof kp;
    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, (int)pid};
    if (sysctl(mib, 4, &kp, &len, NULL, 0) != 0 || len == 0)
        return 0;
    return (int64_t)kp.kp_proc.p_starttime.tv_sec * 1000000LL +
           (int64_t)kp.kp_proc.p_starttime.tv_usec;
#else
    /* /proc/<pid>/stat field 22 is the start time in clock ticks since boot. */
    char path[64], buf[1024];
    snprintf(path, sizeof path, "/proc/%lld/stat", (long long)pid);
    FILE* f = fopen(path, "r");
    if (!f)
        return 0;
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    fclose(f);
    buf[n] = 0;
    char* p = strrchr(buf, ')');
    if (!p)
        return 0;
    long long ticks = 0;
    /* After ")": state (field 3), then fields 4..22; starttime is the 20th token after ")". */
    char* tok = strtok(p + 2, " ");
    for (int i = 3; tok && i < 22; i++)
        tok = strtok(NULL, " ");
    if (!tok)
        return 0;
    ticks = strtoll(tok, NULL, 10);
    long hz = sysconf(_SC_CLK_TCK);
    if (hz <= 0)
        return 0;
    return (int64_t)(ticks * (1000000LL / hz));
#endif
}

/* Current UTC time as RFC 3339, appended to out. */
void native_utc_rfc3339(gs_rref out) {
    time_t t = time(NULL);
    struct tm tm;
    char s[32];
    gmtime_r(&t, &tm);
    size_t n = strftime(s, sizeof s, "%Y-%m-%dT%H:%M:%SZ", &tm);
    gs_bld_append(out, s, n);
}
