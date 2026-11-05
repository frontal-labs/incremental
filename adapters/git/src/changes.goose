// The git change source (PLAN 11.7): builds a ChangeSet from a baseline to
// the worktree, with renames, deletions and untracked files. A separate
// binary, so the core never runs git (PLAN D-7).
//
//   incremental-git changes --base REF [--root DIR]
//
// Prints {"baseline", "head", "dirty", "changes": [...]} on stdout. Fails with
// invalid_params (exit 2) when REF is not in the history, for example in a
// shallow clone (PLAN 11.7): it never returns a partial ChangeSet.
import std;
import os;
import json;

extern fn run_capture(cmd: const u8[:], out: u8[>..]&) -> i64;

// A ref or path is passed to the shell, so only plain characters are allowed.
fn safe_arg(s: const u8[:]) -> bool {
    if s.len == 0 || s.len > 256 { return false; }
    for i in s.len {
        let c = s[i];
        let ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
            || c == '/' || c == '.' || c == '-' || c == '_' || c == '~' || c == '^' || c == '@';
        if !ok { return false; }
    }
    return true;
}

// Runs git in dir; returns the exit status and appends stdout to out.
fn git(dir: const u8[:], args: const u8[:], out: u8[>..]&) -> i64 {
    var cmd: u8[>..] = [];
    cmd.append("git -C '");
    cmd.append(dir);
    cmd.append("' ");
    cmd.append(args);
    cmd.append(" 2>/dev/null");
    return run_capture(cmd, out);
}

// Trims the trailing newline git prints.
fn line_of(out: u8[>..]&) -> const u8[:] {
    return trim(out);
}

fn main() {
    let av = args();
    var dir: u8[>..] = [];
    dir.append(".");
    var base: u8[>..] = [];
    var have_base = false;
    var i: i64 = 1;
    while i + 1 < av.len {
        if av[i] == "--base" { base.append(av[i + 1]); have_base = true; }
        if av[i] == "--root" { dir.clear(); dir.append(av[i + 1]); }
        i += 1;
    }
    // The directory is quoted for the shell, so a quote in it is refused.
    var quoted = false;
    for k in dir.len {
        if dir[k] == '\'' { quoted = true; }
    }
    if av.len < 2 || av[1] != "changes" || !have_base || !safe_arg(base) || quoted {
        write_stderr("usage: incremental-git changes --base REF [--root DIR]\n");
        exit(2);
    }

    // The baseline must be a commit we can reach. Otherwise fail, do not guess.
    var verified: u8[>..] = [];
    var rev: u8[>..] = [];
    rev.append("rev-parse --verify --quiet ");
    rev.append(base);
    rev.append("^{commit}");
    if git(dir, rev, verified) != 0 || trim(verified).len == 0 {
        write_stdout("{\"ok\":false,\"error\":{\"code\":\"invalid_params\",\"message\":\"baseline is not in the history (shallow clone?); run a full clone\"}}\n");
        exit(2);
    }
    var base_sha: u8[>..] = [];
    base_sha.append(trim(verified));

    var head: u8[>..] = [];
    git(dir, "rev-parse HEAD", head);

    var status: u8[>..] = [];
    git(dir, "status --porcelain", status);
    let dirty = status.len > 0;

    // Committed and staged changes from the baseline, with renames (-M).
    var diff: u8[>..] = [];
    var dargs: u8[>..] = [];
    dargs.append("diff --no-color --name-status -M ");
    dargs.append(base_sha);
    if git(dir, dargs, diff) != 0 {
        write_stdout("{\"ok\":false,\"error\":{\"code\":\"internal\",\"message\":\"git diff failed\"}}\n");
        exit(4);
    }
    // Untracked files count as added.
    var untracked: u8[>..] = [];
    git(dir, "ls-files --others --exclude-standard", untracked);

    var out: u8[>..] = [];
    out.append("{\"baseline\":");
    json::format_string(out, base_sha);
    out.append(",\"head\":");
    json::format_string(out, trim(head));
    out.append(",\"dirty\":");
    json::format_bool(out, dirty);
    out.append(",\"changes\":[");
    var first = true;
    let lines = split(diff, '\n');
    for k in lines.len {
        let ln = lines[k];
        if ln.len == 0 { continue; }
        let f = split(ln, '\t');
        if f.len < 2 { continue; }
        var st: u8[>..] = [];
        var status_name = "modified";
        if f[0][0] == 'A' { status_name = "added"; }
        else if f[0][0] == 'D' { status_name = "deleted"; }
        else if f[0][0] == 'R' { status_name = "renamed"; }
        else if f[0][0] == 'C' { status_name = "added"; }
        if !first { out.push(','); }
        first = false;
        out.append("{\"path\":");
        if status_name == "renamed" && f.len >= 3 {
            json::format_string(out, f[2]);
            out.append(",\"status\":\"renamed\",\"old_path\":");
            json::format_string(out, f[1]);
        } else {
            json::format_string(out, f[1]);
            out.append(",\"status\":");
            json::format_string(out, status_name);
        }
        out.push('}');
    }
    let ulines = split(untracked, '\n');
    for k in ulines.len {
        if ulines[k].len == 0 { continue; }
        if !first { out.push(','); }
        first = false;
        out.append("{\"path\":");
        json::format_string(out, ulines[k]);
        out.append(",\"status\":\"added\"}");
    }
    out.append("]}\n");
    write_stdout(out);
}
