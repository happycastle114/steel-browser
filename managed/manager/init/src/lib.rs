use std::ffi::{OsStr, OsString};

use sha2::{Digest as _, Sha256};
use thiserror::Error;

pub const MANAGER_BINARY: &str = "/usr/local/bin/steel-managed-manager";
pub const MANAGER_GID: u32 = 10_001;
pub const MANAGER_UID: u32 = 10_001;
pub const SECRET_LENGTH: usize = 64;
pub const SOURCE_PATH: &str = "/run/steel-secret-source/managed-create-token-key";
pub const TARGET_PATH: &str = "/run/steel/managed-create-token-key";
pub const RELEASE_EVIDENCE_MAX_LENGTH: usize = 65_536;
pub const RELEASE_EVIDENCE_SOURCE_PATH: &str =
    "/run/steel-release-evidence-source/release-evidence.json";
pub const RELEASE_EVIDENCE_TARGET_PATH: &str = "/run/steel/managed-release-evidence.json";

const BLUE_POOL_ARGUMENT: &str = "--pool-id=managed-blue-pool";
const GREEN_POOL_ARGUMENT: &str = "--pool-id=managed-green-pool";
const WORKER_ZERO_ARGUMENT: &str = "--worker=worker-00=http://worker-00:3000";
const WORKER_ONE_ARGUMENT: &str = "--worker=worker-01=http://worker-01:3000";
const PUBLIC_BIND_ARGUMENT: &str = "--public-bind=0.0.0.0:3000";
const HEALTH_BIND_ARGUMENT: &str = "--health-bind=127.0.0.1:3001";
const TOKEN_FILE_ARGUMENT: &str = "--create-token-key-file=/run/steel/managed-create-token-key";
const RELEASE_EVIDENCE_FILE_ARGUMENT: &str =
    "--release-evidence-file=/run/steel/managed-release-evidence.json";
const RELEASE_EVIDENCE_SHA256_PREFIX: &str = "--release-evidence-sha256=";

#[cfg(unix)]
pub mod secure_file;

pub trait PrivilegeKernel {
    type Error;

    fn require_capabilities(&mut self) -> Result<(), Self::Error>;
    fn setgroups_empty(&mut self) -> Result<(), Self::Error>;
    fn drop_capability_bounding_set(&mut self) -> Result<(), Self::Error>;
    fn set_no_new_privileges(&mut self) -> Result<(), Self::Error>;
    fn setresgid_manager(&mut self) -> Result<(), Self::Error>;
    fn setresuid_manager(&mut self) -> Result<(), Self::Error>;
    fn clear_capability_sets(&mut self) -> Result<(), Self::Error>;
}

pub fn execute_privilege_drop<K: PrivilegeKernel>(kernel: &mut K) -> Result<(), K::Error> {
    kernel.require_capabilities()?;
    kernel.setgroups_empty()?;
    kernel.drop_capability_bounding_set()?;
    kernel.set_no_new_privileges()?;
    kernel.setresgid_manager()?;
    kernel.setresuid_manager()?;
    kernel.clear_capability_sets()
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum InitPolicyError {
    #[error("descriptor scan rejected")]
    DescriptorScan,
    #[error("mount contract rejected")]
    Mount,
    #[error("manager command rejected")]
    ManagerArguments,
    #[error("secret source rejected")]
    Secret,
    #[error("release evidence rejected")]
    ReleaseEvidence,
    #[error("process status rejected")]
    Status,
}

#[derive(Clone, Copy)]
enum ManagerPoolSlot {
    Blue,
    Green,
}

impl ManagerPoolSlot {
    fn parse(argument: &str) -> Result<Self, InitPolicyError> {
        match argument {
            BLUE_POOL_ARGUMENT => Ok(Self::Blue),
            GREEN_POOL_ARGUMENT => Ok(Self::Green),
            _ => Err(InitPolicyError::ManagerArguments),
        }
    }

    const fn argument(self) -> &'static str {
        match self {
            Self::Blue => BLUE_POOL_ARGUMENT,
            Self::Green => GREEN_POOL_ARGUMENT,
        }
    }
}

pub struct ManagerExecPlan {
    program: OsString,
    arguments: Vec<OsString>,
    release_evidence_sha256: [u8; 32],
}

impl ManagerExecPlan {
    #[must_use]
    pub fn program(&self) -> &OsStr {
        &self.program
    }

    #[must_use]
    pub fn arguments(&self) -> &[OsString] {
        &self.arguments
    }

    #[must_use]
    pub const fn release_evidence_sha256(&self) -> &[u8; 32] {
        &self.release_evidence_sha256
    }
}

pub fn validate_manager_argv(
    argv: impl IntoIterator<Item = OsString>,
) -> Result<ManagerExecPlan, InitPolicyError> {
    let mut command: Vec<OsString> = argv.into_iter().collect();
    let observed: Vec<&str> = command
        .iter()
        .map(|argument| argument.to_str().ok_or(InitPolicyError::ManagerArguments))
        .collect::<Result<_, _>>()?;
    let pool = ManagerPoolSlot::parse(
        observed
            .get(1)
            .copied()
            .ok_or(InitPolicyError::ManagerArguments)?,
    )?;
    let expected = [
        MANAGER_BINARY,
        pool.argument(),
        WORKER_ZERO_ARGUMENT,
        WORKER_ONE_ARGUMENT,
        PUBLIC_BIND_ARGUMENT,
        HEALTH_BIND_ARGUMENT,
        TOKEN_FILE_ARGUMENT,
        RELEASE_EVIDENCE_FILE_ARGUMENT,
    ];
    if observed.len() != expected.len() + 1 || observed[..expected.len()] != expected {
        return Err(InitPolicyError::ManagerArguments);
    }
    let release_evidence_sha256 = parse_release_evidence_sha256(
        observed
            .get(expected.len())
            .copied()
            .ok_or(InitPolicyError::ManagerArguments)?,
    )?;
    let program = command.remove(0);
    Ok(ManagerExecPlan {
        arguments: command,
        program,
        release_evidence_sha256,
    })
}

fn parse_release_evidence_sha256(argument: &str) -> Result<[u8; 32], InitPolicyError> {
    let encoded = argument
        .strip_prefix(RELEASE_EVIDENCE_SHA256_PREFIX)
        .ok_or(InitPolicyError::ManagerArguments)?;
    if encoded.len() != 64 {
        return Err(InitPolicyError::ManagerArguments);
    }
    let mut digest = [0_u8; 32];
    for (index, byte) in digest.iter_mut().enumerate() {
        let offset = index * 2;
        let high = lowercase_hex_nibble(encoded.as_bytes()[offset])?;
        let low = lowercase_hex_nibble(encoded.as_bytes()[offset + 1])?;
        *byte = (high << 4) | low;
    }
    Ok(digest)
}

const fn lowercase_hex_nibble(value: u8) -> Result<u8, InitPolicyError> {
    match value {
        b'0'..=b'9' => Ok(value - b'0'),
        b'a'..=b'f' => Ok(value - b'a' + 10),
        _ => Err(InitPolicyError::ManagerArguments),
    }
}

pub fn validate_secret(bytes: &[u8]) -> Result<(), InitPolicyError> {
    if bytes.len() == SECRET_LENGTH
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        Ok(())
    } else {
        Err(InitPolicyError::Secret)
    }
}

pub fn validate_release_evidence(bytes: &[u8]) -> Result<(), InitPolicyError> {
    if bytes.is_empty() || bytes.len() > RELEASE_EVIDENCE_MAX_LENGTH {
        return Err(InitPolicyError::ReleaseEvidence);
    }
    let document = std::str::from_utf8(bytes).map_err(|_| InitPolicyError::ReleaseEvidence)?;
    if document
        .bytes()
        .any(|byte| byte < b' ' && !matches!(byte, b'\n' | b'\r' | b'\t'))
    {
        return Err(InitPolicyError::ReleaseEvidence);
    }
    let trimmed = document.trim();
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        Ok(())
    } else {
        Err(InitPolicyError::ReleaseEvidence)
    }
}

pub fn validate_release_evidence_sha256(
    bytes: &[u8],
    expected: &[u8; 32],
) -> Result<(), InitPolicyError> {
    let observed = Sha256::digest(bytes);
    if observed.as_slice() == expected {
        Ok(())
    } else {
        Err(InitPolicyError::ReleaseEvidence)
    }
}

pub fn validate_mountinfo(mountinfo: &str) -> Result<(), InitPolicyError> {
    let valid = mountinfo.lines().any(|line| {
        let Some((mount, filesystem)) = line.split_once(" - ") else {
            return false;
        };
        let fields: Vec<&str> = mount.split_ascii_whitespace().collect();
        let filesystem_fields: Vec<&str> = filesystem.split_ascii_whitespace().collect();
        let Some(mount_point) = fields.get(4) else {
            return false;
        };
        let Some(options) = fields.get(5) else {
            return false;
        };
        let Some(kind) = filesystem_fields.first() else {
            return false;
        };
        *mount_point == "/run/steel"
            && *kind == "tmpfs"
            && ["rw", "nosuid", "nodev", "noexec"]
                .iter()
                .all(|required| options.split(',').any(|option| option == *required))
    });
    if valid {
        Ok(())
    } else {
        Err(InitPolicyError::Mount)
    }
}

pub fn validate_fd_scan(entries: &[(i32, String)]) -> Result<(), InitPolicyError> {
    let expected = [0, 1, 2];
    let descriptors: Vec<i32> = entries.iter().map(|(descriptor, _)| *descriptor).collect();
    let secret_match = entries.iter().any(|(_, target)| {
        [
            SOURCE_PATH,
            TARGET_PATH,
            RELEASE_EVIDENCE_SOURCE_PATH,
            RELEASE_EVIDENCE_TARGET_PATH,
        ]
        .iter()
        .any(|path| target.contains(path))
    });
    if descriptors == expected && !secret_match {
        Ok(())
    } else {
        Err(InitPolicyError::DescriptorScan)
    }
}

pub fn validate_proc_status(status: &str) -> Result<(), InitPolicyError> {
    let expected = [
        ("Uid", "10001\t10001\t10001\t10001"),
        ("Gid", "10001\t10001\t10001\t10001"),
        ("Groups", ""),
        ("CapInh", "0000000000000000"),
        ("CapPrm", "0000000000000000"),
        ("CapEff", "0000000000000000"),
        ("CapBnd", "0000000000000000"),
        ("CapAmb", "0000000000000000"),
        ("NoNewPrivs", "1"),
    ];
    let valid = expected.iter().all(|(name, value)| {
        status.lines().any(|line| {
            line.split_once(':')
                .is_some_and(|(key, observed)| key == *name && observed.trim() == *value)
        })
    });
    if valid {
        Ok(())
    } else {
        Err(InitPolicyError::Status)
    }
}
