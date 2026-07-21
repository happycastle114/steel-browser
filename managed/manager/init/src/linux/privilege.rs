use anyhow::ensure;
use caps::{CapSet, Capability};
use nix::sys::prctl;
use nix::unistd::{Gid, Uid, setgroups, setresgid, setresuid};
use steel_manager_init::{MANAGER_GID, MANAGER_UID, PrivilegeKernel, execute_privilege_drop};

pub(super) fn drop_privileges() -> anyhow::Result<()> {
    execute_privilege_drop(&mut LinuxPrivilegeKernel)
}

struct LinuxPrivilegeKernel;

impl PrivilegeKernel for LinuxPrivilegeKernel {
    type Error = anyhow::Error;

    fn require_capabilities(&mut self) -> anyhow::Result<()> {
        let required = [
            Capability::CAP_CHOWN,
            Capability::CAP_SETGID,
            Capability::CAP_SETPCAP,
            Capability::CAP_SETUID,
        ];
        let effective = caps::read(None, CapSet::Effective)?;
        ensure!(
            required
                .iter()
                .all(|capability| effective.contains(capability)),
            "required capability missing"
        );
        Ok(())
    }

    fn setgroups_empty(&mut self) -> anyhow::Result<()> {
        setgroups(&[])?;
        Ok(())
    }

    fn drop_capability_bounding_set(&mut self) -> anyhow::Result<()> {
        for capability in caps::all() {
            caps::drop(None, CapSet::Bounding, capability)?;
        }
        Ok(())
    }

    fn set_no_new_privileges(&mut self) -> anyhow::Result<()> {
        prctl::set_no_new_privs()?;
        Ok(())
    }

    fn setresgid_manager(&mut self) -> anyhow::Result<()> {
        let gid = Gid::from_raw(MANAGER_GID);
        setresgid(gid, gid, gid)?;
        Ok(())
    }

    fn setresuid_manager(&mut self) -> anyhow::Result<()> {
        let uid = Uid::from_raw(MANAGER_UID);
        setresuid(uid, uid, uid)?;
        Ok(())
    }

    fn clear_capability_sets(&mut self) -> anyhow::Result<()> {
        for set in [
            CapSet::Ambient,
            CapSet::Effective,
            CapSet::Inheritable,
            CapSet::Permitted,
        ] {
            caps::clear(None, set)?;
        }
        Ok(())
    }
}
