/* Runs a shell command and appends its stdout to out. Used by the git change
   source only: the core never runs git (PLAN D-7). Returns the exit status,
   or -1 when the command could not be started. */
#include "goose.h"

#include <stdint.h>
#include <stdio.h>
#include <sys/wait.h>

typedef struct {
    const uint8_t* data;
    int64_t len;
} bytes_t;

int64_t run_capture(bytes_t cmd, gs_rref out) {
    char buf[4096];
    char* c = (char*)__builtin_alloca((size_t)cmd.len + 1);
    for (int64_t i = 0; i < cmd.len; i++)
        c[i] = (char)cmd.data[i];
    c[cmd.len] = 0;
    FILE* p = popen(c, "r");
    if (!p)
        return -1;
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, p)) > 0)
        gs_bld_append(out, buf, n);
    int st = pclose(p);
    if (st == -1)
        return -1;
    return (int64_t)WEXITSTATUS(st);
}
