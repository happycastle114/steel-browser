use std::env;
use std::fs::{self, File};
use std::io::{Read, Write as _};
use std::os::fd::AsRawFd as _;
use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
use std::os::unix::process::CommandExt as _;
use std::path::Path;
use std::process::Command;

use anyhow::{Context as _, ensure};
use nix::dir::Dir;
use nix::fcntl::OFlag;
use nix::sys::stat::{Mode, fchmod};
use nix::unistd::{Gid, Uid, fchown, getgid, getpid, getuid};
use steel_manager_init::{
    MANAGER_GID, MANAGER_UID, RELEASE_EVIDENCE_MAX_LENGTH, RELEASE_EVIDENCE_SOURCE_PATH,
    RELEASE_EVIDENCE_TARGET_PATH, SECRET_LENGTH, SOURCE_PATH, TARGET_PATH,
    secure_file::create_secret_destination, secure_file::open_secret_source, validate_fd_scan,
    validate_manager_argv, validate_mountinfo, validate_proc_status, validate_release_evidence,
    validate_release_evidence_sha256, validate_secret,
};
use zeroize::{Zeroize as _, Zeroizing};

mod privilege;

use privilege::drop_privileges;

const SOURCE_DIRECTORY: &str = "/run/steel-secret-source";
const RELEASE_EVIDENCE_SOURCE_DIRECTORY: &str = "/run/steel-release-evidence-source";
const TARGET_DIRECTORY: &str = "/run/steel";
const PROC_SELF_FD_DIRECTORY: &str = "/proc/self/fd";

struct DestinationCleanup;

impl Drop for DestinationCleanup {
    fn drop(&mut self) {
        drop(fs::remove_file(TARGET_PATH));
        drop(fs::remove_file(RELEASE_EVIDENCE_TARGET_PATH));
    }
}

pub fn run() -> anyhow::Result<()> {
    let manager =
        validate_manager_argv(env::args_os().skip(1)).context("validating manager command")?;
    ensure!(getpid().as_raw() == 1, "init must be PID 1");
    ensure!(
        getuid().is_root() && getgid().as_raw() == 0,
        "init must start as root"
    );
    require_source_directory(SOURCE_DIRECTORY)
        .context("validating create-token secret source directory")?;
    require_source_directory(RELEASE_EVIDENCE_SOURCE_DIRECTORY)
        .context("validating release-evidence source directory")?;
    require_destination_mount().context("preparing manager runtime tmpfs")?;
    let cleanup = copy_secret().context("materializing create-token secret")?;
    copy_release_evidence(manager.release_evidence_sha256())
        .context("materializing release evidence")?;
    finalize_destination_mount().context("finalizing manager runtime tmpfs")?;
    validate_fd_scan(&scan_descriptors().context("scanning init descriptors before drop")?)
        .context("validating init descriptors before drop")?;
    drop_privileges().context("dropping manager init privileges")?;
    validate_proc_status(
        &fs::read_to_string("/proc/self/status").context("reading final process status")?,
    )
    .context("validating final process status")?;
    validate_fd_scan(&scan_descriptors().context("scanning init descriptors after drop")?)
        .context("validating init descriptors after drop")?;
    let error = Command::new(manager.program())
        .args(manager.arguments())
        .exec();
    drop(cleanup);
    Err(error).context("executing steel managed manager")
}

fn require_source_directory(path: &str) -> anyhow::Result<()> {
    let metadata = fs::symlink_metadata(path)
        .with_context(|| format!("reading source directory metadata for {path}"))?;
    ensure!(
        metadata.is_dir(),
        "secret source directory must be a directory"
    );
    ensure!(
        metadata.uid() == 0 && metadata.gid() == 0,
        "secret source owner mismatch"
    );
    ensure!(
        metadata.mode() & 0o777 == 0o700,
        "secret source mode mismatch"
    );
    Ok(())
}

fn require_destination_mount() -> anyhow::Result<()> {
    let mountinfo =
        fs::read_to_string("/proc/self/mountinfo").context("reading manager mount table")?;
    validate_mountinfo(&mountinfo).context("validating manager runtime tmpfs mount")?;
    let metadata =
        fs::symlink_metadata(TARGET_DIRECTORY).context("reading manager runtime tmpfs metadata")?;
    ensure!(metadata.is_dir(), "secret destination must be a directory");
    ensure!(
        metadata.uid() == 0 && metadata.gid() == 0,
        "secret destination owner mismatch"
    );
    fs::set_permissions(TARGET_DIRECTORY, fs::Permissions::from_mode(0o700))
        .context("setting manager runtime tmpfs mode")?;
    Ok(())
}

fn finalize_destination_mount() -> anyhow::Result<()> {
    nix::unistd::chown(
        Path::new(TARGET_DIRECTORY),
        Some(Uid::from_raw(MANAGER_UID)),
        Some(Gid::from_raw(MANAGER_GID)),
    )
    .context("changing manager runtime tmpfs ownership")?;
    Ok(())
}

fn copy_secret() -> anyhow::Result<DestinationCleanup> {
    let mut source =
        open_secret_source(Path::new(SOURCE_PATH)).context("opening create-token secret source")?;
    ensure!(
        source.as_raw_fd() == 3,
        "source secret descriptor must be 3"
    );
    require_root_only_regular(&source)?;
    let mut bytes = Zeroizing::new([0_u8; SECRET_LENGTH + 1]);
    source.read_exact(&mut bytes[..SECRET_LENGTH])?;
    ensure!(
        source.read(&mut bytes[SECRET_LENGTH..])? == 0,
        "source secret exceeds bound"
    );
    validate_secret(&bytes[..SECRET_LENGTH])?;

    let mut destination = create_secret_destination(Path::new(TARGET_PATH))
        .context("creating create-token secret destination")?;
    let cleanup = DestinationCleanup;
    ensure!(
        destination.as_raw_fd() == 4,
        "destination secret descriptor must be 4"
    );
    fchmod(&destination, Mode::S_IRUSR).context("setting create-token secret mode")?;
    destination
        .write_all(&bytes[..SECRET_LENGTH])
        .context("writing create-token secret")?;
    destination
        .sync_all()
        .context("syncing create-token secret")?;
    File::open(TARGET_DIRECTORY)
        .context("opening manager runtime directory for create-token sync")?
        .sync_all()
        .context("syncing manager runtime directory after create-token write")?;
    verify_target_bytes(Path::new(TARGET_PATH), &bytes[..SECRET_LENGTH], None)?;
    fchown(
        &destination,
        Some(Uid::from_raw(MANAGER_UID)),
        Some(Gid::from_raw(MANAGER_GID)),
    )
    .context("changing create-token secret ownership")?;
    require_manager_regular(&destination)?;
    drop(destination);
    drop(source);
    bytes.zeroize();
    Ok(cleanup)
}

fn copy_release_evidence(expected_sha256: &[u8; 32]) -> anyhow::Result<()> {
    let mut source = open_secret_source(Path::new(RELEASE_EVIDENCE_SOURCE_PATH))
        .context("opening release-evidence source")?;
    ensure!(
        source.as_raw_fd() == 3,
        "release evidence source descriptor must be 3"
    );
    require_root_read_only_regular(&source)?;
    let mut bytes = Zeroizing::new(Vec::with_capacity(RELEASE_EVIDENCE_MAX_LENGTH + 1));
    Read::by_ref(&mut source)
        .take((RELEASE_EVIDENCE_MAX_LENGTH + 1) as u64)
        .read_to_end(&mut bytes)?;
    validate_release_evidence(&bytes)?;
    validate_release_evidence_sha256(&bytes, expected_sha256)?;

    let mut destination = create_secret_destination(Path::new(RELEASE_EVIDENCE_TARGET_PATH))
        .context("creating release-evidence destination")?;
    ensure!(
        destination.as_raw_fd() == 4,
        "release evidence destination descriptor must be 4"
    );
    fchmod(&destination, Mode::S_IRUSR).context("setting release-evidence mode")?;
    destination
        .write_all(&bytes)
        .context("writing release evidence")?;
    destination.sync_all().context("syncing release evidence")?;
    File::open(TARGET_DIRECTORY)
        .context("opening manager runtime directory for release-evidence sync")?
        .sync_all()
        .context("syncing manager runtime directory after release-evidence write")?;
    verify_target_bytes(
        Path::new(RELEASE_EVIDENCE_TARGET_PATH),
        &bytes,
        Some(expected_sha256),
    )?;
    fchown(
        &destination,
        Some(Uid::from_raw(MANAGER_UID)),
        Some(Gid::from_raw(MANAGER_GID)),
    )
    .context("changing release-evidence ownership")?;
    require_manager_regular(&destination)?;
    drop(destination);
    drop(source);
    bytes.zeroize();
    Ok(())
}

fn verify_target_bytes(
    path: &Path,
    expected: &[u8],
    expected_sha256: Option<&[u8; 32]>,
) -> anyhow::Result<()> {
    let mut target = open_secret_source(path)?;
    let mut observed = Zeroizing::new(Vec::with_capacity(expected.len() + 1));
    Read::by_ref(&mut target)
        .take((expected.len() + 1) as u64)
        .read_to_end(&mut observed)?;
    ensure!(
        observed.as_slice() == expected,
        "destination byte identity mismatch"
    );
    if let Some(expected_digest) = expected_sha256 {
        validate_release_evidence_sha256(&observed, expected_digest)?;
    }
    observed.zeroize();
    Ok(())
}

fn require_root_only_regular(file: &File) -> anyhow::Result<()> {
    let metadata = file.metadata()?;
    ensure!(metadata.is_file(), "source secret must be regular");
    ensure!(
        metadata.uid() == 0 && metadata.gid() == 0,
        "source secret owner mismatch"
    );
    ensure!(
        metadata.mode().is_multiple_of(0o100),
        "source secret must be root-only"
    );
    Ok(())
}

fn require_root_read_only_regular(file: &File) -> anyhow::Result<()> {
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file(),
        "release evidence source must be regular"
    );
    ensure!(
        metadata.uid() == 0 && metadata.gid() == 0,
        "release evidence source owner mismatch"
    );
    let mode = metadata.mode() & 0o777;
    ensure!(
        mode & 0o400 != 0 && mode & 0o333 == 0,
        "release evidence source must be read-only"
    );
    Ok(())
}

fn require_manager_regular(file: &File) -> anyhow::Result<()> {
    let metadata = file.metadata()?;
    ensure!(metadata.is_file(), "destination secret must be regular");
    ensure!(
        metadata.uid() == MANAGER_UID && metadata.gid() == MANAGER_GID,
        "destination secret owner mismatch"
    );
    ensure!(
        metadata.mode() & 0o777 == 0o400,
        "destination secret mode mismatch"
    );
    Ok(())
}

fn scan_descriptors() -> anyhow::Result<Vec<(i32, String)>> {
    let mut directory = Dir::open(
        PROC_SELF_FD_DIRECTORY,
        OFlag::O_RDONLY | OFlag::O_DIRECTORY | OFlag::O_CLOEXEC,
        Mode::empty(),
    )
    .context("opening init descriptor directory")?;
    let scanner_descriptor = directory.as_raw_fd();
    let mut descriptors = Vec::new();
    for entry in directory.iter() {
        let entry = entry.context("reading init descriptor directory")?;
        let Ok(name) = entry.file_name().to_str() else {
            continue;
        };
        let Ok(raw_descriptor) = name.parse::<i32>() else {
            continue;
        };
        if raw_descriptor == scanner_descriptor {
            continue;
        }
        match fs::read_link(Path::new(PROC_SELF_FD_DIRECTORY).join(name)) {
            Ok(target) => descriptors.push((raw_descriptor, target.to_string_lossy().into_owned())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    descriptors.sort_by_key(|(descriptor, _)| *descriptor);
    Ok(descriptors)
}
