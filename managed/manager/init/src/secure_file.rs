use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::fs::OpenOptionsExt as _;
use std::path::Path;

use nix::libc::{O_CLOEXEC, O_NOFOLLOW};

pub fn open_secret_source(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .custom_flags(O_CLOEXEC | O_NOFOLLOW)
        .open(path)
}

pub fn create_secret_destination(path: &Path) -> io::Result<File> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o400)
        .custom_flags(O_CLOEXEC | O_NOFOLLOW)
        .open(path)
}
