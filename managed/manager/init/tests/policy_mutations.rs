use std::convert::Infallible;
use std::fs;
use std::io;
use std::os::unix::fs::{MetadataExt as _, symlink};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use nix::fcntl::{FcntlArg, FdFlag, OFlag, fcntl};
use steel_manager_init::secure_file::{create_secret_destination, open_secret_source};
use steel_manager_init::{
    InitPolicyError, PrivilegeKernel, execute_privilege_drop, validate_fd_scan, validate_mountinfo,
    validate_proc_status, validate_release_evidence, validate_release_evidence_sha256,
    validate_secret,
};

const VALID_STATUS: &str = "Uid:\t10001\t10001\t10001\t10001\nGid:\t10001\t10001\t10001\t10001\nGroups:\t\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapBnd:\t0000000000000000\nCapAmb:\t0000000000000000\nNoNewPrivs:\t1\n";
static TEST_DIRECTORY_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ObservedPrivilegeStep {
    RequireCapabilities,
    SetgroupsEmpty,
    DropCapabilityBoundingSet,
    SetNoNewPrivileges,
    SetresgidManager,
    SetresuidManager,
    ClearCapabilitySets,
}

#[derive(Default)]
struct RecordingPrivilegeKernel {
    observed: Vec<ObservedPrivilegeStep>,
}

impl PrivilegeKernel for RecordingPrivilegeKernel {
    type Error = Infallible;

    fn require_capabilities(&mut self) -> Result<(), Self::Error> {
        self.observed
            .push(ObservedPrivilegeStep::RequireCapabilities);
        Ok(())
    }

    fn setgroups_empty(&mut self) -> Result<(), Self::Error> {
        self.observed.push(ObservedPrivilegeStep::SetgroupsEmpty);
        Ok(())
    }

    fn drop_capability_bounding_set(&mut self) -> Result<(), Self::Error> {
        self.observed
            .push(ObservedPrivilegeStep::DropCapabilityBoundingSet);
        Ok(())
    }

    fn set_no_new_privileges(&mut self) -> Result<(), Self::Error> {
        self.observed
            .push(ObservedPrivilegeStep::SetNoNewPrivileges);
        Ok(())
    }

    fn setresgid_manager(&mut self) -> Result<(), Self::Error> {
        self.observed.push(ObservedPrivilegeStep::SetresgidManager);
        Ok(())
    }

    fn setresuid_manager(&mut self) -> Result<(), Self::Error> {
        self.observed.push(ObservedPrivilegeStep::SetresuidManager);
        Ok(())
    }

    fn clear_capability_sets(&mut self) -> Result<(), Self::Error> {
        self.observed
            .push(ObservedPrivilegeStep::ClearCapabilitySets);
        Ok(())
    }
}

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn create() -> io::Result<Self> {
        let sequence = TEST_DIRECTORY_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "steel-manager-init-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path)?;
        Ok(Self(path))
    }

    fn join(&self, value: impl AsRef<Path>) -> PathBuf {
        self.0.join(value)
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        drop(fs::remove_dir_all(&self.0));
    }
}

#[test]
fn production_privilege_orchestrator_executes_the_required_order() {
    let mut kernel = RecordingPrivilegeKernel::default();

    assert_eq!(execute_privilege_drop(&mut kernel), Ok(()));
    assert_eq!(
        kernel.observed,
        [
            ObservedPrivilegeStep::RequireCapabilities,
            ObservedPrivilegeStep::SetgroupsEmpty,
            ObservedPrivilegeStep::DropCapabilityBoundingSet,
            ObservedPrivilegeStep::SetNoNewPrivileges,
            ObservedPrivilegeStep::SetresgidManager,
            ObservedPrivilegeStep::SetresuidManager,
            ObservedPrivilegeStep::ClearCapabilitySets,
        ]
    );
}

#[test]
fn production_source_open_rejects_symlinks_and_sets_cloexec()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = TestDirectory::create()?;
    let regular = directory.join("regular");
    let linked = directory.join("linked");
    fs::write(&regular, [b'a'; 64])?;
    symlink(&regular, &linked)?;

    let source = open_secret_source(&regular)?;
    assert!(open_secret_source(&linked).is_err());
    assert_eq!(access_mode(&source)?, OFlag::O_RDONLY);
    assert!(descriptor_flags(&source)?.contains(FdFlag::FD_CLOEXEC));
    Ok(())
}

#[test]
fn production_destination_open_is_exclusive_write_only_and_cloexec()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = TestDirectory::create()?;
    let target = directory.join("target");
    let destination = create_secret_destination(&target)?;

    assert_eq!(access_mode(&destination)?, OFlag::O_WRONLY);
    assert!(descriptor_flags(&destination)?.contains(FdFlag::FD_CLOEXEC));
    assert_eq!(destination.metadata()?.mode() & 0o777, 0o400);
    drop(destination);
    assert_eq!(
        create_secret_destination(&target)
            .err()
            .map(|error| error.kind()),
        Some(io::ErrorKind::AlreadyExists)
    );
    Ok(())
}

#[test]
fn accepts_only_exact_lowercase_hex_secret_bytes() {
    let valid = vec![b'a'; 64];
    let uppercase = vec![b'A'; 64];
    let newline = [vec![b'a'; 63], vec![b'\n']].concat();
    let short = vec![b'a'; 63];
    let long = vec![b'a'; 65];
    let results = [
        validate_secret(&uppercase),
        validate_secret(&newline),
        validate_secret(&short),
        validate_secret(&long),
    ];

    assert_eq!(validate_secret(&valid), Ok(()));
    assert!(
        results
            .iter()
            .all(|result| *result == Err(InitPolicyError::Secret))
    );
}

#[test]
fn accepts_only_bounded_utf8_object_release_evidence() {
    let valid = br#"{"schemaVersion":1}"#;
    let empty = b"";
    let array = b"[]";
    let raw_control = b"{\x00}";
    let oversized = vec![b'a'; 65_537];
    let results = [
        validate_release_evidence(empty),
        validate_release_evidence(array),
        validate_release_evidence(raw_control),
        validate_release_evidence(&oversized),
    ];

    assert_eq!(validate_release_evidence(valid), Ok(()));
    assert!(
        results
            .iter()
            .all(|result| *result == Err(InitPolicyError::ReleaseEvidence))
    );
}

#[test]
fn binds_release_evidence_to_the_exact_raw_file_sha256() {
    let bytes = b"{\"schemaVersion\":1}\n";
    let expected = [
        0x80, 0xf3, 0xd9, 0x06, 0x66, 0x80, 0x4a, 0x93, 0x35, 0x82, 0x1c, 0xdb, 0x40, 0x78, 0x24,
        0x58, 0x83, 0x5f, 0xfe, 0xda, 0xef, 0x33, 0x08, 0x8b, 0xd1, 0xdc, 0x5e, 0xb3, 0xef, 0x85,
        0xce, 0x61,
    ];

    assert_eq!(validate_release_evidence_sha256(bytes, &expected), Ok(()));
    assert_eq!(
        validate_release_evidence_sha256(bytes, &[0_u8; 32]),
        Err(InitPolicyError::ReleaseEvidence)
    );
}

#[test]
fn rejects_non_tmpfs_or_weakened_mount_flags() {
    let valid = "42 31 0:38 / /run/steel rw,nosuid,nodev,noexec - tmpfs tmpfs rw,size=8192k";
    let filesystem = valid.replace(" - tmpfs ", " - ext4 ");
    let executable = valid.replace(",noexec", "");
    let results = [
        validate_mountinfo(&filesystem),
        validate_mountinfo(&executable),
    ];

    assert_eq!(validate_mountinfo(valid), Ok(()));
    assert!(
        results
            .iter()
            .all(|result| *result == Err(InitPolicyError::Mount))
    );
}

#[test]
fn rejects_each_final_privilege_status_mutation() {
    let mutations = [
        VALID_STATUS.replace("Uid:\t10001", "Uid:\t0"),
        VALID_STATUS.replace("Groups:\t\n", "Groups:\t10001\n"),
        VALID_STATUS.replace("CapBnd:\t0000000000000000", "CapBnd:\t0000000000000001"),
        VALID_STATUS.replace("NoNewPrivs:\t1", "NoNewPrivs:\t0"),
    ];
    let results: Vec<_> = mutations
        .iter()
        .map(|value| validate_proc_status(value))
        .collect();

    assert_eq!(validate_proc_status(VALID_STATUS), Ok(()));
    assert!(
        results
            .iter()
            .all(|result| *result == Err(InitPolicyError::Status))
    );
}

#[test]
fn rejects_secret_or_unclassified_descriptors() {
    let valid = vec![
        (0, "/dev/null".to_owned()),
        (1, "pipe:[1]".to_owned()),
        (2, "pipe:[2]".to_owned()),
    ];
    let mut secret = valid.clone();
    secret[0].1 = "/run/steel/managed-create-token-key".to_owned();
    let mut release_evidence = valid.clone();
    release_evidence[0].1 = "/run/steel/managed-release-evidence.json".to_owned();
    let mut inherited = valid.clone();
    inherited.push((3, "socket:[3]".to_owned()));
    let results = [
        validate_fd_scan(&secret),
        validate_fd_scan(&release_evidence),
        validate_fd_scan(&inherited),
    ];

    assert_eq!(validate_fd_scan(&valid), Ok(()));
    assert!(
        results
            .iter()
            .all(|result| *result == Err(InitPolicyError::DescriptorScan))
    );
}

fn access_mode(file: &fs::File) -> Result<OFlag, nix::Error> {
    let status = fcntl(file, FcntlArg::F_GETFL)?;
    Ok(OFlag::from_bits_truncate(status) & OFlag::O_ACCMODE)
}

fn descriptor_flags(file: &fs::File) -> Result<FdFlag, nix::Error> {
    let flags = fcntl(file, FcntlArg::F_GETFD)?;
    Ok(FdFlag::from_bits_truncate(flags))
}
