use std::ffi::OsString;

use steel_manager_init::{InitPolicyError, MANAGER_BINARY, validate_manager_argv};

fn blue_command() -> Vec<OsString> {
    [
        MANAGER_BINARY,
        "--pool-id=managed-blue-pool",
        "--worker=worker-00=http://worker-00:3000",
        "--worker=worker-01=http://worker-01:3000",
        "--public-bind=0.0.0.0:3000",
        "--health-bind=127.0.0.1:3001",
        "--create-token-key-file=/run/steel/managed-create-token-key",
        "--release-evidence-file=/run/steel/managed-release-evidence.json",
        "--release-evidence-sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]
    .map(OsString::from)
    .into()
}

#[test]
fn preserves_the_validated_compose_command_byte_for_byte() {
    let command = blue_command();
    let plan = validate_manager_argv(command.clone());
    let expected_digest = [0xaa_u8; 32];

    assert!(plan.is_ok());
    assert_eq!(
        plan.as_ref()
            .map(steel_manager_init::ManagerExecPlan::release_evidence_sha256),
        Ok(&expected_digest)
    );
    let observed = plan.map(|value| {
        std::iter::once(value.program().to_os_string())
            .chain(value.arguments().iter().cloned())
            .collect::<Vec<_>>()
    });
    assert_eq!(observed, Ok(command));
}

#[test]
fn accepts_the_green_slot_with_the_same_fixed_worker_topology() {
    let mut command = blue_command();
    command[1] = OsString::from("--pool-id=managed-green-pool");

    assert!(validate_manager_argv(command).is_ok());
}

#[test]
fn rejects_each_executable_flag_order_and_topology_mutation() {
    let mut executable = blue_command();
    executable[0] = OsString::from("/bin/sh");
    let mut unknown = blue_command();
    unknown.push(OsString::from("--debug"));
    let mut reordered = blue_command();
    reordered.swap(2, 3);
    let mut duplicate = blue_command();
    duplicate[3] = duplicate[2].clone();
    let mut pool_mismatch = blue_command();
    pool_mismatch[1] = OsString::from("--pool-id=other-pool");
    let mut invalid_sha = blue_command();
    invalid_sha[8] = OsString::from(format!("--release-evidence-sha256={}", "A".repeat(64)));

    for mutation in [
        executable,
        unknown,
        reordered,
        duplicate,
        pool_mismatch,
        invalid_sha,
    ] {
        assert!(matches!(
            validate_manager_argv(mutation),
            Err(InitPolicyError::ManagerArguments)
        ));
    }
}
